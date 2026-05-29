import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const igUserId = String(body.igUserId || '').trim();
  const recipientId = String(body.recipientId || '').trim();
  const message = String(body.message || '').trim();
  const commentId = String(body.commentId || '').trim();

  if (!igUserId) return NextResponse.json({ error: 'igUserId is required' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });
  if (!recipientId && !commentId) {
    return NextResponse.json({ error: 'Provide recipientId (IG-scoped user ID) or commentId (for private reply to comment)' }, { status: 400 });
  }

  await connectToDatabase();
  const account = await InstagramAccount.findOne({ igUserId }).lean();
  if (!account) return NextResponse.json({ error: 'Instagram account not found' }, { status: 404 });
  const accessToken = String((account as any).accessToken || '');
  if (!accessToken) return NextResponse.json({ error: 'Account has no access token' }, { status: 409 });

  const recipient = commentId ? { comment_id: commentId } : { id: recipientId };
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/messages?access_token=${encodeURIComponent(accessToken)}`;
  const payload = {
    recipient,
    message: { text: message },
  };

  const startedAt = Date.now();
  let responseStatus = 0;
  let responseBody: unknown = null;
  let error: string | null = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    responseStatus = res.status;
    const text = await res.text();
    try { responseBody = JSON.parse(text); } catch { responseBody = text; }
  } catch (err) {
    error = err instanceof Error ? err.message : 'fetch failed';
  }
  const durationMs = Date.now() - startedAt;

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'admin_send_dm_test',
    targetType: 'instagram_account',
    targetId: igUserId,
    metadata: { recipientId, commentId, messageLength: message.length, status: responseStatus, durationMs },
  });

  return NextResponse.json({
    ok: !error && responseStatus < 400,
    payload,
    status: responseStatus,
    durationMs,
    response: responseBody,
    error,
  });
}
