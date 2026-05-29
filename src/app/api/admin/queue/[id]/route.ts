import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { QueueJob } from '@/lib/models/QueueJob';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  await connectToDatabase();
  const job = await QueueJob.findById(id).lean();
  if (!job) return NextResponse.json({ error: 'Queue job not found' }, { status: 404 });

  return NextResponse.json({
    id: String((job as any)._id),
    queueName: (job as any).queueName,
    jobType: (job as any).jobType,
    jobKey: (job as any).jobKey,
    status: (job as any).status,
    retryCount: Number((job as any).retryCount || 0),
    maxAttempts: Number((job as any).maxAttempts || 5),
    availableAt: (job as any).availableAt,
    lockedAt: (job as any).lockedAt,
    lockOwner: (job as any).lockOwner,
    payload: (job as any).payload || {},
    errorMessage: (job as any).errorMessage || '',
    startedAt: (job as any).startedAt,
    completedAt: (job as any).completedAt,
    processingTimeMs: Number((job as any).processingTimeMs || 0),
    createdAt: (job as any).createdAt,
    updatedAt: (job as any).updatedAt,
  });
}
