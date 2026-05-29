import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { QueueJob } from '@/lib/models/QueueJob';
import { ErrorLog } from '@/lib/models/ErrorLog';

function statusFromHeartbeat(lastSeenAt?: Date | string | null, fallback = 'down') {
  if (!lastSeenAt) return fallback;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (diff < 90_000) return 'healthy';
  if (diff < 300_000) return 'degraded';
  return 'down';
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  await SystemHealthLog.updateOne(
    { serviceName: 'dmgo-backend' },
    {
      $set: {
        serviceName: 'dmgo-backend',
        status: 'healthy',
        responseTimeMs: 0,
        lastIncident: '',
        uptimePercent: 99.9,
      },
    },
    { upsert: true }
  );
  const [workerHeartbeat, backendHeartbeat, lastWebhook, pendingJobs, failedJobs, errorCount] = await Promise.all([
    SystemHealthLog.findOne({ serviceName: 'instagram-worker' }).sort({ createdAt: -1 }).lean(),
    SystemHealthLog.findOne({ serviceName: 'dmgo-backend' }).sort({ createdAt: -1 }).lean(),
    WebhookLog.findOne({ source: 'instagram' }).sort({ createdAt: -1 }).lean(),
    QueueJob.countDocuments({ status: { $in: ['pending', 'processing', 'retrying', 'delayed'] } }),
    QueueJob.countDocuments({ status: 'failed' }),
    ErrorLog.countDocuments({ status: { $in: ['open', 'investigating'] } }),
  ]);

  const workerStatus = statusFromHeartbeat((workerHeartbeat as any)?.updatedAt, 'down');
  const backendStatus = statusFromHeartbeat((backendHeartbeat as any)?.updatedAt, 'healthy');
  const webhookStatus = lastWebhook ? statusFromHeartbeat((lastWebhook as any)?.createdAt, 'healthy') : 'down';

  return NextResponse.json({
    overallStatus:
      [backendStatus, workerStatus, webhookStatus].includes('down')
        ? 'critical'
        : [backendStatus, workerStatus, webhookStatus].includes('degraded')
          ? 'warning'
          : 'healthy',
    backend: {
      status: backendStatus,
      lastHeartbeatAt: backendHeartbeat ? new Date((backendHeartbeat as any).updatedAt).toISOString() : null,
      uptimeSeconds: process.uptime(),
    },
    worker: {
      status: workerStatus,
      lastHeartbeatAt: workerHeartbeat ? new Date((workerHeartbeat as any).updatedAt).toISOString() : null,
      queue: 'instagram-webhook-events',
    },
    queueStore: {
      configured: true,
      status: 'healthy',
      backend: 'mongodb',
    },
    webhook: {
      status: webhookStatus,
      lastReceivedAt: lastWebhook ? new Date((lastWebhook as any).createdAt).toISOString() : null,
      pendingJobs,
      failedJobs,
    },
    incidents: {
      openErrors: errorCount,
    },
    services: [
      { name: 'Backend API', status: backendStatus, detail: 'Render web service' },
      { name: 'Instagram Worker', status: workerStatus, detail: 'Mongo polling worker' },
      { name: 'Mongo Queue', status: 'healthy', detail: 'Queue stored in MongoDB' },
      { name: 'Instagram Webhooks', status: webhookStatus, detail: 'Latest webhook intake' },
    ],
  });
}
