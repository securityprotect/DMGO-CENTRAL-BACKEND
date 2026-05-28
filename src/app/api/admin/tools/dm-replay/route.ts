import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';
<<<<<<< HEAD
import { safeQueueJob } from '@/lib/ops/logging';
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  const activityId = String(body.activityId || '');
  if (!activityId) return NextResponse.json({ error: 'activityId is required' }, { status: 400 });

  await connectToDatabase();
  const activity = await Activity.findById(activityId);
  if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  activity.status = 'queued';
  activity.retries = Number(activity.retries || 0) + 1;
  activity.failReason = '';
  await activity.save();
<<<<<<< HEAD
  await safeQueueJob({
    queueName: 'dm-replay',
    userId: activity.userId,
    jobType: 'Admin DM Replay',
    status: 'pending',
    retryCount: Number(activity.retries || 0),
    payload: { activityId },
  });
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'dm_replay_triggered',
    targetType: 'activity',
    targetId: activityId,
  });

  return NextResponse.json({ ok: true });
}
<<<<<<< HEAD
=======

>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
