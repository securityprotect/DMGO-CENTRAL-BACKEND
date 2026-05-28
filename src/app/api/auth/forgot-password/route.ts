import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { AuthOtp } from '@/lib/models/AuthOtp';
import { generateOtpCode, hashOtp, otpExpiryDate } from '@/lib/auth/otp';
import { sendForgotPasswordOtpEmail } from '@/lib/services/email';

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  let email = '';
  if (isJson) {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
  } else {
    const form = await req.formData();
    email = String(form.get('email') || '').trim().toLowerCase();
  }

  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

  try {
    await connectToDatabase();
  } catch (error) {
    console.error('[auth:forgot-password] database connection failed', error);
    if (isJson) {
      return NextResponse.json(
        { error: 'Database connection failed. Please check MongoDB credentials and try again.' },
        { status: 503 }
      );
    }
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&email=${encodeURIComponent(email)}&error=db_unavailable`, origin),
      { status: 303 }
    );
  }

  const user = await User.findOne({ email });
  if (!user) {
    if (isJson) {
      return NextResponse.json({ ok: true, message: 'If this email exists, an OTP code has been sent.' });
    }
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}`, origin),
      { status: 303 }
    );
  }

  const otp = generateOtpCode();
  await AuthOtp.findOneAndUpdate(
    { email, purpose: 'forgot-password' },
    { $set: { otpHash: hashOtp(otp), expiresAt: otpExpiryDate(), attempts: 0, payload: { userId: String(user._id) } } },
    { upsert: true, new: true }
  );

  let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: 'unknown' };
  try {
    emailResult = await sendForgotPasswordOtpEmail(email, otp);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'email send failed';
    emailResult = { sent: false, reason: message };
  }

  if (!emailResult.sent) {
    if (isJson) {
      return NextResponse.json(
        {
          error: 'Could not send reset email. Please check Resend sender/domain configuration and try again.',
          details: process.env.NODE_ENV !== 'production' ? emailResult.reason : undefined,
        },
        { status: 502 }
      );
    }
    const reason = process.env.NODE_ENV !== 'production' ? encodeURIComponent(emailResult.reason || 'send_failed') : 'send_failed';
    return NextResponse.redirect(
      new URL(`/sign-up-login-screen?view=forgot&email=${encodeURIComponent(email)}&error=${reason}`, origin),
      { status: 303 }
    );
  }

  if (isJson) {
    return NextResponse.json({
      ok: true,
      message: 'If this email exists, an OTP code has been sent.',
      ...(process.env.NODE_ENV !== 'production' ? { debugOtp: otp } : {}),
    });
  }
  return NextResponse.redirect(
    new URL(`/sign-up-login-screen?view=forgot&sent=1&email=${encodeURIComponent(email)}`, origin),
    { status: 303 }
  );
}
