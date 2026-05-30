import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/billing/razorpay';
import { activatePaidPlan } from '@/lib/billing/activate';
import { isPaidPlan, type BillingCycle } from '@/lib/billing/plans';

// Razorpay must receive the raw body byte-for-byte to verify the signature,
// so we read text() and never parse before verifying.
export async function POST(req: Request) {
  const signature = req.headers.get('x-razorpay-signature') || '';
  const rawBody = await req.text();

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[billing/webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[billing/webhook] signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // We only act on a successful capture. Always 200 afterwards so Razorpay
  // doesn't retry storms — failures are logged, not surfaced as 5xx.
  try {
    if (event?.event === 'payment.captured' || event?.event === 'order.paid') {
      const payment = event?.payload?.payment?.entity;
      const order = event?.payload?.order?.entity;
      const notes = payment?.notes || order?.notes || {};

      const userId = String(notes.userId || '');
      const planId = String(notes.planId || '');
      const cycle: BillingCycle = notes.cycle === 'annual' ? 'annual' : 'monthly';
      const paymentId = String(payment?.id || '');
      const orderId = String(payment?.order_id || order?.id || '');
      const amountInRupees = Math.round(Number(payment?.amount || order?.amount || 0) / 100);
      const currency = String(payment?.currency || order?.currency || 'INR');
      const method = String(payment?.method || 'webhook');

      if (userId && isPaidPlan(planId) && paymentId && amountInRupees > 0) {
        const result = await activatePaidPlan({
          userId,
          planId,
          cycle,
          amountInRupees,
          currency,
          paymentId,
          orderId,
          method,
          customerEmail: String(payment?.email || notes.email || ''),
          customerContact: String(payment?.contact || ''),
        });
        console.log('[billing/webhook] processed', { paymentId, ...result });
      } else {
        console.warn('[billing/webhook] missing/invalid notes — skipped', { userId, planId, paymentId });
      }
    }
  } catch (error) {
    console.error('[billing/webhook] handler error:', error);
  }

  return NextResponse.json({ received: true });
}
