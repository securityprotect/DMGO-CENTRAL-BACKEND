import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { SupportTicket } from '@/lib/models/SupportTicket';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();
  const tickets = await SupportTicket.find({}).sort({ createdAt: -1 }).limit(500).lean();
  return NextResponse.json({ tickets });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  await connectToDatabase();

  const ticket = await SupportTicket.findByIdAndUpdate(
    body.id,
    { $set: { status: body.status, priority: body.priority ?? undefined, category: body.category ?? undefined } },
    { new: true },
  ).lean();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'ticket_updated',
    targetType: 'ticket',
    targetId: String(ticket._id),
    metadata: { status: body.status, priority: body.priority, category: body.category },
  });

  return NextResponse.json({ ticket });
}

