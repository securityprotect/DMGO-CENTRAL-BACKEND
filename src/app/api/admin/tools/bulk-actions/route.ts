import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { Automation } from '@/lib/models/Automation';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  const action = String(body.action || '');
  const userIds: string[] = Array.isArray(body.userIds) ? body.userIds : [];
  if (!action || userIds.length === 0) {
    return NextResponse.json({ error: 'action and userIds are required' }, { status: 400 });
  }

  await connectToDatabase();
  let result: Record<string, unknown> = {};

  if (action === 'reset_tokens') {
    const r = await InstagramAccount.updateMany({ userId: { $in: userIds } }, { $set: { tokenExpiresAt: new Date(0) } });
    result = { modifiedCount: r.modifiedCount };
  } else if (action === 'pause_campaigns') {
    const r = await Automation.updateMany({ userId: { $in: userIds } }, { $set: { status: 'paused' } });
    result = { modifiedCount: r.modifiedCount };
  } else if (action === 'refresh_cooldowns') {
    const r = await Automation.updateMany({ userId: { $in: userIds } }, { $set: { cooldownHours: 0 } });
    result = { modifiedCount: r.modifiedCount };
  } else {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'bulk_action_executed',
    targetType: 'bulk',
    targetId: action,
    metadata: { action, userIds, ...result },
  });

  return NextResponse.json({ ok: true, action, ...result });
}

