import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { AuthOtp } from '@/lib/models/AuthOtp';
import { User } from '@/lib/models/User';
import { hashOtp } from '@/lib/auth/otp';
import { sendWelcomeEmail } from '@/lib/services/email';
import { setAuthCookie, setProfileCookie, signAuthToken } from '@/lib/auth/session';

export async function POST(req: Request) {
  const body = await req.json();
  const email = String(body?.email || '').trim().toLowerCase();
  const otp = String(body?.otp || '').trim();

  if (!email || !otp) {
    return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
  }

  await connectToDatabase();
  const pending = await AuthOtp.findOne({ email, purpose: 'register' });
  if (!pending) return NextResponse.json({ error: 'No OTP request found. Please request a new code.' }, { status: 400 });
  if (pending.expiresAt <= new Date()) {
    await AuthOtp.deleteOne({ _id: pending._id });
    return NextResponse.json({ error: 'OTP expired. Please request a new code.' }, { status: 400 });
  }
  if (pending.otpHash !== hashOtp(otp)) {
    pending.attempts = (pending.attempts || 0) + 1;
    await pending.save();
    return NextResponse.json({ error: 'Invalid OTP code' }, { status: 400 });
  }

  const payload = pending.payload || {};
  const name = String(payload.name || '').trim();
  const passwordHash = String(payload.passwordHash || '');
  const phone = String(payload.phone || '').trim();
  if (!name || !passwordHash) {
    await AuthOtp.deleteOne({ _id: pending._id });
    return NextResponse.json({ error: 'Invalid OTP payload. Please restart registration.' }, { status: 400 });
  }

  const exists = await User.findOne({ email });
  if (exists) {
    await AuthOtp.deleteOne({ _id: pending._id });
    return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
  }

  const user = await User.create({ name, email, passwordHash, phone });
  await AuthOtp.deleteOne({ _id: pending._id });

  void sendWelcomeEmail(email, name);

  const token = signAuthToken(String(user._id), { name: user.name, email: user.email, plan: user.plan });
  const res = NextResponse.json({
    ok: true,
    user: { id: String(user._id), name: user.name, email: user.email, plan: user.plan },
    token,
  });
  res.cookies.set(setAuthCookie(token));
  res.cookies.set(setProfileCookie({ name: user.name, email: user.email, plan: user.plan }));
  return res;
}
