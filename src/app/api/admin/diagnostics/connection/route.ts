import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { ApiLog } from '@/lib/models/ApiLog';
import { ErrorLog } from '@/lib/models/ErrorLog';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';

type StepStatus = 'pass' | 'warn' | 'fail';
type Step = { name: string; status: StepStatus; detail: string; durationMs: number; hint?: string };

async function runStep<T>(name: string, fn: () => Promise<{ status: StepStatus; detail: string; hint?: string; data?: T }>) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      name,
      status: result.status,
      detail: result.detail,
      hint: result.hint,
      durationMs: Date.now() - started,
      data: result.data,
    } as Step & { data?: T };
  } catch (error) {
    return {
      name,
      status: 'fail' as StepStatus,
      detail: error instanceof Error ? error.message : 'unknown error',
      durationMs: Date.now() - started,
    };
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const igUserId = (searchParams.get('igUserId') || '').trim();
  const username = (searchParams.get('username') || '').trim().replace(/^@/, '').toLowerCase();
  if (!igUserId && !username) {
    return NextResponse.json({ error: 'igUserId or username is required' }, { status: 400 });
  }

  await connectToDatabase();

  const steps: Array<Step & { data?: any }> = [];

  const dbStep = await runStep<{ account: any }>('Account lookup in MongoDB', async () => {
    const account = await InstagramAccount.findOne(
      igUserId ? { igUserId } : { username: new RegExp(`^${username}$`, 'i') }
    ).lean();
    if (!account) return { status: 'fail', detail: 'No InstagramAccount document found for this user.', hint: 'Connect via the public frontend first, or check spelling.' };
    return { status: 'pass', detail: `Found account @${(account as any).username} (igUserId=${(account as any).igUserId})`, data: { account } };
  });
  steps.push(dbStep);
  const account: any = (dbStep as any).data?.account;
  if (!account) return NextResponse.json({ steps, overall: 'fail' });

  const resolvedIgUserId = String(account.igUserId);
  const accessToken = String(account.accessToken || '');

  steps.push(await runStep('Token presence', async () => {
    if (!accessToken) return { status: 'fail', detail: 'No access token stored.', hint: 'Reconnect this account via OAuth.' };
    return { status: 'pass', detail: 'Access token is stored.' };
  }));

  steps.push(await runStep('Token validity (Meta /me)', async () => {
    if (!accessToken) return { status: 'fail', detail: 'Skipped — no token.' };
    const res = await fetch('https://graph.instagram.com/me?fields=id,username', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { status: 'pass', detail: `Meta accepted token for @${data?.username || 'unknown'}.` };
    const msg = data?.error?.message || `HTTP ${res.status}`;
    return { status: 'fail', detail: `Meta rejected token: ${msg}`, hint: 'Use IG Account → Refresh token, or reconnect.' };
  }));

  steps.push(await runStep('Long-lived token expiry', async () => {
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    if (!expiresAt) return { status: 'warn', detail: 'tokenExpiresAt not set (account may be using a legacy short-lived token).', hint: 'Reconnect to obtain a long-lived 60-day token.' };
    const days = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
    if (days < 0) return { status: 'fail', detail: `Token expired ${-days} days ago.`, hint: 'Reconnect this account.' };
    if (days < 14) return { status: 'warn', detail: `Token expires in ${days} days.`, hint: 'Trigger token refresh now.' };
    return { status: 'pass', detail: `Token valid for ${days} more days (expires ${expiresAt.toISOString().slice(0, 10)}).` };
  }));

  steps.push(await runStep('Webhook subscription (Meta subscribed_apps)', async () => {
    if (!accessToken) return { status: 'fail', detail: 'Skipped — no token.' };
    const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${resolvedIgUserId}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'fail', detail: `Meta error: ${data?.error?.message || `HTTP ${res.status}`}`, hint: 'Try Re-subscribe webhooks action.' };
    }
    const apps = Array.isArray(data?.data) ? data.data : [];
    if (apps.length === 0) {
      return { status: 'fail', detail: 'No app subscribed to this Instagram account.', hint: 'Use IG Account → Re-subscribe webhooks.' };
    }
    const fields = apps.flatMap((a: any) => a?.subscribed_fields || []);
    const hasMessages = fields.includes('messages');
    if (!hasMessages) {
      return { status: 'warn', detail: `Subscribed to ${fields.length} fields but missing "messages". (${fields.join(', ') || 'none'})`, hint: 'Re-subscribe to widen fields.' };
    }
    return { status: 'pass', detail: `Subscribed to ${fields.length} fields: ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '…' : ''}` };
  }));

  steps.push(await runStep('Recent webhook delivery', async () => {
    const lastWebhook = await WebhookLog.findOne({ entryId: resolvedIgUserId }).sort({ createdAt: -1 }).lean();
    if (!lastWebhook) return { status: 'warn', detail: 'No webhook event ever recorded for this account.', hint: 'Send a test DM/comment to verify Meta is delivering.' };
    const ageMin = Math.floor((Date.now() - new Date((lastWebhook as any).createdAt).getTime()) / 60_000);
    if (ageMin > 60 * 24) return { status: 'warn', detail: `Last event ${ageMin} minutes ago — quiet for over a day.` };
    return { status: 'pass', detail: `Last event ${ageMin} minute(s) ago (status=${(lastWebhook as any).status}).` };
  }));

  steps.push(await runStep('Recent failures (ApiLog + ErrorLog)', async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedApi, openErrors] = await Promise.all([
      ApiLog.countDocuments({ userId: account.userId, statusCode: { $gte: 400 }, createdAt: { $gte: cutoff } }),
      ErrorLog.countDocuments({ userId: account.userId, status: 'open' }),
    ]);
    if (openErrors > 0 || failedApi > 5) {
      return { status: 'warn', detail: `${failedApi} failed API call(s) in 24h, ${openErrors} open error(s).`, hint: 'Check Errors and IG drilldown ApiLog section.' };
    }
    return { status: 'pass', detail: `${failedApi} failed API call(s) in 24h, ${openErrors} open error(s).` };
  }));

  const hasFail = steps.some((s) => s.status === 'fail');
  const hasWarn = steps.some((s) => s.status === 'warn');
  const overall: 'pass' | 'warn' | 'fail' = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  return NextResponse.json({
    igUserId: resolvedIgUserId,
    username: account.username,
    overall,
    steps: steps.map(({ data, ...rest }) => rest),
  });
}
