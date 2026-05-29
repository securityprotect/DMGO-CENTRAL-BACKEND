import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { processInstagramWebhookEvent } from '@/lib/services/instagramAutomation';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId') || '';
  const status = searchParams.get('status') || '';
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

  await connectToDatabase();

  const filter: Record<string, unknown> = { source: 'instagram' };
  if (status && status !== 'all') filter.status = status;
  if (accountId) filter.entryId = accountId;

  const [rows, total, accounts] = await Promise.all([
    WebhookLog.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    WebhookLog.countDocuments(filter),
    InstagramAccount.find({}, { igUserId: 1, webhookUserId: 1, username: 1, lastWebhookAt: 1, webhookStatus: 1, webhookSubscriptionStatus: 1 }).lean(),
  ]);

  const accountMap = new Map(
    (accounts as Array<{ igUserId: string; webhookUserId?: string; username: string }>).flatMap((a) => {
      const entries: Array<[string, string]> = [[String(a.igUserId), a.username]];
      if (a.webhookUserId && a.webhookUserId !== a.igUserId) entries.push([String(a.webhookUserId), a.username]);
      return entries;
    })
  );

  const enriched = (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row._id),
    createdAt: row.createdAt,
    eventKey: row.eventKey || '',
    entryId: row.entryId || '',
    username: accountMap.get(String(row.entryId || '')) || null,
    changeField: row.changeField || '',
    status: row.status,
    responseCode: row.responseCode || 0,
    processingTimeMs: row.processingTimeMs || 0,
    traceId: row.traceId || '',
    replayable: Boolean(row.replayable),
    replayedAt: row.replayedAt || null,
    deduped: Boolean(row.deduped),
    errorMessage: row.errorMessage || '',
  }));

  return NextResponse.json({ rows: enriched, total, limit, offset });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const action = String(body.action || '');

  if (action !== 'replay') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await connectToDatabase();
  const original = await WebhookLog.findById(id);
  if (!original) return NextResponse.json({ error: 'Webhook event not found' }, { status: 404 });
  if (!original.replayable) return NextResponse.json({ error: 'Event is not replayable' }, { status: 409 });

  const eventKey = String((original as any).eventKey || '');
  let processResult: { ok: boolean; reason?: string } = { ok: false, reason: 'no eventKey' };
  if (eventKey) {
    try {
      processResult = await processInstagramWebhookEvent(eventKey, String((original as any).traceId || ''));
    } catch (error) {
      processResult = { ok: false, reason: error instanceof Error ? error.message : 'replay error' };
    }
  }

  await WebhookLog.create({
    source: 'instagram',
    userId: (original as any).userId || null,
    endpoint: (original as any).endpoint,
    eventKey,
    entryId: (original as any).entryId,
    changeField: (original as any).changeField,
    traceId: (original as any).traceId,
    status: processResult.ok ? 'replayed' : 'failed',
    rawPayload: (original as any).rawPayload,
    responsePayload: { replay: true, originalId: id, ...processResult },
    replayable: false,
    errorMessage: processResult.ok ? '' : String(processResult.reason || ''),
  });

  await WebhookLog.updateOne({ _id: id }, { $set: { replayedAt: new Date() } });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'webhook_replay',
    targetType: 'webhook_log',
    targetId: id,
    metadata: { eventKey, ok: processResult.ok, reason: processResult.reason },
  });

  return NextResponse.json({ ok: processResult.ok, reason: processResult.reason });
}
