import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { Subscription } from '@/lib/models/Subscription';
import { PLANS } from '@/lib/billing/plans';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();

  const [records, subscription] = await Promise.all([
    BillingRecord.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Subscription.findOne({ userId: user._id }).lean(),
  ]);

  return NextResponse.json({
    currentPlan: {
      id: user.plan || 'starter',
      name: PLANS[user.plan as string]?.name || 'Starter',
    },
    subscription: subscription
      ? {
          status: subscription.status,
          plan: subscription.plan,
          startedAt: subscription.startedAt,
          endsAt: subscription.endsAt,
          renewalDate: subscription.renewalDate,
        }
      : null,
    invoices: records.map((r) => ({
      id: String(r._id),
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      description: r.description,
      transactionId: r.transactionId,
      paymentMethod: r.paymentMethod,
      customerEmail: r.customerEmail,
      customerContact: r.customerContact,
      paidAt: r.paidAt,
      renewalDate: r.renewalDate,
      createdAt: r.createdAt,
    })),
  });
}
