import crypto from 'crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_LENGTH = 6;

export function generateOtpCode() {
  const max = 10 ** OTP_LENGTH;
  const min = 10 ** (OTP_LENGTH - 1);
  return String(Math.floor(Math.random() * (max - min)) + min);
}

export function hashOtp(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function otpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

