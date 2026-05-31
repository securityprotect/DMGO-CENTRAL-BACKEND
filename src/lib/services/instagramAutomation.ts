import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';
import { Automation } from '@/lib/models/Automation';
import { AutomationLog } from '@/lib/models/AutomationLog';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { WebhookEvent } from '@/lib/models/WebhookEvent';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { safeApiLog, safeErrorLog, safeQueueJob } from '@/lib/ops/logging';
import { createLogger } from '@/lib/observability/logger';
import { interpolateTemplate, normalizeInstagramHandle, resolveInstagramAccount } from '@/lib/services/instagramWebhook';
import { tryConsumeDm } from '@/lib/billing/usage';

type EventDoc = {
  eventKey: string;
  entryId: string;
  changeField: string;
  commentId: string;
  mediaId: string;
  senderId: string;
  senderUsername: string;
  commentText: string;
  isEcho: boolean;
  rawPayload: any;
  traceId: string;
  status?: string;
  userId?: any;
  instagramAccountId?: string;
  matchedBy?: string;
  processingAttempts?: number;
};

async function replyToComment(accessToken: string, commentId: string, message: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const res = await fetch(`https://graph.instagram.com/${graphVersion}/${commentId}/replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${String(accessToken || '').trim()}`,
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to post comment reply');
  }
}

async function sendPrivateReplyToComment(accessToken: string, igUserId: string, commentId: string, message: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const res = await fetch(`https://graph.instagram.com/${graphVersion}/${igUserId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${String(accessToken || '').trim()}`,
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to send private reply');
  }
}

export async function processInstagramWebhookEvent(eventKey: string, traceId = '', queueJobId = '') {
  const logger = createLogger({ scope: 'instagram-worker', eventKey, traceId });
  const startedAt = Date.now();

  await connectToDatabase();

  const claimed = await WebhookEvent.findOneAndUpdate(
    { eventKey, status: { $in: ['received', 'queued', 'failed', 'processing'] } },
    { $set: { status: 'processing', processingStartedAt: new Date(), queueJobId }, $inc: { processingAttempts: 1 } },
    { new: true }
  ).lean();

  if (!claimed) {
    logger.info({ status: 'skipped' }, 'event already processed or missing');
    return { ok: false, reason: 'not_claimed' };
  }

  const event = claimed as unknown as EventDoc;
  const body = event.rawPayload || {};
  if (!event.commentId || !event.mediaId) {
    await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'skipped', lastError: 'missing_comment_or_media', processedAt: new Date() } });
    return { ok: false, reason: 'missing_comment_or_media' };
  }

  const accountResolution = await resolveInstagramAccount({ entryId: event.entryId, mediaId: event.mediaId });
  if (!accountResolution?.account) {
    await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'failed', lastError: 'account_not_resolved', processedAt: new Date() } });
    logger.warn({ eventKey }, 'account not resolved');
    return { ok: false, reason: 'account_not_resolved' };
  }

  const account: any = accountResolution.account;
  const commenterId = String(event.senderId || '');
  const commenterUsername = String(event.senderUsername || 'unknown_user');
  if (commenterId && commenterId === String(account.webhookUserId || account.igUserId)) {
    await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'skipped', instagramAccountId: String(account._id), matchedBy: accountResolution.matchedBy, processedAt: new Date() } });
    return { ok: true, skipped: true, reason: 'self_comment' };
  }

  const connectedHandle = normalizeInstagramHandle(account.username);
  const automations = await Automation.find({
    userId: account.userId,
    status: 'active',
    $or: [{ reelId: event.mediaId }, { reelId: '' }],
  }).lean();

  const activeAutomations = (automations as any[]).filter((automation) => {
    const byId = String(automation.instagramAccountId || '').trim();
    if (byId && byId === String(account._id)) return true;
    return normalizeInstagramHandle(automation.account) === connectedHandle;
  });

  let matchedCount = 0;
  for (const automation of activeAutomations) {
    const normalizedComment = String(event.commentText || '').toLowerCase();
    const matchedKeyword = (automation.keywords || []).find((kw: string) =>
      normalizedComment.includes(String(kw || '').trim().toLowerCase())
    );
    if (!matchedKeyword) continue;
    matchedCount += 1;

    const dmText = interpolateTemplate(String(automation.replyTemplate || ''), commenterUsername);
    const commentReplyText = interpolateTemplate(String(automation.commentReplyTemplate || ''), commenterUsername);
    let status: 'sent' | 'failed' = 'failed';
    let failReason = '';

    try {
      if (automation.replyMode === 'comment_and_dm' && commentReplyText) {
        await replyToComment(String(account.accessToken), event.commentId, commentReplyText);
      }
      if (automation.sendDm && commenterId && dmText) {
        // Monthly DM cap (with trusted-customer grace buffer). The public
        // comment reply above always goes out; only the DM is metered.
        const quota = await tryConsumeDm(String(account.userId));
        if (!quota.allowed) {
          status = 'failed';
          failReason = 'Monthly DM limit reached — upgrade your plan to resume DMs';
        } else {
          await sendPrivateReplyToComment(String(account.accessToken), String(account.igUserId), event.commentId, dmText);
          status = 'sent';
        }
      } else {
        status = 'sent';
      }
    } catch (error) {
      failReason = error instanceof Error ? error.message : 'Unknown delivery error';
      await safeErrorLog({
        severity: failReason.toLowerCase().includes('rate') ? 'high' : 'medium',
        module: 'Instagram Worker',
        userId: account.userId,
        errorType: error instanceof Error ? error.name : 'InstagramDeliveryError',
        errorMessage: failReason,
        stackTrace: error instanceof Error ? error.stack : '',
        retryPayload: { eventKey, automationId: automation._id },
      });
    }

    const activity = await Activity.create({
      userId: account.userId,
      automationId: automation._id,
      instagramAccountId: String(account._id),
      webhookEventId: eventKey,
      username: commenterUsername,
      account: automation.account,
      automation: automation.name,
      keyword: matchedKeyword,
      dmPreview: dmText || '(no DM message)',
      commentId: event.commentId,
      mediaId: event.mediaId,
      senderId: commenterId,
      traceId: event.traceId || traceId,
      status,
      failReason,
      rawPayload: body,
      responsePayload: { status, failReason, eventKey },
      durationMs: Date.now() - startedAt,
    });

    await AutomationLog.create({
      userId: account.userId,
      automationId: automation._id,
      instagramAccountId: String(account._id),
      webhookEventId: eventKey,
      traceId: event.traceId || traceId,
      eventType: 'automation_execution',
      status: status === 'sent' ? 'success' : 'failed',
      triggerKeyword: matchedKeyword,
      incomingWebhookPayload: body,
      outgoingApiRequest: { commentId: event.commentId, senderId: commenterId, dmText, commentReplyText },
      instagramApiResponse: { status, failReason },
      executionFlow: [
        { label: 'Trigger Received', status: 'ok' },
        { label: 'Keyword Matched', status: 'ok', detail: matchedKeyword },
        { label: 'Comment Reply', status: commentReplyText ? (status === 'sent' ? 'ok' : 'failed') : 'skipped' },
        { label: 'DM Sent', status: automation.sendDm ? (status === 'sent' ? 'ok' : 'failed') : 'skipped' },
        { label: 'Success / Failed', status },
      ],
      executionDurationMs: Date.now() - startedAt,
      errorMessage: failReason,
      rawPayload: body,
      responsePayload: { activityId: String(activity._id), status, eventKey },
    }).catch(() => null);

    await safeApiLog({
      userId: account.userId,
      service: 'Instagram API',
      method: 'POST',
      endpoint: 'automation execution',
      statusCode: status === 'sent' ? 200 : 500,
      durationMs: Date.now() - startedAt,
      requestPayload: { eventKey, automationId: automation._id, traceId: event.traceId || traceId },
      errorMessage: failReason,
    });

    await safeQueueJob({
      queueName: 'instagram-worker',
      userId: account.userId,
      jobType: 'Automation Execution',
      status: status === 'sent' ? 'completed' : 'failed',
      payload: { eventKey, automationId: automation._id },
      startedAt: new Date(startedAt),
      completedAt: new Date(),
      processingTimeMs: Date.now() - startedAt,
      errorMessage: failReason,
    });

    await Automation.updateOne(
      { _id: automation._id },
      {
        $inc: { dmsSent: status === 'sent' ? 1 : 0, totalExecutions: 1, failedExecutions: status === 'sent' ? 0 : 1 },
        $set: {
          lastFired: new Date(),
          queueStatus: status === 'sent' ? 'completed' : 'failed',
          lastError: failReason,
          successRate: Math.max(0, Math.min(100, status === 'sent' ? 100 : 0)),
        },
      }
    );
  }

  await WebhookEvent.updateOne(
    { eventKey },
    {
      $set: {
        status: matchedCount > 0 ? 'processed' : 'skipped',
        userId: account.userId,
        instagramAccountId: String(account._id),
        matchedBy: accountResolution.matchedBy,
        automationCount: matchedCount,
        processedAt: new Date(),
        lastError: matchedCount > 0 ? '' : 'no_automation_matched',
      },
    }
  );

  await InstagramAccount.updateOne(
    { _id: account._id },
    {
      $set: {
        lastWebhookAt: new Date(),
        lastWebhookEventKey: eventKey,
        webhookSubscriptionStatus: 'healthy',
      },
    }
  );

  await WebhookLog.create({
    source: 'instagram',
    endpoint: '/api/instagram/webhook',
    eventKey,
    entryId: event.entryId,
    changeField: event.changeField,
    commentId: event.commentId,
    mediaId: event.mediaId,
    traceId: event.traceId || traceId,
    userId: account.userId,
    status: 'processed',
    responseCode: 200,
    processingTimeMs: Date.now() - startedAt,
    headers: {},
    rawPayload: body,
    responsePayload: { ok: true, eventKey, matchedCount, matchedBy: accountResolution.matchedBy },
    replayable: true,
    deduped: false,
    errorMessage: '',
  }).catch(() => null);

  await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'processed', processedAt: new Date(), responsePayload: { ok: true } } });

  logger.info({ matchedCount }, 'event processed');
  return { ok: true, matchedCount };
}
