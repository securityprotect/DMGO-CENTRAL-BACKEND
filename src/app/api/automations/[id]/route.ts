import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';
import { getPlanLimits, isUnlimited } from '@/lib/billing/planLimits';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  await connectToDatabase();

  // Re-activation guard: turning a paused/draft automation back to 'active'
  // counts against the plan cap, same as creating one.
  if (body?.status === 'active') {
    const current = await Automation.findOne({ _id: id, userId: user._id }).select('status').lean();
    if (current && current.status !== 'active') {
      const plan = (user.plan as string) || 'starter';
      const limit = getPlanLimits(plan).maxActiveAutomations;
      if (!isUnlimited(limit)) {
        const activeCount = await Automation.countDocuments({ userId: user._id, status: 'active' });
        if (activeCount >= limit) {
          return NextResponse.json(
            {
              error: `Your ${plan} plan allows ${limit} active automations. Upgrade for unlimited automations.`,
              code: 'automation_limit',
              limit,
              plan,
            },
            { status: 403 }
          );
        }
      }
    }
  }

  const updated = await Automation.findOneAndUpdate(
    { _id: id, userId: user._id },
    { $set: body },
    { new: true }
  );

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();
  await Automation.deleteOne({ _id: id, userId: user._id });
  return NextResponse.json({ ok: true });
}
