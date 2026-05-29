import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { User } from '@/lib/models/User';
import { WebhookLog } from '@/lib/models/WebhookLog';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const status = (searchParams.get('status') || '').trim().toLowerCase();
  const page = Math.max(Number(searchParams.get('page') || 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 25), 1), 200);

  await connectToDatabase();
  const allAccounts = await InstagramAccount.find({}).sort({ createdAt: -1 }).lean();
  const userIds = Array.from(new Set(allAccounts.map((a: any) => String(a.userId)).filter(Boolean)));
  const users = await User.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean();
  const userMap = new Map((users as Array<any>).map((u) => [String(u._id), u]));

  const igUserIds = allAccounts.map((a: any) => String(a.igUserId));
  const recentByEntry = new Map<string, Date>();
  if (igUserIds.length > 0) {
    const recent = await WebhookLog.aggregate([
      { $match: { entryId: { $in: igUserIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$entryId', last: { $first: '$createdAt' } } },
    ]);
    for (const r of recent as Array<{ _id: string; last: Date }>) recentByEntry.set(r._id, r.last);
  }

  const now = Date.now();
  const enriched = allAccounts.map((account: any) => {
    const user = userMap.get(String(account.userId));
    const lastWebhookAt = recentByEntry.get(String(account.igUserId)) || account.lastWebhookAt || null;
    const tokenExpiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    const tokenExpiresInDays = tokenExpiresAt ? Math.floor((tokenExpiresAt.getTime() - now) / 86_400_000) : null;
    return {
      id: String(account._id),
      igUserId: String(account.igUserId),
      username: account.username || '',
      userId: String(account.userId || ''),
      userName: user?.name || '',
      userEmail: user?.email || '',
      connectionStatus: account.connectionStatus || 'connected',
      webhookSubscriptionStatus: account.webhookSubscriptionStatus || 'unknown',
      tokenExpiresAt: tokenExpiresAt ? tokenExpiresAt.toISOString() : null,
      tokenExpiresInDays,
      lastWebhookAt: lastWebhookAt ? new Date(lastWebhookAt).toISOString() : null,
      apiErrorCount: Number(account.apiErrorCount || 0),
      reconnectRequired: Boolean(account.reconnectRequired),
      followersCount: Number(account.followersCount || 0),
      dmsSentToday: Number(account.dmsSentToday || 0),
    };
  });

  const filtered = enriched.filter((row) => {
    const haystack = [row.username, row.userName, row.userEmail, row.igUserId].join(' ').toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesStatus = !status || status === 'all'
      || (status === 'healthy' && row.connectionStatus === 'connected' && !row.reconnectRequired)
      || (status === 'token_expired' && row.tokenExpiresInDays !== null && row.tokenExpiresInDays < 14)
      || (status === 'reconnect' && row.reconnectRequired)
      || (status === 'webhook_failed' && row.webhookSubscriptionStatus === 'failed');
    return matchesSearch && matchesStatus;
  });

  const start = (page - 1) * pageSize;
  return NextResponse.json({
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  });
}
