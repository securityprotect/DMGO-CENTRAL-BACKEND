import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { QueueJob } from '@/lib/models/QueueJob';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';

const STALL_THRESHOLD_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get('status') || '').trim().toLowerCase();
  const queueName = (searchParams.get('queueName') || '').trim();
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
  const search = (searchParams.get('search') || '').trim().toLowerCase();

  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (status && status !== 'all') filter.status = status;
  if (queueName) filter.queueName = queueName;

  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const [rawRows, summaryCounts, completed24h, workerHeartbeat, queueNames] = await Promise.all([
    QueueJob.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    QueueJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    QueueJob.countDocuments({ status: 'completed', completedAt: { $gte: since24h } }),
    SystemHealthLog.findOne({ serviceName: 'instagram-worker' }).sort({ updatedAt: -1 }).lean(),
    QueueJob.distinct('queueName'),
  ]);

  const stallCount = await QueueJob.countDocuments({
    status: 'processing',
    lockedAt: { $lte: new Date(now - STALL_THRESHOLD_MS) },
  });

  const summary = {
    pending: 0,
    processing: 0,
    failed: 0,
    completed: 0,
    retrying: 0,
    delayed: 0,
    canceled: 0,
    stalled: stallCount,
    completed24h,
  };
  for (const entry of summaryCounts as Array<{ _id: string; count: number }>) {
    if (entry._id && entry._id in summary) (summary as any)[entry._id] = entry.count;
  }

  const filteredRows = (rawRows as Array<Record<string, unknown>>).filter((row) => {
    if (!search) return true;
    const haystack = [
      row.queueName,
      row.jobType,
      row.jobKey,
      row.errorMessage,
      JSON.stringify(row.payload || {}),
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });

  const rows = filteredRows.map((row: any) => {
    const createdAt = row.createdAt ? new Date(row.createdAt) : null;
    const lockedAt = row.lockedAt ? new Date(row.lockedAt) : null;
    const isStalled = row.status === 'processing' && lockedAt && now - lockedAt.getTime() > STALL_THRESHOLD_MS;
    return {
      id: String(row._id),
      queueName: row.queueName,
      jobType: row.jobType,
      jobKey: row.jobKey,
      status: row.status,
      retryCount: Number(row.retryCount || 0),
      maxAttempts: Number(row.maxAttempts || 5),
      availableAt: row.availableAt ? new Date(row.availableAt).toISOString() : null,
      lockedAt: lockedAt ? lockedAt.toISOString() : null,
      lockOwner: row.lockOwner || '',
      createdAt: createdAt ? createdAt.toISOString() : null,
      ageSec: createdAt ? Math.floor((now - createdAt.getTime()) / 1000) : 0,
      processingTimeMs: Number(row.processingTimeMs || 0),
      errorMessage: row.errorMessage || '',
      stalled: Boolean(isStalled),
    };
  });

  const workerLastSeen = workerHeartbeat ? new Date((workerHeartbeat as any).updatedAt) : null;
  const workerStatus = workerLastSeen
    ? (now - workerLastSeen.getTime() < 90_000 ? 'healthy' : now - workerLastSeen.getTime() < 300_000 ? 'degraded' : 'down')
    : 'down';

  return NextResponse.json({
    rows,
    summary,
    queueNames,
    worker: {
      status: workerStatus,
      lastHeartbeatAt: workerLastSeen ? workerLastSeen.toISOString() : null,
      heartbeatAgeSec: workerLastSeen ? Math.floor((now - workerLastSeen.getTime()) / 1000) : null,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  await connectToDatabase();

  const adminMeta = {
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    targetType: 'queue_job',
  };

  if (action === 'bulk_retry') {
    const filter = body.filter && typeof body.filter === 'object' ? body.filter : { status: 'failed' };
    const allowedKeys = ['status', 'queueName'];
    const safeFilter: Record<string, unknown> = {};
    for (const key of allowedKeys) if (key in filter) safeFilter[key] = (filter as any)[key];

    const result = await QueueJob.updateMany(safeFilter, {
      $set: { status: 'pending', lockedAt: null, lockOwner: '', errorMessage: '', availableAt: new Date() },
      $inc: { retryCount: 1 },
    });

    await logAdminAction({
      ...adminMeta,
      targetId: 'bulk',
      action: 'queue_bulk_retry',
      metadata: { filter: safeFilter, modified: (result as any).modifiedCount },
    });
    return NextResponse.json({ ok: true, modified: (result as any).modifiedCount });
  }

  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const job = await QueueJob.findById(id);
  if (!job) return NextResponse.json({ error: 'Queue job not found' }, { status: 404 });

  switch (action) {
    case 'retry': {
      (job as any).status = 'pending';
      (job as any).lockedAt = null;
      (job as any).lockOwner = '';
      (job as any).errorMessage = '';
      (job as any).availableAt = new Date();
      (job as any).retryCount = Number((job as any).retryCount || 0) + 1;
      await job.save();
      await logAdminAction({ ...adminMeta, targetId: id, action: 'queue_job_retry' });
      return NextResponse.json({ ok: true });
    }

    case 'cancel': {
      (job as any).status = 'canceled';
      (job as any).lockedAt = null;
      (job as any).lockOwner = '';
      await job.save();
      await logAdminAction({ ...adminMeta, targetId: id, action: 'queue_job_cancel' });
      return NextResponse.json({ ok: true });
    }

    case 'release_lock': {
      (job as any).lockedAt = null;
      (job as any).lockOwner = '';
      if ((job as any).status === 'processing') (job as any).status = 'pending';
      await job.save();
      await logAdminAction({ ...adminMeta, targetId: id, action: 'queue_job_release_lock' });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }
}
