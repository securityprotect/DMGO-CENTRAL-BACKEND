import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { Subscription } from '@/lib/models/Subscription';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { Automation } from '@/lib/models/Automation';
import { PLANS } from '@/lib/billing/plans';
import { getPlanLimits } from '@/lib/billing/planLimits';
import { getDmUsage } from '@/lib/billing/usage';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();

  const plan = (user.plan as string) || 'starter';
  const limits = getPlanLimits(plan);

  const [records, subscription, accountsUsed, automationsUsed, dms] = await Promise.all([
    BillingRecord.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Subscription.findOne({ userId: user._id }).lean(),
    InstagramAccount.countDocuments({ userId: user._id }),
    Automation.countDocuments({ userId: user._id, status: 'active' }),
    getDmUsage(String(user._id)),
  ]);

  return NextResponse.json({
    currentPlan: {
      id: plan,
      name: PLANS[plan]?.name || 'Starter',
    },
    usage: {
      accounts: { used: accountsUsed, limit: limits.maxAccounts },
      automations: { used: automationsUsed, limit: limits.maxActiveAutomations },
      dms: {
        used: dms.used,
        limit: dms.limit,
        percent: dms.percent,
        overLimit: dms.overLimit,
        graceRemaining: dms.graceRemaining,
        unlimited: dms.unlimited,
      },
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
