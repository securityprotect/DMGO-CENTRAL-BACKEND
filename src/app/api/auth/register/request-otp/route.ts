import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { AuthOtp } from '@/lib/models/AuthOtp';
import { generateOtpCode, hashOtp, otpExpiryDate } from '@/lib/auth/otp';
import { sendSignupOtpEmail } from '@/lib/services/email';

export async function POST(req: Request) {
  const body = await req.json();
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  await connectToDatabase();
  const existing = await User.findOne({ email });
  if (existing) return NextResponse.json({ error: 'Email already exists' }, { status: 409 });

  const otp = generateOtpCode();
  const passwordHash = await bcrypt.hash(password, 10);

  await AuthOtp.findOneAndUpdate(
    { email, purpose: 'register' },
    {
      $set: {
        otpHash: hashOtp(otp),
        expiresAt: otpExpiryDate(),
        attempts: 0,
        payload: { name, email, passwordHash },
      },
    },
    { upsert: true, new: true }
  );

  const emailResult = await sendSignupOtpEmail(email, otp);
  if (!emailResult.sent) {
    return NextResponse.json(
      {
        error: 'Could not send OTP email.',
        details: process.env.NODE_ENV !== 'production' ? emailResult.reason : undefined,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, message: 'Verification code sent to your email.' });
}

