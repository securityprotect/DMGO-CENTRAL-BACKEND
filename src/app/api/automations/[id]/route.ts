import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  await connectToDatabase();

  const updated = await Automation.findOneAndUpdate(
    { _id: id, userId: user._id },
    { $set: body },
    { new: true }
  );

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await connectToDatabase();
  await Automation.deleteOne({ _id: id, userId: user._id });
  return NextResponse.json({ ok: true });
}
