import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { AdminAuditLog } from '@/lib/models/AdminAuditLog';

export async function requireAdmin() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const allowedEmails = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const byRole = String((user as any).role || '') === 'admin';
  const byEmail = allowedEmails.includes(String((user as any).email || '').toLowerCase());

  if (!byRole && !byEmail) {
    return { error: NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 }) };
  }

  return { user };
}

export async function logAdminAction(input: {
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await connectToDatabase();
  await AdminAuditLog.create({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata || {},
  });
}
