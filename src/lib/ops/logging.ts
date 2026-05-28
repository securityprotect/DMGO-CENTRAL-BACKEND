import { ApiLog } from '@/lib/models/ApiLog';
import { ErrorLog } from '@/lib/models/ErrorLog';
import { QueueJob } from '@/lib/models/QueueJob';

export async function safeApiLog(input: {
  userId?: unknown;
  service: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string;
}) {
  try {
    await ApiLog.create({
      userId: input.userId || null,
      service: input.service,
      method: input.method,
      endpoint: input.endpoint,
      statusCode: input.statusCode,
      durationMs: input.durationMs || 0,
      requestPayload: input.requestPayload || {},
      responsePayload: input.responsePayload || {},
      errorMessage: input.errorMessage || '',
    });
  } catch (error) {
    console.error('[OPS_LOGGING] api log failed', error);
  }
}

export async function safeErrorLog(input: {
  severity?: 'critical' | 'high' | 'medium' | 'low';
  module: string;
  userId?: unknown;
  errorType?: string;
  errorMessage: string;
  stackTrace?: string;
  retryPayload?: unknown;
}) {
  try {
    await ErrorLog.findOneAndUpdate(
      { module: input.module, errorType: input.errorType || 'Error', errorMessage: input.errorMessage },
      {
        $setOnInsert: {
          severity: input.severity || 'medium',
          module: input.module,
          userId: input.userId || null,
          errorType: input.errorType || 'Error',
          errorMessage: input.errorMessage,
          firstSeenAt: new Date(),
        },
        $set: {
          lastSeenAt: new Date(),
          stackTrace: input.stackTrace || '',
          retryPayload: input.retryPayload || {},
        },
        $inc: { occurrences: 1 },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('[OPS_LOGGING] error log failed', error);
  }
}

export async function safeQueueJob(input: {
  queueName: string;
  userId?: unknown;
  jobType: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying' | 'delayed' | 'canceled';
  retryCount?: number;
  payload?: unknown;
  startedAt?: Date | null;
  completedAt?: Date | null;
  processingTimeMs?: number;
  errorMessage?: string;
}) {
  try {
    await QueueJob.create({
      queueName: input.queueName,
      userId: input.userId || null,
      jobType: input.jobType,
      status: input.status,
      retryCount: input.retryCount || 0,
      payload: input.payload || {},
      startedAt: input.startedAt || null,
      completedAt: input.completedAt || null,
      processingTimeMs: input.processingTimeMs || 0,
      errorMessage: input.errorMessage || '',
    });
  } catch (error) {
    console.error('[OPS_LOGGING] queue log failed', error);
  }
}
