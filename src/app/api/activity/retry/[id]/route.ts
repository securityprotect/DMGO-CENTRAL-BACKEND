import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();

  const updated = await Activity.findOneAndUpdate(
    { _id: id, userId: user._id },
    { $set: { status: 'queued' }, $inc: { retries: 1 } },
    { new: true }
  );

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
