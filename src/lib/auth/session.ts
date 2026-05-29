import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import jwt from 'jsonwebtoken';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import type { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'dmgo_token';
const PROFILE_COOKIE_NAME = 'dmgo_profile';

type AuthTokenProfile = {
  name?: string;
  email?: string;
  plan?: string;
};

function authCookieSameSite(): 'strict' | 'lax' | 'none' {
  const configured = String(process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase();
  if (configured === 'strict' || configured === 'lax' || configured === 'none') return configured;
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
}

function authCookieSecure() {
  return process.env.NODE_ENV === 'production' || authCookieSameSite() === 'none';
}

export function encodeProfileCookie(profile: AuthTokenProfile) {
  return Buffer.from(JSON.stringify({
    name: profile.name || '',
    email: profile.email || '',
    plan: profile.plan || 'starter',
  }), 'utf8').toString('base64url');
}

export function decodeProfileCookie(raw: string | undefined) {
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(text) as AuthTokenProfile;
    return {
      name: String(parsed?.name || ''),
      email: String(parsed?.email || ''),
      plan: String(parsed?.plan || 'starter'),
    };
  } catch {
    return null;
  }
}

export function signAuthToken(userId: string, profile?: AuthTokenProfile) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const signOptions: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  };
  return jwt.sign({ sub: userId, ...(profile || {}) }, secret, {
    ...signOptions,
  });
}

export async function getAuthedUser() {
  const headerStore = await headers();
  const bearer = String(headerStore.get('authorization') || '').trim();
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const token = bearer.slice(7).trim();
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    try {
      const decoded = jwt.verify(token, secret) as { sub: string };
      await connectToDatabase();
      return User.findById(decoded.sub).lean();
    } catch {
      // fall back to cookie auth below
    }
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    if (process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production') {
      await connectToDatabase();
      const email = process.env.DEV_AUTH_EMAIL || 'dev@dmgo.local';
      let user = await User.findOne({ email }).lean();
      if (!user) {
        const passwordHash = await bcrypt.hash('dev-password-not-for-prod', 10);
        const created = await User.create({ name: 'Dev User', email, passwordHash, plan: 'starter' });
        user = created.toObject();
      }
      return user;
    }
    return null;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  try {
    const decoded = jwt.verify(token, secret) as { sub: string };
    await connectToDatabase();
    return User.findById(decoded.sub).lean();
  } catch {
    return null;
  }
}

export function setAuthCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function setProfileCookie(profile: AuthTokenProfile) {
  return {
    name: PROFILE_COOKIE_NAME,
    value: encodeProfileCookie(profile),
    httpOnly: false,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function clearAuthCookie() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
    maxAge: 0,
  };
}

export function clearProfileCookie() {
  return {
    name: PROFILE_COOKIE_NAME,
    value: '',
    httpOnly: false,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
    maxAge: 0,
  };
}
