import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

type RateEntry = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 120);
const rateBuckets = new Map<string, RateEntry>();

function allowedOrigins() {
  return String(process.env.CORS_ORIGINS || process.env.PUBLIC_FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isOriginAllowed(origin: string | null) {
  if (!origin) return false;
  const normalizedOrigin = origin.replace(/\/+$/, '');
  const configured = allowedOrigins();
  if (configured.includes('*')) return true;
  if (configured.includes(normalizedOrigin)) return true;
  return process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(normalizedOrigin);
}

function applyApiHeaders(res: NextResponse, req: NextRequest) {
  const origin = req.headers.get('origin');
  if (isOriginAllowed(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin as string);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  return res;
}

function checkRateLimit(req: NextRequest) {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || req.headers.get('x-real-ip') || 'unknown';
  const key = `${ip}:${req.nextUrl.pathname}`;
  const now = Date.now();
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }

  return null;
}

export function middleware(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return applyApiHeaders(new NextResponse(null, { status: 204 }), req);
  }

  const limited = checkRateLimit(req);
  if (limited) return applyApiHeaders(limited, req);

  return applyApiHeaders(NextResponse.next(), req);
}

export const config = {
  matcher: ['/api/:path*'],
};
