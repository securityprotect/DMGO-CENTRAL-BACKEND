import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';

export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await connectToDatabase();
  await Activity.updateMany({ userId: user._id, status: { $in: ['failed', 'rate-limited'] } }, { $set: { status: 'queued' }, $inc: { retries: 1 } });
  return NextResponse.json({ ok: true });
}
