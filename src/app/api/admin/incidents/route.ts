import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { SupportTicket } from '@/lib/models/SupportTicket';
import { Activity } from '@/lib/models/Activity';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();

  const [tickets, failed] = await Promise.all([
    SupportTicket.find({ status: { $in: ['open', 'in_progress'] } }).sort({ createdAt: -1 }).limit(200).lean(),
    Activity.find({ status: { $in: ['failed', 'rate-limited'] } }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);

  const incidents = [
    ...tickets.map((t: any) => ({
      id: `TICKET-${String(t._id)}`,
      source: 'support_ticket',
      title: t.subject,
      queue: t.category || 'general',
      severity: t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low',
      state: t.status,
      notes: t.message,
      createdAt: new Date(t.createdAt).toISOString(),
    })),
    ...failed.map((f: any) => ({
      id: `ACT-${String(f._id)}`,
      source: 'activity_failure',
      title: `DM delivery failed for ${f.username}`,
      queue: 'automation',
      severity: f.status === 'rate-limited' ? 'high' : 'medium',
      state: 'open',
      notes: f.failReason || 'No fail reason',
      createdAt: new Date(f.createdAt).toISOString(),
    })),
  ];

  return NextResponse.json({ incidents });
}

