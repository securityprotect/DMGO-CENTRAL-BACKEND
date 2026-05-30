import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { User } from '@/lib/models/User';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();

  const rows = await BillingRecord.find({}).sort({ createdAt: -1 }).limit(300).lean();

  // Join account email/name so admins can see who paid even if the gateway
  // contact differs from the signup email.
  const userIds = Array.from(new Set(rows.map((r: any) => String(r.userId))));
  const users = await User.find({ _id: { $in: userIds } }).select('email name').lean();
  const userMap = new Map(users.map((u: any) => [String(u._id), u]));

  return NextResponse.json({
    records: rows.map((r: any) => {
      const u = userMap.get(String(r.userId));
      return {
        id: String(r._id),
        userId: String(r.userId),
        accountEmail: u?.email || '',
        accountName: u?.name || '',
        customerEmail: r.customerEmail || '',
        customerContact: r.customerContact || '',
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        type: r.type,
        planId: r.planId || '',
        billingCycle: r.billingCycle || '',
        description: r.description,
        providerRef: r.providerRef,
        transactionId: r.transactionId || '',
        paymentMethod: r.paymentMethod || '',
        paidAt: r.paidAt ? new Date(r.paidAt).toISOString() : null,
        createdAt: new Date(r.createdAt).toISOString(),
      };
    }),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  await connectToDatabase();

  const user = await User.findById(body.userId).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const created = await BillingRecord.create({
    userId: body.userId,
    amount: Number(body.amount || 0),
    currency: body.currency || 'INR',
    status: body.status || 'paid',
    type: body.type || 'invoice',
    description: body.description || '',
    providerRef: body.providerRef || '',
  });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'billing_record_created',
    targetType: 'billing',
    targetId: String(created._id),
  });

  return NextResponse.json({ id: String(created._id) }, { status: 201 });
}

