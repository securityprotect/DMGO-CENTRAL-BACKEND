import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) return NextResponse.json({ error: 'Missing passwords' }, { status: 400 });
  await connectToDatabase();
  const fresh = await User.findById(user._id);
  if (!fresh) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const ok = await bcrypt.compare(currentPassword, fresh.passwordHash);
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  fresh.passwordHash = await bcrypt.hash(newPassword, 10);
  await fresh.save();
  return NextResponse.json({ ok: true });
}
