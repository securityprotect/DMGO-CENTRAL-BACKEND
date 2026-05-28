import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { setAuthCookie, setProfileCookie, signAuthToken } from '@/lib/auth/session';
import { LoginSession } from '@/lib/models/LoginSession';
import { safeErrorLog } from '@/lib/ops/logging';

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const origin = req.headers.get('origin') || new URL(req.url).origin;

  let email = '';
  let password = '';
  let nextPath = '/dashboard';

  if (isJson) {
    const body = await req.json();
    email = body?.email || '';
    password = body?.password || '';
    nextPath = body?.next || '/dashboard';
  } else {
    const form = await req.formData();
    email = String(form.get('email') || '');
    password = String(form.get('password') || '');
    nextPath = String(form.get('next') || '/dashboard');
  }

  if (!email || !password) {
    if (isJson) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }
    return NextResponse.redirect(new URL('/sign-up-login-screen?error=missing_credentials', origin), { status: 303 });
  }

  await connectToDatabase();
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    if (isJson) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/sign-up-login-screen?error=invalid_credentials', origin), { status: 303 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    user.loginFailures24h = Number(user.loginFailures24h || 0) + 1;
    await user.save();
    await safeErrorLog({
      severity: user.loginFailures24h > 5 ? 'high' : 'low',
      module: 'auth',
      userId: user._id,
      errorType: 'LoginFailure',
      errorMessage: 'Invalid credentials',
    });
    if (isJson) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/sign-up-login-screen?error=invalid_credentials', origin), { status: 303 });
  }

  user.lastLoginAt = new Date();
  user.lastLoginIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  user.lastDevice = req.headers.get('user-agent') || '';
  user.lastActivityAt = new Date();
  user.loginFailures24h = 0;
  await user.save();
  await LoginSession.create({
    userId: user._id,
    adminUserId: user.role === 'admin' ? user._id : null,
    ipAddress: user.lastLoginIp,
    browser: req.headers.get('user-agent') || '',
    device: req.headers.get('sec-ch-ua-platform') || '',
    active: true,
    lastSeenAt: new Date(),
  }).catch((error) => console.error('[LOGIN_SESSION] create failed', error));

  const token = signAuthToken(String(user._id), { name: user.name, email: user.email, plan: user.plan });
  const safeNextPath = nextPath.startsWith('/') ? nextPath : '/dashboard';
  const res = isJson
    ? NextResponse.json({ user: { id: String(user._id), name: user.name, email: user.email, plan: user.plan } })
    : NextResponse.redirect(new URL(safeNextPath, origin), { status: 303 });
  res.cookies.set(setAuthCookie(token));
  res.cookies.set(setProfileCookie({ name: user.name, email: user.email, plan: user.plan }));
  return res;
}
