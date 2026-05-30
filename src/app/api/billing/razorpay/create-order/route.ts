import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { isPaidPlan, resolveAmount, PLANS, type BillingCycle } from '@/lib/billing/plans';
import { createRazorpayOrder, razorpayConfigured, getRazorpayCreds } from '@/lib/billing/razorpay';

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to start a payment.' }, { status: 401 });
  }

  if (!razorpayConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not configured yet. Please try again shortly.' },
      { status: 503 },
    );
  }

  let body: { planId?: string; cycle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const planId = String(body.planId || '').trim();
  const cycle: BillingCycle = body.cycle === 'annual' ? 'annual' : 'monthly';

  if (!isPaidPlan(planId)) {
    return NextResponse.json({ error: 'Unknown or non-purchasable plan.' }, { status: 400 });
  }

  // SECURITY: amount comes ONLY from the server-side plan table.
  const amount = resolveAmount(planId, cycle);
  if (amount == null) {
    return NextResponse.json({ error: 'Could not resolve plan price.' }, { status: 400 });
  }

  const currency = process.env.RAZORPAY_CURRENCY || 'INR';
  const receipt = `dmgo_${planId}_${String(user._id).slice(-8)}_${cycle}`.slice(0, 40);

  try {
    const order = await createRazorpayOrder({
      amountInRupees: amount,
      currency,
      receipt,
      notes: {
        userId: String(user._id),
        planId,
        cycle,
        email: user.email || '',
      },
    });

    const { keyId } = getRazorpayCreds();
    return NextResponse.json({
      orderId: order.id,
      amount: order.amount, // paise, for Razorpay Checkout
      currency: order.currency,
      keyId,
      planId,
      planName: PLANS[planId].name,
      cycle,
      prefill: { name: user.name || '', email: user.email || '', contact: (user as { phone?: string }).phone || '' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create order';
    console.error('[billing/create-order]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
