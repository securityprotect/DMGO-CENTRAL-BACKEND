import { Worker } from 'bullmq';
import { processInstagramWebhookEvent } from '@/lib/services/instagramAutomation';
import { getRedisConnection, INSTAGRAM_WEBHOOK_QUEUE } from '@/lib/queue/instagram';
import { createLogger } from '@/lib/observability/logger';
import { connectToDatabase } from '@/lib/mongodb';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';

const logger = createLogger({ scope: 'instagram-worker' });
const connection = getRedisConnection() as any;

if (!connection) {
  logger.error('REDIS_URL is missing; worker cannot start');
  process.exitCode = 1;
} else {
  const heartbeat = async () => {
    try {
      await connectToDatabase();
      await SystemHealthLog.updateOne(
        { serviceName: 'instagram-worker' },
        {
          $set: {
            serviceName: 'instagram-worker',
            status: 'healthy',
            responseTimeMs: 0,
            lastIncident: '',
            uptimePercent: 99.9,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.warn({ error }, 'worker heartbeat failed');
    }
  };

  void heartbeat();
  const heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 30000));

  const worker = new Worker(
    INSTAGRAM_WEBHOOK_QUEUE,
    async (job) => {
      const { eventKey, traceId } = job.data as { eventKey: string; traceId: string };
      logger.info({ eventKey, traceId, jobId: job.id }, 'processing webhook event');
      return processInstagramWebhookEvent(eventKey, traceId, String(job.id || ''));
    },
    {
      connection: connection as any,
      concurrency: Number(process.env.WEBHOOK_WORKER_CONCURRENCY || 5),
    }
  );

  worker.on('completed', (job) => {
    logger.info({ eventKey: job.data.eventKey, jobId: job.id }, 'job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ eventKey: job?.data?.eventKey, jobId: job?.id, err }, 'job failed');
  });

  const shutdown = async () => {
    logger.info('shutting down worker');
    clearInterval(heartbeatTimer);
    await worker.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
