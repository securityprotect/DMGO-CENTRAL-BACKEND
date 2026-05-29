import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { User } from '@/lib/models/User';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { ApiLog } from '@/lib/models/ApiLog';
import { AutomationLog } from '@/lib/models/AutomationLog';
import {
  buildInstagramState,
  getInstagramOAuthUrl,
  refreshLongLivedToken,
  subscribeInstagramAccountToWebhooks,
} from '@/lib/services/instagram';

async function findAccount(idOrIgUserId: string) {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrIgUserId);
  if (isObjectId) {
    const account = await InstagramAccount.findById(idOrIgUserId);
    if (account) return account;
  }
  return InstagramAccount.findOne({ igUserId: idOrIgUserId });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  await connectToDatabase();
  const account = await findAccount(id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const igUserId = String((account as any).igUserId);
  const accountUserId = (account as any).userId;
  const [user, recentWebhooks, recentApiLogs, recentAutomationLogs] = await Promise.all([
    accountUserId ? User.findById(accountUserId, { name: 1, email: 1, phone: 1 }).lean() : null,
    WebhookLog.find({ entryId: igUserId }).sort({ createdAt: -1 }).limit(20).lean(),
    ApiLog.find({ userId: accountUserId, service: { $regex: /instagram|meta|graph/i } }).sort({ createdAt: -1 }).limit(20).lean(),
    AutomationLog.find({ instagramAccountId: (account as any)._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  const now = Date.now();
  const tokenExpiresAt = (account as any).tokenExpiresAt ? new Date((account as any).tokenExpiresAt) : null;
  const tokenExpiresInDays = tokenExpiresAt ? Math.floor((tokenExpiresAt.getTime() - now) / 86_400_000) : null;

  return NextResponse.json({
    account: {
      id: String((account as any)._id),
      igUserId,
      username: (account as any).username,
      accountType: (account as any).accountType,
      connectionStatus: (account as any).connectionStatus,
      webhookSubscriptionStatus: (account as any).webhookSubscriptionStatus,
      reconnectRequired: Boolean((account as any).reconnectRequired),
      lastSubscribeError: (account as any).lastSubscribeError || '',
      lastTokenRefreshAt: (account as any).lastTokenRefreshAt || null,
      tokenExpiresAt: tokenExpiresAt ? tokenExpiresAt.toISOString() : null,
      tokenExpiresInDays,
      lastWebhookAt: (account as any).lastWebhookAt || null,
      apiErrorCount: Number((account as any).apiErrorCount || 0),
      dmsSentToday: Number((account as any).dmsSentToday || 0),
      dailyLimit: Number((account as any).dailyLimit || 0),
      followersCount: Number((account as any).followersCount || 0),
    },
    user: user
      ? { id: String((user as any)._id), name: (user as any).name, email: (user as any).email, phone: (user as any).phone || '' }
      : null,
    webhooks: recentWebhooks.map((w: any) => ({
      id: String(w._id),
      createdAt: w.createdAt,
      eventKey: w.eventKey || '',
      changeField: w.changeField || '',
      status: w.status,
      responseCode: w.responseCode || 0,
      errorMessage: w.errorMessage || '',
    })),
    apiLogs: recentApiLogs.map((l: any) => ({
      id: String(l._id),
      createdAt: l.createdAt,
      service: l.service,
      method: l.method,
      endpoint: l.endpoint,
      statusCode: l.statusCode,
      durationMs: l.durationMs,
      errorMessage: l.errorMessage || '',
    })),
    automationLogs: recentAutomationLogs.map((a: any) => ({
      id: String(a._id),
      createdAt: a.createdAt,
      eventType: a.eventType,
      status: a.status,
      triggerKeyword: a.triggerKeyword || '',
      executionDurationMs: a.executionDurationMs || 0,
      errorMessage: a.errorMessage || '',
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  await connectToDatabase();
  const account = await findAccount(id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const igUserId = String((account as any).igUserId);
  const adminMeta = {
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    targetType: 'instagram_account',
    targetId: igUserId,
  };

  switch (action) {
    case 'refresh_token': {
      try {
        const data = await refreshLongLivedToken(String((account as any).accessToken || ''));
        const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
        await InstagramAccount.updateOne(
          { _id: (account as any)._id },
          {
            $set: {
              accessToken: data.access_token,
              tokenExpiresAt: expiresAt,
              lastTokenRefreshAt: new Date(),
              connectionStatus: 'connected',
              reconnectRequired: false,
            },
          }
        );
        await logAdminAction({ ...adminMeta, action: 'ig_token_refresh' });
        return NextResponse.json({ ok: true, tokenExpiresAt: expiresAt?.toISOString() || null });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'token refresh failed';
        await InstagramAccount.updateOne(
          { _id: (account as any)._id },
          { $set: { connectionStatus: 'token_expired', reconnectRequired: true } }
        );
        return NextResponse.json({ ok: false, error: msg }, { status: 502 });
      }
    }

    case 'resubscribe_webhooks': {
      try {
        await subscribeInstagramAccountToWebhooks(igUserId, String((account as any).accessToken || ''));
        await InstagramAccount.updateOne(
          { _id: (account as any)._id },
          { $set: { webhookSubscriptionStatus: 'healthy', reconnectRequired: false, lastSubscribeError: '' } }
        );
        await logAdminAction({ ...adminMeta, action: 'ig_webhook_resubscribe' });
        return NextResponse.json({ ok: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'resubscribe failed';
        await InstagramAccount.updateOne(
          { _id: (account as any)._id },
          { $set: { webhookSubscriptionStatus: 'failed', reconnectRequired: true, lastSubscribeError: msg } }
        );
        return NextResponse.json({ ok: false, error: msg }, { status: 502 });
      }
    }

    case 'force_disconnect': {
      await InstagramAccount.updateOne(
        { _id: (account as any)._id },
        { $set: { connectionStatus: 'disconnected', reconnectRequired: true, accessToken: '' } }
      );
      await logAdminAction({ ...adminMeta, action: 'ig_force_disconnect' });
      return NextResponse.json({ ok: true });
    }

    case 'clear_errors': {
      await InstagramAccount.updateOne(
        { _id: (account as any)._id },
        { $set: { apiErrorCount: 0, lastSubscribeError: '' } }
      );
      await logAdminAction({ ...adminMeta, action: 'ig_clear_errors' });
      return NextResponse.json({ ok: true });
    }

    case 'reconnect_link': {
      const userIdForState = String((account as any).userId || '');
      if (!userIdForState) return NextResponse.json({ error: 'Account missing userId' }, { status: 409 });
      try {
        const state = buildInstagramState(userIdForState);
        const url = getInstagramOAuthUrl(state);
        await logAdminAction({ ...adminMeta, action: 'ig_reconnect_link_generated' });
        return NextResponse.json({ ok: true, url, expiresInMinutes: 15 });
      } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'link build failed' }, { status: 500 });
      }
    }

    default:
      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }
}
