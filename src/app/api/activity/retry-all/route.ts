import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';
<<<<<<< HEAD
import { safeQueueJob } from '@/lib/ops/logging';
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b

export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await connectToDatabase();
<<<<<<< HEAD
  const result = await Activity.updateMany({ userId: user._id, status: { $in: ['failed', 'rate-limited'] } }, { $set: { status: 'queued' }, $inc: { retries: 1 } });
  await safeQueueJob({
    queueName: 'dm-retry',
    userId: user._id,
    jobType: 'Retry All Failed DMs',
    status: 'pending',
    payload: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
  });
=======
  await Activity.updateMany({ userId: user._id, status: { $in: ['failed', 'rate-limited'] } }, { $set: { status: 'queued' }, $inc: { retries: 1 } });
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
  return NextResponse.json({ ok: true });
}
