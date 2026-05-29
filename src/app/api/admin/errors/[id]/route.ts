import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { ErrorLog } from '@/lib/models/ErrorLog';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  await connectToDatabase();
  const error = await ErrorLog.findById(id).lean();
  if (!error) return NextResponse.json({ error: 'Error log not found' }, { status: 404 });

  return NextResponse.json({
    id: String((error as any)._id),
    severity: (error as any).severity,
    module: (error as any).module,
    errorType: (error as any).errorType || 'Error',
    errorMessage: (error as any).errorMessage,
    stackTrace: (error as any).stackTrace || '',
    occurrences: Number((error as any).occurrences || 1),
    firstSeenAt: (error as any).firstSeenAt,
    lastSeenAt: (error as any).lastSeenAt,
    status: (error as any).status,
    affectedUsers: Array.isArray((error as any).affectedUsers) ? (error as any).affectedUsers : [],
    retryPayload: (error as any).retryPayload || {},
    userId: (error as any).userId ? String((error as any).userId) : null,
  });
}
