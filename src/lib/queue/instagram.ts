import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const INSTAGRAM_WEBHOOK_QUEUE = 'instagram-webhook-events';

type InstagramWebhookJobData = {
  eventKey: string;
  traceId: string;
};

let redisConnection: IORedis | null = null;
let queueSingleton: Queue<any, any, string> | null = null;
let eventsSingleton: QueueEvents | null = null;

function getRedisUrl() {
  return (process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '').trim();
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

export function getRedisConnection() {
  const url = getRedisUrl();
  if (!url) return null;
  if (!redisConnection) {
    redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return redisConnection;
}

export function getInstagramWebhookQueue() {
  const connection = getRedisConnection();
  if (!connection) return null;
  if (!queueSingleton) {
    queueSingleton = new Queue<any, any, string>(INSTAGRAM_WEBHOOK_QUEUE, {
      connection: connection as any,
      defaultJobOptions: {
        attempts: 5,
        removeOnComplete: 500,
        removeOnFail: 2000,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  }
  return queueSingleton;
}

export function getInstagramWebhookQueueEvents() {
  const connection = getRedisConnection();
  if (!connection) return null;
  if (!eventsSingleton) {
    eventsSingleton = new QueueEvents(INSTAGRAM_WEBHOOK_QUEUE, { connection: connection as any });
  }
  return eventsSingleton;
}

export async function enqueueInstagramWebhookJob(data: InstagramWebhookJobData) {
  const queue = getInstagramWebhookQueue();
  if (!queue) {
    return { queued: false, reason: 'redis_not_configured' as const };
  }

  const job = await queue.add('process-event', data, {
    jobId: data.eventKey,
  });

  return { queued: true, jobId: job.id };
}
