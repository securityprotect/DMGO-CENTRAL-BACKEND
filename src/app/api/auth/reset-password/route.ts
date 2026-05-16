import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { AuthOtp } from '@/lib/models/AuthOtp';

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  let email = '';
  let newPassword = '';
  if (isJson) {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
    newPassword = String(body?.newPassword || '');
  } else {
    const form = await req.formData();
    email = String(form.get('email') || '').trim().toLowerCase();
    newPassword = String(form.get('newPassword') || form.get('password') || '');
  }

  if (!email || !newPassword) {
    if (isJson) return NextResponse.json({ error: 'Email and new password are required' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&stage=verified&error=missing_reset_fields`, origin),
      { status: 303 }
    );
  }
  if (newPassword.length < 8) {
    if (isJson) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&stage=verified&error=weak_password`, origin),
      { status: 303 }
    );
  }

  await connectToDatabase();
  const pending = await AuthOtp.findOne({ email, purpose: 'forgot-password' });
  if (!pending) {
    if (isJson) return NextResponse.json({ error: 'No OTP request found. Please request a new code.' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&email=${encodeURIComponent(email)}&error=no_otp_request`, origin),
      { status: 303 }
    );
  }
  if (pending.expiresAt <= new Date()) {
    await AuthOtp.deleteOne({ _id: pending._id });
    if (isJson) return NextResponse.json({ error: 'OTP expired. Please request a new code.' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&email=${encodeURIComponent(email)}&error=otp_expired`, origin),
      { status: 303 }
    );
  }
  if (!pending.payload?.verifiedAt) {
    if (isJson) return NextResponse.json({ error: 'Please verify OTP first' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&error=verify_otp_first`, origin),
      { status: 303 }
    );
  }

  const user = await User.findOne({ email });
  if (!user) {
    if (isJson) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&email=${encodeURIComponent(email)}&error=user_not_found`, origin),
      { status: 303 }
    );
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  await AuthOtp.deleteOne({ _id: pending._id });

  if (isJson) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL('/sign-up-login-screen?view=login&reset=1', origin), { status: 303 });
}
