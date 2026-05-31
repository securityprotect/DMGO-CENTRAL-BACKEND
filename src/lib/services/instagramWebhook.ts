import crypto from 'crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';
import { Automation } from '@/lib/models/Automation';
import { AutomationLog } from '@/lib/models/AutomationLog';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { WebhookEvent } from '@/lib/models/WebhookEvent';
import { safeApiLog, safeErrorLog, safeQueueJob } from '@/lib/ops/logging';
import { createLogger } from '@/lib/observability/logger';
import { enqueueInstagramWebhookJob } from '@/lib/queue/instagram';
import { tryConsumeDm } from '@/lib/billing/usage';

export type InstagramWebhookChange = {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    from?: { id?: string; username?: string };
    media?: { id?: string };
  };
};

export type InstagramWebhookEntry = {
  id?: string;
  changes?: InstagramWebhookChange[];
};

export type InstagramWebhookBody = {
  object?: string;
  entry?: InstagramWebhookEntry[];
};

export type NormalizedInstagramWebhookEvent = {
  eventKey: string;
  entryId: string;
  changeField: string;
  commentId: string;
  mediaId: string;
  senderId: string;
  senderUsername: string;
  commentText: string;
  isEcho: boolean;
};

export function normalizeInstagramHandle(value: string) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

export function interpolateTemplate(template: string, username: string) {
  const firstName = username?.split(/[._\s]/)[0] || 'there';
  return String(template || '').replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
}

function shortHash(value: string) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

export function buildEventKey(input: {
  entryId: string;
  field?: string;
  commentId?: string;
  mediaId?: string;
  senderId?: string;
  text?: string;
  isEcho?: boolean;
}) {
  return [
    input.entryId,
    input.field || 'unknown',
    input.commentId || 'no-comment',
    input.mediaId || 'no-media',
    input.senderId || 'no-sender',
    input.isEcho ? 'echo' : 'event',
    shortHash(input.text || ''),
  ].join(':');
}

export function extractInstagramWebhookEvents(body: InstagramWebhookBody): NormalizedInstagramWebhookEvent[] {
  const events: NormalizedInstagramWebhookEvent[] = [];
  for (const entry of body?.entry || []) {
    const entryId = String(entry?.id || '').trim();
    if (!entryId) continue;

    for (const change of entry?.changes || []) {
      if (change?.field !== 'comments' && change?.field !== 'live_comments') continue;

      const value = change.value || {};
      const commentId = String(value.id || '').trim();
      const mediaId = String(value.media?.id || '').trim();
      const senderId = String(value.from?.id || '').trim();
      const senderUsername = String(value.from?.username || 'unknown_user').trim();
      const commentText = String(value.text || '').trim();
      const isEcho = Boolean((body as any)?.entry?.[0]?.messaging?.[0]?.message?.is_echo);

      if (isEcho) continue;

      events.push({
        eventKey: buildEventKey({
          entryId,
          field: change.field,
          commentId,
          mediaId,
          senderId,
          text: commentText,
          isEcho,
        }),
        entryId,
        changeField: String(change.field || ''),
        commentId,
        mediaId,
        senderId,
        senderUsername,
        commentText,
        isEcho,
      });
    }
  }

  return events;
}

export async function ingestInstagramWebhookBody(body: InstagramWebhookBody, headers: Headers, traceId: string) {
  const logger = createLogger({ scope: 'instagram-webhook-ingest', traceId });
  const startedAt = Date.now();
  const events = extractInstagramWebhookEvents(body);
  const results: Array<{ eventKey: string; status: string }> = [];

  await connectToDatabase();

  for (const event of events) {
    const inserted = await WebhookEvent.updateOne(
      { eventKey: event.eventKey },
      {
        $setOnInsert: {
          eventKey: event.eventKey,
          source: 'instagram',
          entryId: event.entryId,
          changeField: event.changeField,
          commentId: event.commentId,
          mediaId: event.mediaId,
          senderId: event.senderId,
          senderUsername: event.senderUsername,
          commentText: event.commentText,
          isEcho: event.isEcho,
          status: 'received',
          traceId,
          rawPayload: body,
        },
      },
      { upsert: true }
    );

    if (inserted.upsertedCount === 0) {
      await WebhookLog.create({
        source: 'instagram',
        endpoint: '/api/instagram/webhook',
        eventKey: event.eventKey,
        queueJobId: '',
        entryId: event.entryId,
        changeField: event.changeField,
        commentId: event.commentId,
        mediaId: event.mediaId,
        traceId,
        status: 'replayed',
        responseCode: 200,
        processingTimeMs: 0,
        headers: Object.fromEntries(headers.entries()),
        rawPayload: body,
        responsePayload: { duplicate: true },
        replayable: true,
        deduped: true,
      }).catch(() => null);
      results.push({ eventKey: event.eventKey, status: 'duplicate' });
      continue;
    }

    const queueResult = await enqueueInstagramWebhookJob({ eventKey: event.eventKey, traceId });

    await WebhookEvent.updateOne(
      { eventKey: event.eventKey },
      {
        $set: {
          status: queueResult.queued ? 'queued' : 'duplicate',
          queueJobId: String((queueResult as any).jobId || ''),
          processingStartedAt: null,
          responsePayload: queueResult,
          processedAt: null,
          lastError: queueResult.queued ? '' : 'duplicate',
        },
      }
    );

    await WebhookLog.create({
      source: 'instagram',
      endpoint: '/api/instagram/webhook',
      eventKey: event.eventKey,
      queueJobId: String((queueResult as any).jobId || ''),
      entryId: event.entryId,
      changeField: event.changeField,
      commentId: event.commentId,
      mediaId: event.mediaId,
      traceId,
      status: 'received',
      responseCode: queueResult.queued ? 202 : 200,
      processingTimeMs: Date.now() - startedAt,
      headers: Object.fromEntries(headers.entries()),
      rawPayload: body,
      responsePayload: { ok: queueResult.queued, queueResult },
      replayable: true,
      deduped: false,
      errorMessage: queueResult.queued ? '' : 'queue_unavailable',
    }).catch(() => null);

    results.push({ eventKey: event.eventKey, status: queueResult.queued ? 'queued' : 'duplicate' });
  }

  return {
    totalEvents: events.length,
    queuedCount: results.filter((r) => r.status === 'queued').length,
    duplicateCount: results.filter((r) => r.status === 'duplicate').length,
    fallbackCount: results.filter((r) => r.status === 'fallback').length,
    results,
    durationMs: Date.now() - startedAt,
    queueStore: 'mongodb',
  };
}

async function replyToComment(accessToken: string, commentId: string, message: string) {
  const safeToken = String(accessToken || '').trim();
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const url = `https://graph.instagram.com/${graphVersion}/${commentId}/replies`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeToken}`,
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to post comment reply');
  }
}

async function sendPrivateReplyToComment(accessToken: string, igUserId: string, commentId: string, message: string) {
  const safeToken = String(accessToken || '').trim();
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const url = `https://graph.instagram.com/${graphVersion}/${igUserId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeToken}`,
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

async function resolveAccountByAutomationFallback(params: { mediaId: string; entryId: string }) {
  const automationCandidates = await Automation.find({
    status: 'active',
    $or: [{ reelId: params.mediaId }, { reelId: '' }],
  }).lean();

  for (const automation of automationCandidates as any[]) {
    const handle = normalizeInstagramHandle(automation.account);
    const accountId = String(automation.instagramAccountId || '').trim();

    if (accountId) {
      const byId = await InstagramAccount.findOne({ _id: accountId }).lean();
      if (byId) return { account: byId, matchedBy: 'automation.instagramAccountId' };
    }

    const ownerId = automation.userId ? String(automation.userId) : '';
    if (!ownerId) continue;

    const account = await InstagramAccount.findOne({
      userId: ownerId,
      $or: [
        { igUserId: params.entryId },
        { webhookUserId: params.entryId },
        { username: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    }).lean();

    if (account) return { account, matchedBy: 'automation.handle' };
  }

  return null;
}

export async function resolveInstagramAccount(params: { entryId: string; mediaId: string }) {
  const exact = await InstagramAccount.findOne({
    $or: [{ igUserId: params.entryId }, { webhookUserId: params.entryId }],
  }).lean();
  if (exact) return { account: exact, matchedBy: 'exact' };

  if (params.mediaId) {
    const fallback = await resolveAccountByAutomationFallback({
      mediaId: params.mediaId,
      entryId: params.entryId,
    });
    if (fallback) return fallback;
  }

  return null;
}

export async function processInstagramWebhookBody(body: InstagramWebhookBody, rawHeaders: Headers, traceId: string) {
  const startedAt = Date.now();
  const entries = (body?.entry || []) as InstagramWebhookEntry[];
  const results: Array<{ eventKey: string; status: string; reason?: string }> = [];

  await connectToDatabase();

  for (const entry of entries) {
    const entryId = String(entry?.id || '').trim();
    if (!entryId) continue;

    for (const change of entry?.changes || []) {
      if (change?.field !== 'comments' && change?.field !== 'live_comments') continue;

      const value = change.value || {};
      const commentId = String(value.id || '').trim();
      const mediaId = String(value.media?.id || '').trim();
      const senderId = String(value.from?.id || '').trim();
      const senderUsername = String(value.from?.username || 'unknown_user').trim();
      const commentText = String(value.text || '').trim();
      const isEcho = Boolean((body as any)?.entry?.[0]?.messaging?.[0]?.message?.is_echo);
      const eventKey = buildEventKey({
        entryId,
        field: change.field,
        commentId,
        mediaId,
        senderId,
        text: commentText,
        isEcho,
      });

      const created = await WebhookEvent.updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            source: 'instagram',
            entryId,
            changeField: String(change.field || ''),
            commentId,
            mediaId,
            senderId,
            senderUsername,
            commentText,
            isEcho,
            status: 'received',
            traceId,
            rawPayload: body,
          },
        },
        { upsert: true }
      );

      const duplicate = created.upsertedCount === 0;
      if (duplicate) {
        await WebhookLog.create({
          source: 'instagram',
          endpoint: '/api/instagram/webhook',
          eventKey,
          entryId,
          changeField: String(change.field || ''),
          commentId,
          mediaId,
          traceId,
          status: 'replayed',
          responseCode: 200,
          processingTimeMs: 0,
          headers: Object.fromEntries(rawHeaders.entries()),
          rawPayload: body,
          responsePayload: { duplicate: true },
          replayable: true,
          deduped: true,
        }).catch(() => null);
        results.push({ eventKey, status: 'duplicate' });
        continue;
      }

      const event = await WebhookEvent.findOne({ eventKey }).lean();
      if (!event) {
        results.push({ eventKey, status: 'failed', reason: 'event_missing_after_insert' });
        continue;
      }

      if (!commentText || !commentId) {
        await WebhookEvent.updateOne(
          { eventKey },
          { $set: { status: 'skipped', lastError: 'empty_comment_or_id', processedAt: new Date() } }
        );
        results.push({ eventKey, status: 'skipped', reason: 'empty_comment_or_id' });
        continue;
      }

      const accountResolution = await resolveInstagramAccount({ entryId, mediaId });
      if (!accountResolution?.account) {
        await WebhookEvent.updateOne(
          { eventKey },
          { $set: { status: 'failed', lastError: 'account_not_resolved', processedAt: new Date() } }
        );
        results.push({ eventKey, status: 'failed', reason: 'account_not_resolved' });
        continue;
      }

      const account: any = accountResolution.account;
      const connectedHandle = normalizeInstagramHandle(account.username);
      const commentOwnerId = String(account.webhookUserId || account.igUserId);
      if (senderId && senderId === commentOwnerId) {
        await WebhookEvent.updateOne(
          { eventKey },
          { $set: { status: 'skipped', instagramAccountId: String(account._id), matchedBy: accountResolution.matchedBy, processedAt: new Date() } }
        );
        results.push({ eventKey, status: 'skipped', reason: 'self_comment' });
        continue;
      }

      const automationCandidates = await Automation.find({
        userId: account.userId,
        status: 'active',
        $or: [{ reelId: mediaId }, { reelId: '' }],
      }).lean();

      const activeAutomations = (automationCandidates as any[]).filter((automation) => {
        const byId = String(automation.instagramAccountId || '').trim();
        if (byId && byId === String(account._id)) return true;
        return normalizeInstagramHandle(automation.account) === connectedHandle;
      });

      let matchedCount = 0;

      for (const automation of activeAutomations) {
        const normalizedComment = commentText.toLowerCase();
        const matchedKeyword = (automation.keywords || []).find((kw: string) =>
          normalizedComment.includes(String(kw || '').trim().toLowerCase())
        );
        if (!matchedKeyword) continue;

        matchedCount += 1;
        const dmText = interpolateTemplate(String(automation.replyTemplate || ''), senderUsername);
        const commentReplyText = interpolateTemplate(String(automation.commentReplyTemplate || ''), senderUsername);

        let status: 'sent' | 'failed' | 'queued' | 'rate-limited' = 'queued';
        let failReason = '';

        try {
          if (automation.replyMode === 'comment_and_dm' && commentReplyText) {
            const apiStartedAt = Date.now();
            await replyToComment(String(account.accessToken), commentId, commentReplyText);
            await safeApiLog({
              userId: account.userId,
              service: 'Instagram API',
              method: 'POST',
              endpoint: 'comment replies',
              statusCode: 200,
              durationMs: Date.now() - apiStartedAt,
              requestPayload: { commentId, message: commentReplyText, eventKey, traceId },
            });
          }

          if (automation.sendDm && senderId && dmText) {
            // Monthly DM cap (with trusted-customer grace buffer). The public
            // comment reply above still goes out; only the DM is metered.
            const quota = await tryConsumeDm(String(account.userId));
            if (!quota.allowed) {
              status = 'rate-limited';
              failReason = 'Monthly DM limit reached — upgrade your plan to resume DMs';
              await safeApiLog({
                userId: account.userId,
                service: 'Instagram API',
                method: 'POST',
                endpoint: 'messages',
                statusCode: 429,
                durationMs: 0,
                requestPayload: { commentId, message: dmText, eventKey, traceId },
                errorMessage: failReason,
              });
            } else {
              const apiStartedAt = Date.now();
              await sendPrivateReplyToComment(String(account.accessToken), String(account.igUserId), commentId, dmText);
              await safeApiLog({
                userId: account.userId,
                service: 'Instagram API',
                method: 'POST',
                endpoint: 'messages',
                statusCode: 200,
                durationMs: Date.now() - apiStartedAt,
                requestPayload: { commentId, message: dmText, eventKey, traceId },
              });
              status = 'sent';
            }
          } else {
            status = 'sent';
          }
        } catch (error) {
          status = 'failed';
          failReason = error instanceof Error ? error.message : 'Unknown delivery error';
          await safeErrorLog({
            severity: failReason.toLowerCase().includes('rate') ? 'high' : 'medium',
            module: 'Instagram API',
            userId: account.userId,
            errorType: error instanceof Error ? error.name : 'InstagramDeliveryError',
            errorMessage: failReason,
            stackTrace: error instanceof Error ? error.stack : '',
            retryPayload: { commentId, senderId, automationId: automation._id, eventKey, traceId },
          });
          await safeApiLog({
            userId: account.userId,
            service: 'Instagram API',
            method: 'POST',
            endpoint: 'messages',
            statusCode: 500,
            durationMs: Date.now() - startedAt,
            requestPayload: { commentId, senderId, dmText, eventKey, traceId },
            errorMessage: failReason,
          });
        }

        const activity = await Activity.create({
          userId: account.userId,
          automationId: automation._id,
          instagramAccountId: String(account._id),
          webhookEventId: eventKey,
          username: senderUsername,
          account: automation.account,
          automation: automation.name,
          keyword: matchedKeyword,
          dmPreview: dmText || '(no DM message)',
          commentId,
          mediaId,
          senderId,
          traceId,
          status,
          failReason,
          rawPayload: body,
          responsePayload: { commentId, senderId, status, failReason, eventKey },
          durationMs: Date.now() - startedAt,
        });

        await AutomationLog.create({
          userId: account.userId,
          automationId: automation._id,
          instagramAccountId: String(account._id),
          webhookEventId: eventKey,
          traceId,
          eventType: 'automation_execution',
          status: status === 'sent' ? 'success' : 'failed',
          triggerKeyword: matchedKeyword,
          incomingWebhookPayload: body,
          outgoingApiRequest: { commentId, senderId, dmText, commentReplyText, eventKey },
          instagramApiResponse: { status, failReason },
          executionFlow: [
            { label: 'Trigger Received', status: 'ok' },
            { label: 'Keyword Matched', status: 'ok', detail: matchedKeyword },
            { label: 'Comment Reply', status: commentReplyText ? (status === 'sent' ? 'ok' : 'failed') : 'skipped' },
            { label: 'DM Sent', status: automation.sendDm ? (status === 'sent' ? 'ok' : 'failed') : 'skipped', detail: status === 'rate-limited' ? failReason : undefined },
            { label: 'Success / Failed', status },
          ],
          executionDurationMs: Date.now() - startedAt,
          errorMessage: failReason,
          rawPayload: body,
          responsePayload: { activityId: String(activity._id), status, eventKey },
        }).catch(() => null);

        await safeQueueJob({
          queueName: 'dm-send',
          userId: account.userId,
          jobType: 'Send DM',
          status: status === 'sent' ? 'completed' : 'failed',
          payload: { activityId: String(activity._id), automationId: automation._id, eventKey, traceId },
          startedAt: new Date(startedAt),
          completedAt: new Date(),
          processingTimeMs: Date.now() - startedAt,
          errorMessage: failReason,
        });

        const sentIncrement = status === 'sent' ? 1 : 0;
        await Automation.updateOne(
          { _id: automation._id },
          {
            $inc: { dmsSent: sentIncrement, totalExecutions: 1, failedExecutions: status === 'sent' ? 0 : 1 },
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
          $inc: { processingAttempts: 1 },
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
        entryId,
        changeField: String(change.field || ''),
        commentId,
        mediaId,
        traceId,
        userId: account.userId,
        status: 'processed',
        responseCode: 200,
        processingTimeMs: Date.now() - startedAt,
        headers: Object.fromEntries(rawHeaders.entries()),
        rawPayload: body,
        responsePayload: { ok: matchedCount > 0, eventKey, matchedCount, matchedBy: accountResolution.matchedBy },
        replayable: true,
        deduped: false,
        errorMessage: '',
      }).catch(() => null);

      results.push({ eventKey, status: matchedCount > 0 ? 'processed' : 'skipped' });
    }
  }

  return {
    processedCount: results.filter((r) => r.status === 'processed').length,
    skippedCount: results.filter((r) => r.status === 'skipped').length,
    duplicateCount: results.filter((r) => r.status === 'duplicate').length,
    results,
    durationMs: Date.now() - startedAt,
  };
}
