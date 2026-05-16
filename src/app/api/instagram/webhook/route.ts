import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { Automation } from '@/lib/models/Automation';
import { Activity } from '@/lib/models/Activity';

type WebhookChange = {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    from?: { id?: string; username?: string };
    media?: { id?: string };
  };
};

type WebhookEntry = {
  id?: string;
  changes?: WebhookChange[];
};

function interpolateTemplate(template: string, username: string) {
  const firstName = username?.split(/[._\s]/)[0] || 'there';
  return template.replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
}

async function replyToComment(accessToken: string, commentId: string, message: string) {
  const safeToken = String(accessToken || '').trim();
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const url = `https://graph.instagram.com/${graphVersion}/${commentId}/replies`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: safeToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to post comment reply');
  }
}

async function sendInstagramDm(accessToken: string, igUserId: string, recipientId: string, message: string) {
  const safeToken = String(accessToken || '').trim();
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const url = `https://graph.instagram.com/${graphVersion}/${igUserId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      access_token: safeToken,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to send Instagram DM');
  }
}

async function sendPrivateReplyToComment(accessToken: string, igUserId: string, commentId: string, message: string) {
  const safeToken = String(accessToken || '').trim();
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const url = `https://graph.instagram.com/${graphVersion}/${igUserId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
      access_token: safeToken,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to send private reply');
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || '';

  if (mode === 'subscribe' && token && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entries = (body?.entry || []) as WebhookEntry[];
  console.log('[IG_WEBHOOK] received entries:', entries.length, JSON.stringify(body));

  await connectToDatabase();

  for (const entry of entries) {
    const igUserId = String(entry?.id || '');
    if (!igUserId) {
      console.log('[IG_WEBHOOK] skip: missing entry.id');
      continue;
    }

    let account = await InstagramAccount.findOne({
      $or: [{ igUserId }, { webhookUserId: igUserId }],
    }).lean();
    if (!account) {
      const totalAccounts = await InstagramAccount.countDocuments({});
      if (totalAccounts === 1) {
        const single = await InstagramAccount.findOne({}).lean();
        if (single) {
          await InstagramAccount.updateOne({ _id: single._id }, { $set: { webhookUserId: igUserId } });
          account = await InstagramAccount.findById(single._id).lean();
          console.log('[IG_WEBHOOK] auto-linked webhookUserId for single connected account:', igUserId);
        }
      }
    }
    if (!account) {
      console.log('[IG_WEBHOOK] skip: strict account match failed for webhook igUserId=', igUserId);
      continue;
    }

    for (const change of entry?.changes || []) {
      if (change?.field !== 'comments' && change?.field !== 'live_comments') continue;
      const value = change.value || {};
      const commentId = String(value.id || '');
      const mediaId = String(value.media?.id || '');
      const commenterId = String(value.from?.id || '');
      const commenterUsername = String(value.from?.username || 'unknown_user');
      const commentText = String(value.text || '').trim();
      if (!commentText || !commentId) {
        console.log('[IG_WEBHOOK] skip: empty commentText/commentId');
        continue;
      }
      console.log('[IG_WEBHOOK] comment:', { igUserId, mediaId, commentId, commenterId, commenterUsername, commentText });
      if (commenterId === String(account.webhookUserId || account.igUserId)) {
        console.log('[IG_WEBHOOK] skip: self comment/reply');
        continue;
      }

      const activeAutomations = await Automation.find({
        userId: account.userId,
        status: 'active',
        account: `@${account.username}`,
        $or: [{ reelId: mediaId }, { reelId: '' }],
      }).lean();
      console.log('[IG_WEBHOOK] active automations found:', activeAutomations.length);

      for (const automation of activeAutomations) {
        const normalized = commentText.toLowerCase();
        const matchedKeyword = (automation.keywords || []).find((kw: string) =>
          normalized.includes(String(kw || '').trim().toLowerCase())
        );
        if (!matchedKeyword) {
          console.log('[IG_WEBHOOK] no keyword match for automation=', automation.name, 'keywords=', automation.keywords);
          continue;
        }
        console.log('[IG_WEBHOOK] matched automation=', automation.name, 'keyword=', matchedKeyword);

        const dmText = interpolateTemplate(String(automation.replyTemplate || ''), commenterUsername);
        const commentReplyText = interpolateTemplate(String(automation.commentReplyTemplate || ''), commenterUsername);

        let status: 'sent' | 'failed' | 'queued' | 'rate-limited' = 'queued';
        let failReason = '';

        try {
          if (automation.replyMode === 'comment_and_dm' && commentReplyText) {
            await replyToComment(String(account.accessToken), commentId, commentReplyText);
          }
          if (automation.sendDm && commenterId && dmText) {
            await sendPrivateReplyToComment(String(account.accessToken), String(account.igUserId), commentId, dmText);
          }
          status = 'sent';
        } catch (error) {
          status = 'failed';
          failReason = error instanceof Error ? error.message : 'Unknown delivery error';
          console.log('[IG_WEBHOOK] send failed:', failReason);
        }

        await Activity.create({
          userId: account.userId,
          automationId: automation._id,
          username: commenterUsername,
          account: automation.account,
          automation: automation.name,
          keyword: matchedKeyword,
          dmPreview: dmText || '(no DM message)',
          status,
          failReason,
        });

        const sentIncrement = status === 'sent' ? 1 : 0;
        await Automation.updateOne(
          { _id: automation._id },
          {
            $inc: { dmsSent: sentIncrement },
            $set: {
              lastFired: new Date(),
              successRate: Math.max(0, Math.min(100, status === 'sent' ? 100 : 0)),
            },
          }
        );
        console.log('[IG_WEBHOOK] activity logged with status=', status);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
