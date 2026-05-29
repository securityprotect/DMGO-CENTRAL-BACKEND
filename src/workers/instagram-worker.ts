import { connectToDatabase } from '@/lib/mongodb';
import { QueueJob } from '@/lib/models/QueueJob';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';
import { createLogger } from '@/lib/observability/logger';
import { processInstagramWebhookEvent } from '@/lib/services/instagramAutomation';
import { INSTAGRAM_WEBHOOK_QUEUE } from '@/lib/queue/instagram';

const logger = createLogger({ scope: 'instagram-worker' });
const workerId = `${process.pid}-${Date.now()}`;
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 2000);
const heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 30000);
const maxConcurrentJobs = Math.max(1, Number(process.env.WEBHOOK_WORKER_CONCURRENCY || 1));

let activeJobs = 0;
let shuttingDown = false;

async function writeHeartbeat(status: 'healthy' | 'degraded' | 'down' = 'healthy', lastIncident = '') {
  try {
    await connectToDatabase();
    await SystemHealthLog.updateOne(
      { serviceName: 'instagram-worker' },
      {
        $set: {
          serviceName: 'instagram-worker',
          status,
          responseTimeMs: 0,
          lastIncident,
          uptimePercent: status === 'healthy' ? 99.9 : status === 'degraded' ? 92 : 75,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    logger.warn({ error }, 'heartbeat write failed');
  }
}

function backoffMs(retryCount: number) {
  const base = Number(process.env.WEBHOOK_JOB_BACKOFF_MS || 1000);
  return Math.min(15 * 60 * 1000, base * Math.pow(2, Math.max(0, retryCount - 1)));
}

async function claimNextJob() {
  const now = new Date();
  return QueueJob.findOneAndUpdate(
    {
      queueName: INSTAGRAM_WEBHOOK_QUEUE,
      status: { $in: ['pending', 'retrying'] },
      availableAt: { $lte: now },
    },
    {
      $set: {
        status: 'processing',
        startedAt: now,
        lockedAt: now,
        lockOwner: workerId,
      },
      $inc: { retryCount: 1 },
    },
    {
      sort: { availableAt: 1, createdAt: 1 },
      new: true,
    }
  ).lean();
}

async function processJob(job: any) {
  const eventKey = String(job.jobKey || job.payload?.eventKey || '');
  const traceId = String(job.payload?.traceId || '');
  logger.info({ eventKey, traceId, jobId: String(job._id) }, 'processing job');

  try {
    const result = await processInstagramWebhookEvent(eventKey, traceId, String(job._id));
    const terminalReason = String(result?.reason || '');
    if (!result?.ok && terminalReason === 'not_claimed') {
      await QueueJob.updateOne(
        { _id: job._id, lockOwner: workerId },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            processingTimeMs: Date.now() - new Date(job.startedAt || Date.now()).getTime(),
            errorMessage: '',
          },
        }
      );
      logger.info({ eventKey, result }, 'job skipped because event was already claimed');
      return;
    }
    if (!result?.ok && terminalReason) {
      await QueueJob.updateOne(
        { _id: job._id, lockOwner: workerId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            processingTimeMs: Date.now() - new Date(job.startedAt || Date.now()).getTime(),
            errorMessage: terminalReason,
          },
        }
      );
      logger.warn({ eventKey, result }, 'job completed with terminal failure');
      return;
    }
    await QueueJob.updateOne(
      { _id: job._id, lockOwner: workerId },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          processingTimeMs: Date.now() - new Date(job.startedAt || Date.now()).getTime(),
          errorMessage: '',
        },
      }
    );
    logger.info({ eventKey, result }, 'job completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown job error';
    const currentRetry = Number(job.retryCount || 0);
    const shouldRetry = currentRetry < Number(job.maxAttempts || 5);
    const nextStatus = shouldRetry ? 'retrying' : 'failed';
    const nextAvailableAt = shouldRetry ? new Date(Date.now() + backoffMs(currentRetry)) : null;

    await QueueJob.updateOne(
      { _id: job._id, lockOwner: workerId },
      {
        $set: {
          status: nextStatus,
          completedAt: shouldRetry ? null : new Date(),
          availableAt: nextAvailableAt || job.availableAt || new Date(),
          errorMessage: message,
        },
      }
    );

    logger.error({ eventKey, error }, 'job failed');
  }
}

async function pollLoop() {
  if (shuttingDown) return;
  if (activeJobs >= maxConcurrentJobs) return;

  const job = await claimNextJob();
  if (!job) return;

  activeJobs += 1;
  void processJob(job).finally(() => {
    activeJobs -= 1;
  });
}

async function bootstrap() {
  await connectToDatabase();
  logger.info({ workerId, queue: INSTAGRAM_WEBHOOK_QUEUE }, 'Mongo queue worker starting');
  await writeHeartbeat('healthy');
  void setInterval(() => {
    void writeHeartbeat(activeJobs > 0 ? 'degraded' : 'healthy');
  }, heartbeatIntervalMs);
  setInterval(() => {
    void pollLoop();
  }, pollIntervalMs);
  void pollLoop();
}

async function shutdown() {
  shuttingDown = true;
  logger.info('shutting down worker');
  await writeHeartbeat('down', 'worker shutting down');
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

void bootstrap().catch((error) => {
  logger.error({ error }, 'worker bootstrap failed');
  process.exitCode = 1;
});
