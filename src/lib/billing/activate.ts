import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { Subscription } from '@/lib/models/Subscription';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { Notification } from '@/lib/models/Notification';
import { PLANS, periodEnd, type BillingCycle } from '@/lib/billing/plans';
import { sendPaymentReceiptEmail } from '@/lib/services/email';

interface ActivateParams {
  userId: string;
  planId: string;
  cycle: BillingCycle;
  amountInRupees: number;
  currency: string;
  paymentId: string;
  orderId: string;
  method?: string;
  customerEmail?: string;
  customerContact?: string;
  customerName?: string;
}

/**
 * Activate (or extend) a paid plan after a verified payment.
 *
 * IDEMPOTENT: keyed on the Razorpay paymentId. If a BillingRecord with this
 * transactionId already exists we return early, so it's safe for BOTH the
 * client-side verify call AND the server-side webhook to invoke this for the
 * same payment — whichever lands first wins, the second is a no-op.
 */
export async function activatePaidPlan(params: ActivateParams): Promise<{ activated: boolean; alreadyProcessed: boolean }> {
  const { userId, planId, cycle, amountInRupees, currency, paymentId, orderId, method } = params;
  await connectToDatabase();

  const existing = await BillingRecord.findOne({ transactionId: paymentId }).lean();
  if (existing) {
    return { activated: false, alreadyProcessed: true };
  }

  const plan = PLANS[planId];
  const now = new Date();
  const endsAt = periodEnd(now, cycle);

  await BillingRecord.create({
    userId,
    amount: amountInRupees,
    currency,
    status: 'paid',
    type: 'invoice',
    description: `DmGo ${plan?.name || planId} (${cycle}) subscription`,
    providerRef: orderId,
    gateway: 'razorpay',
    transactionId: paymentId,
    paymentMethod: method || '',
    paidAt: now,
    renewalDate: endsAt,
    customerEmail: params.customerEmail || '',
    customerContact: params.customerContact || '',
    customerName: params.customerName || '',
    planId,
    billingCycle: cycle,
  });

  await Subscription.findOneAndUpdate(
    { userId },
    {
      userId,
      plan: planId,
      status: 'active',
      gateway: 'razorpay',
      externalId: orderId,
      startedAt: now,
      endsAt,
      renewalStatus: 'manual',
      renewalDate: endsAt,
      canceledAt: null,
    },
    { upsert: true, new: true },
  );

  const user = await User.findByIdAndUpdate(userId, { plan: planId }, { new: true }).lean();

  await Notification.create({
    userId,
    type: 'billing',
    title: 'Payment successful',
    message: `Your ${plan?.name || planId} (${cycle}) plan is now active.`,
    severity: 'success',
  }).catch(() => undefined);

  if (user?.email) {
    await sendPaymentReceiptEmail({
      to: user.email,
      name: user.name || 'there',
      planName: plan?.name || planId,
      cycle,
      amount: amountInRupees,
      currency,
      paymentId,
      paidAt: now,
      nextRenewal: endsAt,
    }).catch((err) => console.error('[billing] receipt email failed:', err));
  }

  return { activated: true, alreadyProcessed: false };
}
