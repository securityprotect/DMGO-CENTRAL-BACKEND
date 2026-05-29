import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { AutomationLog } from '@/lib/models/AutomationLog';

type StepStatus = 'pass' | 'warn' | 'fail';

function extractCommentText(payload: any): string {
  if (!payload) return '';
  const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
  if (!entry) return '';
  const change = Array.isArray(entry.changes) ? entry.changes[0] : null;
  return String(change?.value?.text || change?.value?.message?.text || '').trim();
}

function extractMessageText(payload: any): string {
  if (!payload) return '';
  const entry = Array.isArray(payload.entry) ? payload.entry[0] : null;
  const messaging = Array.isArray(entry?.messaging) ? entry.messaging[0] : null;
  return String(messaging?.message?.text || '').trim();
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const automationId = String(body.automationId || '');
  const webhookLogId = String(body.webhookLogId || '');

  if (!automationId) return NextResponse.json({ error: 'automationId is required' }, { status: 400 });
  if (!webhookLogId) return NextResponse.json({ error: 'webhookLogId is required' }, { status: 400 });

  await connectToDatabase();
  const [automation, webhook] = await Promise.all([
    Automation.findById(automationId).lean(),
    WebhookLog.findById(webhookLogId).lean(),
  ]);
  if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
  if (!webhook) return NextResponse.json({ error: 'Webhook event not found' }, { status: 404 });

  const a: any = automation;
  const w: any = webhook;

  const steps: Array<{ name: string; status: StepStatus; detail: string }> = [];

  const text = extractCommentText(w.rawPayload) || extractMessageText(w.rawPayload);
  steps.push({
    name: 'Webhook payload has text content',
    status: text ? 'pass' : 'fail',
    detail: text ? `extracted "${text.slice(0, 120)}"` : 'no comment/message text found in payload',
  });

  steps.push({
    name: 'Automation is active',
    status: a.status === 'active' ? 'pass' : 'fail',
    detail: `automation.status=${a.status}`,
  });

  steps.push({
    name: 'Automation has account binding',
    status: a.instagramAccountId || a.account ? 'pass' : 'fail',
    detail: a.instagramAccountId ? `instagramAccountId=${a.instagramAccountId}` : a.account ? `account=${a.account}` : 'no account/instagramAccountId on automation',
  });

  const webhookEntryId = String(w.entryId || '');
  steps.push({
    name: 'Webhook account matches automation account',
    status: !webhookEntryId || (a.instagramAccountId && webhookEntryId === a.instagramAccountId) || (a.account && webhookEntryId === a.account) ? 'pass' : 'warn',
    detail: webhookEntryId
      ? `webhook entryId=${webhookEntryId}, automation account=${a.instagramAccountId || a.account || '—'}`
      : 'webhook missing entryId',
  });

  const keywords: string[] = Array.isArray(a.keywords) ? a.keywords : [];
  const matched = keywords.find((kw) => text.toLowerCase().includes(String(kw).toLowerCase()));
  steps.push({
    name: 'Keyword match',
    status: matched ? 'pass' : 'fail',
    detail: matched ? `matched "${matched}"` : `none of [${keywords.join(', ')}] matched`,
  });

  const cooldownHours = Number(a.cooldownHours || 0);
  const lastFired = a.lastFired ? new Date(a.lastFired).getTime() : 0;
  const webhookTime = w.createdAt ? new Date(w.createdAt).getTime() : Date.now();
  const inCooldown = lastFired > 0 && webhookTime - lastFired < cooldownHours * 3600 * 1000;
  steps.push({
    name: 'Cooldown window',
    status: inCooldown ? 'fail' : 'pass',
    detail: inCooldown
      ? `last fired ${Math.floor((webhookTime - lastFired) / 60000)}m before this event; cooldown=${cooldownHours}h`
      : `cooldown=${cooldownHours}h (clear)`,
  });

  // Was an AutomationLog actually written for this trace?
  const traceId = String(w.traceId || '');
  const automationLog = traceId
    ? await AutomationLog.findOne({ traceId, automationId: a._id }).lean()
    : null;
  steps.push({
    name: 'AutomationLog written',
    status: automationLog ? 'pass' : 'warn',
    detail: automationLog
      ? `status=${(automationLog as any).status}${(automationLog as any).errorMessage ? `, error=${(automationLog as any).errorMessage}` : ''}`
      : 'no AutomationLog row for this traceId+automation — worker may have skipped early',
  });

  const hasFail = steps.some((s) => s.status === 'fail');
  const hasWarn = steps.some((s) => s.status === 'warn');
  const overall: StepStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  return NextResponse.json({
    overall,
    extractedText: text,
    automation: { id: String(a._id), name: a.name, keywords, status: a.status },
    webhook: {
      id: String(w._id),
      entryId: webhookEntryId,
      changeField: w.changeField || '',
      status: w.status,
      createdAt: w.createdAt,
      traceId,
    },
    steps,
  });
}
