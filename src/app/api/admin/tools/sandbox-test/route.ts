import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';
import { interpolateTemplate } from '@/lib/services/instagramWebhook';

type CheckStatus = 'pass' | 'warn' | 'fail';
type Check = { name: string; status: CheckStatus; detail: string };

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const automationId = String(body.automationId || '');
  const sampleText = String(body.sampleText || '');
  const sampleUsername = String(body.sampleUsername || 'test_user');

  if (!automationId) return NextResponse.json({ error: 'automationId is required' }, { status: 400 });
  if (!sampleText) return NextResponse.json({ error: 'sampleText is required' }, { status: 400 });

  await connectToDatabase();
  const automation = await Automation.findById(automationId).lean();
  if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

  const checks: Check[] = [];
  const a: any = automation;

  checks.push({
    name: 'Automation status',
    status: a.status === 'active' ? 'pass' : 'fail',
    detail: `status=${a.status}${a.status !== 'active' ? ' — would NOT fire in production' : ''}`,
  });

  const keywords: string[] = Array.isArray(a.keywords) ? a.keywords : [];
  const normalizedText = sampleText.toLowerCase();
  const matchedKeyword = keywords.find((kw) => normalizedText.includes(String(kw).toLowerCase()));
  checks.push({
    name: 'Keyword match',
    status: matchedKeyword ? 'pass' : 'fail',
    detail: matchedKeyword
      ? `matched "${matchedKeyword}" in ${keywords.length} configured keyword(s)`
      : `none of [${keywords.join(', ')}] matched`,
  });

  const now = Date.now();
  const lastFired = a.lastFired ? new Date(a.lastFired).getTime() : 0;
  const cooldownHours = Number(a.cooldownHours || 0);
  const inCooldown = lastFired > 0 && now - lastFired < cooldownHours * 3600 * 1000;
  checks.push({
    name: 'Cooldown',
    status: inCooldown ? 'warn' : 'pass',
    detail: inCooldown
      ? `last fired ${Math.floor((now - lastFired) / 60000)}m ago, cooldown=${cooldownHours}h`
      : `${cooldownHours}h cooldown (no recent fire)`,
  });

  const dmText = interpolateTemplate(String(a.replyTemplate || ''), sampleUsername);
  const commentReplyText = interpolateTemplate(String(a.commentReplyTemplate || ''), sampleUsername);

  checks.push({
    name: 'Reply mode',
    status: 'pass',
    detail: `${a.replyMode || 'comment_and_dm'} · sendDm=${Boolean(a.sendDm)}`,
  });

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const overall: CheckStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: 'automation_sandbox_test',
    targetType: 'automation',
    targetId: automationId,
    metadata: { sampleText, matched: Boolean(matchedKeyword), overall },
  });

  return NextResponse.json({
    ok: true,
    automation: {
      id: String(a._id),
      name: a.name,
      account: a.account,
      keywords,
      status: a.status,
      cooldownHours,
      replyMode: a.replyMode,
    },
    matchedKeyword: matchedKeyword || null,
    wouldFire: !hasFail && !inCooldown,
    overall,
    checks,
    preview: {
      dm: dmText,
      commentReply: commentReplyText,
    },
  });
}
