import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const body = await req.json();

  await connectToDatabase();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name || '').trim();
  if (body.email !== undefined) updates.email = String(body.email || '').toLowerCase().trim();
  if (body.role !== undefined) updates.role = String(body.role);
  if (body.status !== undefined) updates.status = String(body.status);
  if (body.plan !== undefined) updates.plan = String(body.plan);

  const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'user_updated',
    targetType: 'user',
    targetId: id,
    metadata: updates,
  });

  return NextResponse.json({ ok: true, user });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;

  await connectToDatabase();
  const user = await User.findByIdAndUpdate(id, { $set: { status: 'deleted' } }, { new: true }).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'user_soft_deleted',
    targetType: 'user',
    targetId: id,
  });

  return NextResponse.json({ ok: true });
}
