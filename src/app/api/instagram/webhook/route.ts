import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ingestInstagramWebhookBody } from '@/lib/services/instagramWebhook';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || '';

  if (mode === 'subscribe' && token && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const traceId = crypto.randomUUID();
  const entries = Array.isArray(body?.entry) ? body.entry.length : 0;
  console.log(`[IG_WEBHOOK][${traceId}] received entries=${entries}`);

  const result = await ingestInstagramWebhookBody(body, req.headers, traceId);
  console.log(
    `[IG_WEBHOOK][${traceId}] done queued=${result.queuedCount} duplicate=${result.duplicateCount} fallback=${result.fallbackCount} durationMs=${result.durationMs}`
  );

  return NextResponse.json({ ok: true, traceId, ...result });
}
