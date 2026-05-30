import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { verifyCheckoutSignature, fetchRazorpayPayment } from '@/lib/billing/razorpay';
import { activatePaidPlan } from '@/lib/billing/activate';
import { isPaidPlan, resolveAmount, type BillingCycle } from '@/lib/billing/plans';

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  }

  let body: {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
    planId?: string;
    cycle?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const orderId = String(body.razorpay_order_id || '');
  const paymentId = String(body.razorpay_payment_id || '');
  const signature = String(body.razorpay_signature || '');
  const planId = String(body.planId || '');
  const cycle: BillingCycle = body.cycle === 'annual' ? 'annual' : 'monthly';

  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ error: 'Missing payment confirmation fields.' }, { status: 400 });
  }
  if (!isPaidPlan(planId)) {
    return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 });
  }

  // CRITICAL: verify the signature before trusting anything.
  const valid = verifyCheckoutSignature({ orderId, paymentId, signature });
  if (!valid) {
    console.warn('[billing/verify] signature mismatch', { orderId, paymentId, userId: String(user._id) });
    return NextResponse.json({ error: 'Payment verification failed. Do not retry — contact support.' }, { status: 400 });
  }

  const amount = resolveAmount(planId, cycle);
  if (amount == null) {
    return NextResponse.json({ error: 'Could not resolve plan price.' }, { status: 400 });
  }

  try {
    // Pull payer contact (email + mobile) from Razorpay — best-effort.
    const payment = await fetchRazorpayPayment(paymentId);
    const result = await activatePaidPlan({
      userId: String(user._id),
      planId,
      cycle,
      amountInRupees: amount,
      currency: process.env.RAZORPAY_CURRENCY || 'INR',
      paymentId,
      orderId,
      method: payment?.method || 'checkout',
      customerEmail: payment?.email || user.email || '',
      customerContact: payment?.contact || '',
      customerName: user.name || '',
    });

    return NextResponse.json({
      success: true,
      alreadyProcessed: result.alreadyProcessed,
      planId,
      cycle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Activation failed';
    console.error('[billing/verify] activation error:', message);
    return NextResponse.json({ error: 'Payment captured but activation failed. Our team has been notified.' }, { status: 500 });
  }
}
