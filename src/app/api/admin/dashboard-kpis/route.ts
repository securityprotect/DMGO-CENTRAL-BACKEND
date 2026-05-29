import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { QueueJob } from '@/lib/models/QueueJob';
import { ErrorLog } from '@/lib/models/ErrorLog';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const fourteenDays = new Date(now + 14 * 24 * 60 * 60 * 1000);

  const [queuePending, queueFailed, queueProcessing, openErrors, criticalErrors, webhooksLastHour, webhooksFailedLastHour, expiringTokens] = await Promise.all([
    QueueJob.countDocuments({ status: 'pending' }),
    QueueJob.countDocuments({ status: 'failed' }),
    QueueJob.countDocuments({ status: 'processing' }),
    ErrorLog.countDocuments({ status: { $in: ['open', 'investigating'] } }),
    ErrorLog.countDocuments({ status: 'open', severity: { $in: ['critical', 'high'] } }),
    WebhookLog.countDocuments({ createdAt: { $gte: oneHourAgo } }),
    WebhookLog.countDocuments({ createdAt: { $gte: oneHourAgo }, status: 'failed' }),
    InstagramAccount.countDocuments({ tokenExpiresAt: { $lte: fourteenDays, $gt: new Date(now) } }),
  ]);

  return NextResponse.json({
    queue: { pending: queuePending, processing: queueProcessing, failed: queueFailed, depth: queuePending + queueProcessing },
    errors: { open: openErrors, critical: criticalErrors },
    webhooks: { lastHour: webhooksLastHour, failedLastHour: webhooksFailedLastHour },
    tokens: { expiringSoon: expiringTokens },
    generatedAt: new Date().toISOString(),
  });
}
