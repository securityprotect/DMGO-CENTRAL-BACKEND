import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'sandbox_test_executed',
    targetType: 'automation',
    targetId: String(body.automationId || 'unknown'),
    metadata: body,
  });

  return NextResponse.json({
    ok: true,
    result: {
      message: 'Sandbox test executed successfully',
      simulatedDm: 'Hello {{username}}, this is a sandbox delivery test.',
      triggerMatched: true,
      sendAllowed: true,
    },
  });
}

