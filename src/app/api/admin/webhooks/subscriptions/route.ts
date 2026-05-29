import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { subscribeInstagramAccountToWebhooks } from '@/lib/services/instagram';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';

async function fetchSubscribedFields(igUserId: string, accessToken: string) {
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Meta returned ${res.status}`);
  }
  const apps = Array.isArray(data?.data) ? data.data : [];
  const fields = apps.flatMap((app: any) => Array.isArray(app?.subscribed_fields) ? app.subscribed_fields : []);
  return { fields: Array.from(new Set(fields)) as string[], appsCount: apps.length };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  const accounts = await InstagramAccount.find({}, {
    igUserId: 1, username: 1, accessToken: 1, lastWebhookAt: 1, webhookSubscriptionStatus: 1, reconnectRequired: 1, tokenExpiresAt: 1,
  }).lean();

  const rows = await Promise.all((accounts as Array<Record<string, unknown>>).map(async (account) => {
    const igUserId = String(account.igUserId || '');
    const username = String(account.username || '');
    const accessToken = String(account.accessToken || '');
    const lastWebhookAt = (account as any).lastWebhookAt || null;
    const tokenExpiresAt = (account as any).tokenExpiresAt || null;
    let configuredFields: string[] = [];
    let healthy = false;
    let error: string | null = null;
    if (!accessToken) {
      error = 'no access token stored';
    } else {
      try {
        const result = await fetchSubscribedFields(igUserId, accessToken);
        configuredFields = result.fields;
        healthy = result.appsCount > 0;
      } catch (err) {
        error = err instanceof Error ? err.message : 'subscribed_apps fetch failed';
      }
    }
    return {
      igUserId,
      username,
      configuredFields,
      healthy,
      error,
      lastWebhookAt,
      tokenExpiresAt,
      reconnectRequired: Boolean((account as any).reconnectRequired),
      storedStatus: String((account as any).webhookSubscriptionStatus || 'unknown'),
    };
  }));

  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const igUserId = String(body.igUserId || '');
  const action = String(body.action || '');

  if (action !== 'resubscribe') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }
  if (!igUserId) return NextResponse.json({ error: 'igUserId is required' }, { status: 400 });

  await connectToDatabase();
  const account = await InstagramAccount.findOne({ igUserId });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  try {
    await subscribeInstagramAccountToWebhooks(igUserId, String((account as any).accessToken || ''));
    await InstagramAccount.updateOne(
      { igUserId },
      { $set: { webhookSubscriptionStatus: 'healthy', reconnectRequired: false, lastSubscribeError: '' } }
    );
    await logAdminAction({
      actorUserId: String((auth.user as any)._id),
      actorEmail: String((auth.user as any).email),
      action: 'webhook_resubscribe',
      targetType: 'instagram_account',
      targetId: igUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'resubscribe failed';
    await InstagramAccount.updateOne(
      { igUserId },
      { $set: { webhookSubscriptionStatus: 'failed', reconnectRequired: true, lastSubscribeError: msg } }
    );
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
