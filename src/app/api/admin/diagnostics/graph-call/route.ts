import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE']);

function buildUrl(path: string, params: Record<string, string>, accessToken: string, igUserId: string) {
  let trimmed = path.trim().replace(/^\/+/, '');
  trimmed = trimmed.replace(/\{igUserId\}/g, igUserId);
  const isAbsolute = /^https?:\/\//i.test(trimmed);
  const base = isAbsolute ? trimmed : `https://graph.instagram.com/${GRAPH_VERSION}/${trimmed}`;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.get('access_token')) url.searchParams.set('access_token', accessToken);
  return url.toString();
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const igUserId = String(body.igUserId || '').trim();
  const path = String(body.path || '').trim();
  const method = String(body.method || 'GET').toUpperCase();
  const params = (body.params && typeof body.params === 'object') ? body.params as Record<string, string> : {};
  const requestBody = body.body && typeof body.body === 'object' ? body.body : null;

  if (!igUserId) return NextResponse.json({ error: 'igUserId is required' }, { status: 400 });
  if (!path) return NextResponse.json({ error: 'path is required (e.g. "me" or "{igUserId}/conversations")' }, { status: 400 });
  if (!ALLOWED_METHODS.has(method)) return NextResponse.json({ error: `method must be one of ${[...ALLOWED_METHODS].join(', ')}` }, { status: 400 });

  await connectToDatabase();
  const account = await InstagramAccount.findOne({ igUserId }).lean();
  if (!account) return NextResponse.json({ error: 'Instagram account not found' }, { status: 404 });

  const accessToken = String((account as any).accessToken || '');
  if (!accessToken) return NextResponse.json({ error: 'Account has no access token' }, { status: 409 });

  const url = buildUrl(path, params, accessToken, igUserId);
  const safeUrl = url.replace(/access_token=[^&]+/, 'access_token=***');

  const startedAt = Date.now();
  let responseStatus = 0;
  let responseBody: unknown = null;
  let error: string | null = null;
  try {
    const fetchInit: RequestInit = {
      method,
      headers: { Accept: 'application/json' },
    };
    if (requestBody && method !== 'GET') {
      (fetchInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
      fetchInit.body = JSON.stringify(requestBody);
    }
    const res = await fetch(url, fetchInit);
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
    action: 'graph_call_test',
    targetType: 'instagram_account',
    targetId: igUserId,
    metadata: { path, method, status: responseStatus, durationMs },
  });

  return NextResponse.json({
    ok: !error && responseStatus < 400,
    url: safeUrl,
    method,
    status: responseStatus,
    durationMs,
    response: responseBody,
    error,
  });
}
