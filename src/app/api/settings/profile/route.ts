import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

export async function PATCH(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  await connectToDatabase();
  const updated = await User.findByIdAndUpdate(user._id, { $set: { name: body.name || user.name, email: (body.email || user.email).toLowerCase() } }, { new: true }).lean();
  return NextResponse.json({ user: updated });
}
