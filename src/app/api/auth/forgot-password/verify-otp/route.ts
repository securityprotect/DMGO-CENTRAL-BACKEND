import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { AuthOtp } from '@/lib/models/AuthOtp';
import { hashOtp } from '@/lib/auth/otp';

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  let email = '';
  let otp = '';
  if (isJson) {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
    otp = String(body?.otp || '').trim();
  } else {
    const form = await req.formData();
    email = String(form.get('email') || '').trim().toLowerCase();
    otp = String(form.get('otp') || '').trim();
  }

  if (!email || !otp) {
    if (isJson) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&error=missing_otp`, origin),
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
  if (pending.otpHash !== hashOtp(otp)) {
    pending.attempts = (pending.attempts || 0) + 1;
    await pending.save();
    if (isJson) return NextResponse.json({ error: 'Invalid OTP code' }, { status: 400 });
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&error=invalid_otp`, origin),
      { status: 303 }
    );
  }
  pending.payload = { ...(pending.payload || {}), verifiedAt: new Date().toISOString() };
  await pending.save();

  if (isJson) return NextResponse.json({ ok: true, message: 'OTP verified' });
  return NextResponse.redirect(
    new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}&stage=verified`, origin),
    { status: 303 }
  );
}
