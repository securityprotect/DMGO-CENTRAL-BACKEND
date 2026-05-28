import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: { id: String(user._id), name: user.name, email: user.email, plan: user.plan },
  });
}
