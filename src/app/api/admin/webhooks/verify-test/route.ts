import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const challenge = searchParams.get('challenge') || `TEST${Math.floor(Math.random() * 1_000_000)}`;
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || '';
  if (!verifyToken) {
    return NextResponse.json({ ok: false, error: 'INSTAGRAM_VERIFY_TOKEN env not set' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const target = `${origin}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(challenge)}`;

  const startedAt = Date.now();
  try {
    const res = await fetch(target, { method: 'GET', headers: { Accept: 'text/plain' } });
    const body = await res.text();
    const durationMs = Date.now() - startedAt;
    const ok = res.status === 200 && body.trim() === challenge;
    return NextResponse.json({
      ok,
      status: res.status,
      challenge,
      responseBody: body.slice(0, 500),
      durationMs,
      target,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'verify probe failed',
      durationMs: Date.now() - startedAt,
      target,
    });
  }
}
