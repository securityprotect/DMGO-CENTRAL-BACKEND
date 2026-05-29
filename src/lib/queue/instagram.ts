import crypto from 'crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { QueueJob } from '@/lib/models/QueueJob';

export const INSTAGRAM_WEBHOOK_QUEUE = 'instagram-webhook-events';

type InstagramWebhookJobData = {
  eventKey: string;
  traceId: string;
};

export function isMongoQueueConfigured() {
  return true;
}

function fingerprint(input: string) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex').slice(0, 12);
}

export async function enqueueInstagramWebhookJob(data: InstagramWebhookJobData) {
  await connectToDatabase();

  const jobKey = data.eventKey;
  const exists = await QueueJob.findOne({ queueName: INSTAGRAM_WEBHOOK_QUEUE, jobKey }).lean();
  if (exists) {
    return { queued: false, reason: 'duplicate' as const, jobId: String((exists as any)._id) };
  }

  const created = await QueueJob.create({
    queueName: INSTAGRAM_WEBHOOK_QUEUE,
    jobKey,
    jobType: 'process-event',
    status: 'pending',
    retryCount: 0,
    maxAttempts: Number(process.env.WEBHOOK_JOB_MAX_ATTEMPTS || 5),
    availableAt: new Date(),
    payload: {
      ...data,
      queueName: INSTAGRAM_WEBHOOK_QUEUE,
      fingerprint: fingerprint(jobKey),
    },
  });

  return { queued: true, jobId: String(created._id), jobKey };
}
