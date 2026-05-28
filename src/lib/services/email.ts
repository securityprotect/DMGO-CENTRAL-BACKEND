import { Resend } from 'resend';

type EmailResult = { sent: true } | { sent: false; reason: string };

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getFromAddress() {
  return process.env.EMAIL_FROM || 'Team DMGo <team@dmgo.in>';
}

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const resend = getResendClient();
  if (!resend) return { sent: false, reason: 'RESEND_API_KEY is missing' };

  try {
    const result = await resend.emails.send({
      from: getFromAddress(),
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    if (result?.error) {
      return { sent: false, reason: result.error.message || 'Resend API error' };
    }
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resend send failed';
    return { sent: false, reason: message };
  }
}

function otpEmailTemplate(params: { title: string; intro: string; otp: string; note: string }) {
  const { title, intro, otp, note } = params;
  return {
    subject: title,
    text: `${intro}\n\nYour verification code is: ${otp}\n\n${note}\n\n- Team DmGo`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7ff;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f5;border-radius:14px;padding:24px;">
          <h2 style="margin:0 0 12px;color:#171a2b;">${title}</h2>
          <p style="margin:0 0 18px;color:#4c5470;line-height:1.6;">${intro}</p>
          <div style="margin:18px 0;padding:14px 18px;background:#f0f2ff;border:1px dashed #7b82ff;border-radius:10px;text-align:center;">
            <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:#4f57ff;">${otp}</span>
          </div>
          <p style="margin:0;color:#4c5470;line-height:1.6;">${note}</p>
          <p style="margin:22px 0 0;color:#7d859f;font-size:13px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      </div>
    `,
  };
}

export async function sendSignupOtpEmail(to: string, otp: string) {
  const template = otpEmailTemplate({
    title: 'Verify your DmGo account',
    intro: 'Welcome to DmGo. Please use the verification code below to complete your account creation.',
    otp,
    note: 'This code expires in 10 minutes.',
  });
  return sendEmail({ to, ...template });
}

export async function sendForgotPasswordOtpEmail(to: string, otp: string) {
  const template = otpEmailTemplate({
    title: 'DmGo password reset verification code',
    intro: 'We received a request to reset your DmGo password.',
    otp,
    note: 'Enter this code to continue resetting your password. The code expires in 10 minutes.',
  });
  return sendEmail({ to, ...template });
}

export async function sendWelcomeEmail(to: string, name: string) {
  return sendEmail({
    to,
    subject: 'Welcome to DmGo',
    text: `Hi ${name},\n\nWelcome to DmGo. Your account is ready.\n\nYou can now connect your Instagram account and start automations.\n\n- Team DmGo`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7ff;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f5;border-radius:14px;padding:24px;">
          <h2 style="margin:0 0 12px;color:#171a2b;">Welcome to DmGo, ${name}</h2>
          <p style="margin:0;color:#4c5470;line-height:1.7;">
            Your account has been created successfully. You can now connect your Instagram account,
            configure keyword automations, and start handling DMs at scale.
          </p>
          <p style="margin:18px 0 0;color:#4c5470;line-height:1.7;">Thanks for choosing DmGo.</p>
          <p style="margin:22px 0 0;color:#7d859f;font-size:13px;">Team DmGo</p>
        </div>
      </div>
    `,
  });
}
