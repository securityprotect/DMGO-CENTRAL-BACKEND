import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { SupportTicket } from '@/lib/models/SupportTicket';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await connectToDatabase();
  const tickets = await SupportTicket.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ tickets });
}

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  if (!body.subject || !body.message) return NextResponse.json({ error: 'Subject and message required' }, { status: 400 });
  await connectToDatabase();
  const ticket = await SupportTicket.create({ userId: user._id, subject: body.subject, category: body.category || 'general', priority: body.priority || 'medium', message: body.message });
  return NextResponse.json({ ticket }, { status: 201 });
}
