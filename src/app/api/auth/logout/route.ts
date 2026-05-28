import { NextResponse } from 'next/server';
import { clearAuthCookie, clearProfileCookie } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearAuthCookie());
  res.cookies.set(clearProfileCookie());
  return res;
}
