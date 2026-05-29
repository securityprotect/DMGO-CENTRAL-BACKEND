import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { ingestInstagramWebhookBody } from '@/lib/services/instagramWebhook';

type Template = 'comment' | 'message' | 'mention' | 'custom';

function buildPayload(
  template: Template,
  igUserId: string,
  options: { text: string; senderId: string; senderUsername: string; mediaId: string; commentId: string }
) {
  const now = Math.floor(Date.now() / 1000);
  switch (template) {
    case 'comment':
      return {
        object: 'instagram',
        entry: [{
          id: igUserId,
          time: now,
          changes: [{
            field: 'comments',
            value: {
              id: options.commentId || `simulated_comment_${now}`,
              text: options.text,
              from: { id: options.senderId, username: options.senderUsername },
              media: { id: options.mediaId || 'simulated_media' },
            },
          }],
        }],
      };
    case 'message':
      return {
        object: 'instagram',
        entry: [{
          id: igUserId,
          time: now,
          messaging: [{
            sender: { id: options.senderId },
            recipient: { id: igUserId },
            timestamp: now * 1000,
            message: {
              mid: `simulated_msg_${now}`,
              text: options.text,
            },
          }],
        }],
      };
    case 'mention':
      return {
        object: 'instagram',
        entry: [{
          id: igUserId,
          time: now,
          changes: [{
            field: 'mentions',
            value: {
              media_id: options.mediaId || 'simulated_media',
              comment_id: options.commentId || `simulated_comment_${now}`,
            },
          }],
        }],
      };
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const template = String(body.template || 'comment') as Template;
  const igUserId = String(body.igUserId || '').trim();
  const text = String(body.text || 'simulated event from admin');
  const senderId = String(body.senderId || `simulated_user_${Date.now()}`);
  const senderUsername = String(body.senderUsername || 'simulated_user');
  const mediaId = String(body.mediaId || '');
  const commentId = String(body.commentId || '');
  const customPayload = body.customPayload && typeof body.customPayload === 'object' ? body.customPayload : null;

  if (!igUserId && !customPayload) return NextResponse.json({ error: 'igUserId is required (or supply customPayload)' }, { status: 400 });

  const payload = template === 'custom'
    ? customPayload
    : buildPayload(template, igUserId, { text, senderId, senderUsername, mediaId, commentId });

  if (!payload) return NextResponse.json({ error: 'Invalid payload — unsupported template' }, { status: 400 });

  const traceId = `sim_${crypto.randomUUID()}`;
  const fakeHeaders = new Headers({ 'x-admin-simulated': 'true' });

  const startedAt = Date.now();
  let ingestResult: unknown;
  let error: string | null = null;
  try {
    ingestResult = await ingestInstagramWebhookBody(payload as any, fakeHeaders, traceId);
  } catch (err) {
    error = err instanceof Error ? err.message : 'ingest failed';
  }
  const durationMs = Date.now() - startedAt;

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'webhook_simulate',
    targetType: 'instagram_account',
    targetId: igUserId || 'custom',
    metadata: { template, traceId, durationMs, ok: !error },
  });

  return NextResponse.json({
    ok: !error,
    traceId,
    template,
    durationMs,
    payload,
    result: ingestResult,
    error,
  });
}
