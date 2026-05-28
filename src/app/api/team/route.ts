import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { TeamMember } from '@/lib/models/TeamMember';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await connectToDatabase();
  const members = await TeamMember.find({ ownerUserId: user._id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ members });
}

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  if (!body.email) return NextResponse.json({ error: 'Email required' }, { status: 400 });
  await connectToDatabase();
  const member = await TeamMember.create({ ownerUserId: user._id, email: body.email.toLowerCase(), name: body.name || '', role: body.role || 'viewer', status: 'invited' });
  return NextResponse.json({ member }, { status: 201 });
}
