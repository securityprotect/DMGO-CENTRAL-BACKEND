import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';

function toTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const activity = await Activity.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100).lean();

  return NextResponse.json({
    activity: activity.map((a) => ({
      id: String(a._id),
      username: a.username,
      account: a.account,
      automation: a.automation,
      keyword: a.keyword,
      dmPreview: a.dmPreview,
      status: a.status,
      timestamp: toTime(new Date(a.createdAt)),
      createdAt: new Date(a.createdAt).toISOString(),
      retries: a.retries,
      failReason: a.failReason,
    })),
  });
}

export async function DELETE() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const result = await Activity.deleteMany({ userId: user._id });
  return NextResponse.json({ ok: true, deletedCount: result.deletedCount ?? 0 });
}
