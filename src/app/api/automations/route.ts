import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const automations = await Automation.find({ userId: user._id }).sort({ createdAt: -1 }).lean();

  return NextResponse.json({
    automations: automations.map((a) => ({
      id: String(a._id),
      name: a.name,
      account: a.account,
      instagramAccountId: a.instagramAccountId || '',
      reelUrl: a.reelUrl || '',
      reelId: a.reelId || '',
      reelCaption: a.reelCaption || '',
      commentReplyTemplate: a.commentReplyTemplate || '',
      replyTemplate: a.replyTemplate || '',
      replyMode: a.replyMode || 'comment_and_dm',
      keywords: a.keywords,
      sendDm: Boolean(a.sendDm),
      delaySeconds: a.delaySeconds,
      dmsSent: a.dmsSent,
      successRate: a.successRate,
      status: a.status,
      cooldown: a.cooldownHours,
      lastFired: a.lastFired ? new Date(a.lastFired).toISOString() : 'Never',
    })),
  });
}

export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  await connectToDatabase();

  const selectedAccountId = String(body.instagramAccountId || '').trim();
  let account = null;
  if (selectedAccountId) {
    account = await InstagramAccount.findOne({ _id: selectedAccountId, userId: user._id }).lean();
    if (!account) {
      return NextResponse.json({ error: 'Selected Instagram account not found' }, { status: 404 });
    }
  } else if (body.account) {
    const normalizedAccount = String(body.account).trim().toLowerCase();
    account = await InstagramAccount.findOne({
      userId: user._id,
      $or: [{ username: normalizedAccount }, { username: new RegExp(`^${normalizedAccount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
    }).lean();
  }

  const created = await Automation.create({
    userId: user._id,
    name: body.name,
    account: body.account,
    instagramAccountId: selectedAccountId || (account ? String(account._id) : ''),
    reelUrl: body.reelUrl,
    reelId: body.reelId || '',
    reelCaption: body.reelCaption || '',
    commentReplyTemplate: body.commentReplyTemplate || '',
    replyTemplate: body.replyTemplate,
    replyMode: body.replyMode || 'comment_and_dm',
    keywords: body.keywords || [],
    cooldownHours: body.cooldownHours,
    delaySeconds: body.delaySeconds,
    sendDm: body.sendDm,
    status: 'active',
  });

  return NextResponse.json({ id: String(created._id) }, { status: 201 });
}
