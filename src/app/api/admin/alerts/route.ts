import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { SystemAlert } from '@/lib/models/SystemAlert';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();

  const alerts = await SystemAlert.find({}).sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ alerts });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  await connectToDatabase();

  const alert = await SystemAlert.create({
    level: body.level || 'info',
    title: body.title || 'System notification',
    message: body.message || '',
    status: body.status || 'open',
  });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'system_alert_created',
    targetType: 'alert',
    targetId: String(alert._id),
  });

  return NextResponse.json({ id: String(alert._id) }, { status: 201 });
}

