import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function DELETE(_: Request, context: any) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = String(context?.params?.id || '');

  await connectToDatabase();
  const deleted = await InstagramAccount.findOneAndDelete({ _id: id, userId: user._id });
  if (!deleted) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
