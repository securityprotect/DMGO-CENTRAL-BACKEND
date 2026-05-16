import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const accounts = await InstagramAccount.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ accounts });
}
