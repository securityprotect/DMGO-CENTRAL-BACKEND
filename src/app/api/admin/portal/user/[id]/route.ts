import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { Automation } from '@/lib/models/Automation';
import { Activity } from '@/lib/models/Activity';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { SupportTicket } from '@/lib/models/SupportTicket';
import { AdminAuditLog } from '@/lib/models/AdminAuditLog';
import { LoginSession } from '@/lib/models/LoginSession';
import { AutomationLog } from '@/lib/models/AutomationLog';
import { ApiLog } from '@/lib/models/ApiLog';

function iso(value: unknown) {
  return value ? new Date(value as string | Date).toISOString() : null;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  await connectToDatabase();

  const [user, instagram, automations, activity, payments, tickets, sessions, audit, automationLogs, apiLogs] = await Promise.all([
    User.findById(id).lean(),
    InstagramAccount.find({ userId: id }).sort({ updatedAt: -1 }).lean(),
    Automation.find({ userId: id }).sort({ updatedAt: -1 }).lean(),
    Activity.find({ userId: id }).sort({ createdAt: -1 }).limit(300).lean(),
    BillingRecord.find({ userId: id }).sort({ createdAt: -1 }).limit(300).lean(),
    SupportTicket.find({ userId: id }).sort({ createdAt: -1 }).limit(300).lean(),
    LoginSession.find({ userId: id }).sort({ updatedAt: -1 }).limit(100).lean(),
    AdminAuditLog.find({ targetId: id }).sort({ createdAt: -1 }).limit(100).lean(),
    AutomationLog.find({ userId: id }).sort({ createdAt: -1 }).limit(300).lean(),
    ApiLog.find({ userId: id }).sort({ createdAt: -1 }).limit(300).lean(),
  ]);

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      timezone: user.timezone || '',
      country: user.country || '',
      signupDate: iso(user.createdAt),
      lastLogin: iso(user.lastLoginAt),
      ipAddress: user.lastLoginIp || user.signupIpAddress || '',
      browserDevice: user.lastDevice || '',
      totalSpend: user.totalSpend || 0,
      ltv: user.lifetimeValue || 0,
      notes: user.notes || '',
      plan: user.plan,
      status: user.status,
      subscriptionStatus: user.subscriptionStatus || 'trialing',
    },
    instagram: instagram.map((i: any) => ({
      id: String(i._id),
      username: i.username,
      instagramId: i.igUserId,
      businessAccountStatus: i.businessAccountStatus || i.accountType,
      connectedDate: iso(i.createdAt),
      tokenExpiry: iso(i.tokenExpiresAt),
      lastSync: iso(i.lastSyncAt || i.updatedAt),
      webhookStatus: i.webhookStatus || 'healthy',
      reconnectRequired: Boolean(i.reconnectRequired),
      followersCount: i.followersCount || 0,
      followingCount: i.followingCount || 0,
      dmsSentToday: i.dmsSentToday || 0,
      apiErrors: i.apiErrorCount || 0,
      connectionStatus: i.connectionStatus || 'connected',
    })),
    automations: automations.map((a: any) => ({
      automationId: String(a._id),
      automationName: a.name,
      triggerKeyword: (a.keywords || []).join(', '),
      automationType: a.automationType || a.replyMode || 'keyword_dm',
      status: a.status,
      successRate: `${a.successRate || 0}%`,
      totalTriggers: a.totalExecutions || a.dmsSent || 0,
      lastTriggered: iso(a.lastFired),
      lastError: a.lastError || '',
      actions: 'Pause / Resume / Retry / Logs / Replay',
    })),
    activity: activity.map((a: any) => ({
      timestamp: iso(a.createdAt),
      event: a.eventType || 'dm_send',
      module: 'Automation',
      status: a.status,
      detail: a.failReason || a.dmPreview,
    })),
    payments: payments.map((p: any) => ({
      paymentId: String(p._id),
      plan: p.description || p.type,
      amount: p.amount,
      invoice: p.invoiceUrl || '',
      paymentMethod: p.paymentMethod || '',
      status: p.status,
      startDate: iso(p.createdAt),
      endDate: iso(p.renewalDate),
      renewalStatus: p.renewalDate ? 'scheduled' : 'manual',
    })),
    tickets: tickets.map((t: any) => ({
      ticketId: String(t._id),
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      assignedAdmin: t.assignedAdminId ? String(t.assignedAdminId) : '',
      lastUpdated: iso(t.updatedAt),
    })),
    logs: [
      ...automationLogs.map((l: any) => ({
        timestamp: iso(l.createdAt),
        module: 'Automation',
        eventType: l.eventType,
        status: l.status,
        errorMessage: l.errorMessage,
        rawPayload: l.rawPayload || l.incomingWebhookPayload || {},
        responsePayload: l.responsePayload || l.instagramApiResponse || {},
      })),
      ...apiLogs.map((l: any) => ({
        timestamp: iso(l.createdAt),
        module: l.service,
        eventType: `${l.method} ${l.endpoint}`,
        status: l.statusCode < 400 ? 'success' : 'failed',
        errorMessage: l.errorMessage,
        rawPayload: l.requestPayload || {},
        responsePayload: l.responsePayload || {},
      })),
    ],
    security: [
      ...sessions.map((s: any) => ({
        sessionId: String(s._id),
        type: 'login_session',
        ipAddress: s.ipAddress,
        browserDevice: [s.browser, s.device].filter(Boolean).join(' / '),
        country: s.country,
        active: s.active ? 'active' : 'inactive',
        lastSeen: iso(s.lastSeenAt),
      })),
      ...audit.map((a: any) => ({
        sessionId: String(a._id),
        type: a.action,
        ipAddress: a.ipAddress || '',
        browserDevice: a.actorEmail,
        country: '',
        active: 'logged',
        lastSeen: iso(a.createdAt),
      })),
    ],
  });
}
