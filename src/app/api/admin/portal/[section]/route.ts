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
import { SystemAlert } from '@/lib/models/SystemAlert';
import { TeamMember } from '@/lib/models/TeamMember';
import { WebhookLog } from '@/lib/models/WebhookLog';
import { QueueJob } from '@/lib/models/QueueJob';
import { AutomationLog } from '@/lib/models/AutomationLog';
import { ApiLog } from '@/lib/models/ApiLog';
import { ErrorLog } from '@/lib/models/ErrorLog';
import { FeatureFlag } from '@/lib/models/FeatureFlag';
import { LoginSession } from '@/lib/models/LoginSession';
import { Notification } from '@/lib/models/Notification';
import { Subscription } from '@/lib/models/Subscription';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';

function iso(value: unknown) {
  return value ? new Date(value as string | Date).toISOString() : null;
}

function money(value: unknown, currency = 'INR') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value || 0));
}

async function ensureFeatureFlags() {
  const defaults = [
    ['ai_replies', 'AI replies', 'Generate context-aware DM responses'],
    ['automation_engine', 'Automation engine', 'Process trigger workflows'],
    ['webhook_processing', 'Webhook processing', 'Ingest Instagram and payment webhooks'],
    ['beta_features', 'Beta features', 'Expose experimental controls'],
  ];
  await Promise.all(defaults.map(([key, name, description]) =>
    FeatureFlag.updateOne({ key }, { $setOnInsert: { key, name, description, enabled: key !== 'beta_features', rolloutPercent: key === 'beta_features' ? 0 : 100 } }, { upsert: true })
  ));
}

async function dashboardPayload() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [
    totalUsers,
    activeUsers,
    instagramConnectedAccounts,
    disconnectedAccounts,
    activeAutomations,
    failedAutomations,
    pendingQueueJobs,
    failedQueueJobs,
    openTickets,
    revenueRows,
    webhookFailures,
    apiErrors,
    recentFailures,
    services,
    activities,
  ] = await Promise.all([
    User.countDocuments({ status: { $ne: 'deleted' } }),
    User.countDocuments({ status: 'active' }),
    InstagramAccount.countDocuments({ connectionStatus: { $in: ['connected', undefined] } }),
    InstagramAccount.countDocuments({ connectionStatus: { $in: ['disconnected', 'token_expired', 'webhook_failed'] } }),
    Automation.countDocuments({ status: 'active' }),
    Automation.countDocuments({ $or: [{ failedExecutions: { $gt: 0 } }, { lastError: { $ne: '' } }] }),
    QueueJob.countDocuments({ status: { $in: ['pending', 'processing', 'retrying', 'delayed'] } }),
    QueueJob.countDocuments({ status: 'failed' }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress', 'waiting_for_user'] } }),
    BillingRecord.find({ status: 'paid' }).sort({ createdAt: -1 }).limit(500).lean(),
    WebhookLog.countDocuments({ status: 'failed' }),
    ApiLog.countDocuments({ statusCode: { $gte: 400 } }),
    ErrorLog.find({}).sort({ lastSeenAt: -1 }).limit(8).lean(),
    SystemHealthLog.find({}).sort({ createdAt: -1 }).limit(20).lean(),
    Activity.find({}).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  const revenueToday = revenueRows.filter((r: any) => new Date(r.createdAt) >= today).reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  const monthlyRevenue = revenueRows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);

  return {
    metrics: [
      { label: 'Total Users', value: totalUsers },
      { label: 'Active Users', value: activeUsers },
      { label: 'Connected Instagram Accounts', value: instagramConnectedAccounts },
      { label: 'Disconnected Accounts', value: disconnectedAccounts },
      { label: 'Active Automations', value: activeAutomations },
      { label: 'Failed Automations', value: failedAutomations },
      { label: 'Pending Queue Jobs', value: pendingQueueJobs },
      { label: 'Failed Queue Jobs', value: failedQueueJobs },
      { label: 'Open Tickets', value: openTickets },
      { label: 'Revenue Today', value: money(revenueToday, revenueRows[0]?.currency || 'INR') },
      { label: 'Monthly Revenue', value: money(monthlyRevenue, revenueRows[0]?.currency || 'INR') },
      { label: 'Webhook Failures', value: webhookFailures },
      { label: 'API Errors', value: apiErrors },
    ],
    serviceHealth: services.map((s: any) => ({
      serviceName: s.serviceName,
      status: s.status,
      responseTime: `${s.responseTimeMs || 0} ms`,
      lastIncident: s.lastIncident || 'None recorded',
      uptime: `${s.uptimePercent || 100}%`,
    })),
    recentFailures: recentFailures.map((e: any) => ({
      time: iso(e.lastSeenAt),
      user: e.userId ? String(e.userId) : 'System',
      module: e.module,
      errorType: e.errorType,
      severity: e.severity,
      action: 'Inspect',
    })),
    activityFeed: activities.map((a: any) => ({
      type: a.eventType || 'activity',
      message: `${a.automation} for ${a.username} is ${a.status}`,
      time: iso(a.createdAt),
      tone: a.status === 'sent' ? 'green' : a.status === 'queued' ? 'sky' : 'red',
    })),
  };
}

export async function GET(_: Request, ctx: { params: Promise<{ section: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { section } = await ctx.params;
  await connectToDatabase();

  if (section === 'dashboard') return NextResponse.json(await dashboardPayload());

  if (section === 'accounts') {
    const [users, automations, activity, instagram] = await Promise.all([
      User.find({ status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).limit(500).lean(),
      Automation.find({}).lean(),
      Activity.find({}).lean(),
      InstagramAccount.find({}).lean(),
    ]);
    return NextResponse.json({
      rows: users.map((u: any) => {
        const uid = String(u._id);
        const userAutomations = automations.filter((a: any) => String(a.userId) === uid);
        const failed = activity.filter((a: any) => String(a.userId) === uid && ['failed', 'rate-limited'].includes(a.status));
        const ig = instagram.find((i: any) => String(i.userId) === uid);
        return {
          userId: uid,
          fullName: u.name,
          email: u.email,
          phone: u.phone || '',
          instagramUsername: ig?.username ? `@${ig.username}` : '',
          planType: u.plan || 'starter',
          subscriptionStatus: u.subscriptionStatus || 'trialing',
          activeAutomations: userAutomations.filter((a: any) => a.status === 'active').length,
          failedAutomations: failed.length,
          lastLogin: iso(u.lastLoginAt),
          lastActivity: iso(u.lastActivityAt || u.updatedAt),
          country: u.country || '',
          accountStatus: u.status || 'active',
        };
      }),
    });
  }

  if (section === 'instagram-accounts') {
    const [rows, users] = await Promise.all([InstagramAccount.find({}).sort({ updatedAt: -1 }).limit(500).lean(), User.find({}).lean()]);
    return NextResponse.json({ rows: rows.map((r: any) => {
      const user = users.find((u: any) => String(u._id) === String(r.userId));
      return {
        username: `@${r.username}`,
        user: user?.name || String(r.userId),
        connectionStatus: r.connectionStatus || 'connected',
        tokenExpiry: iso(r.tokenExpiresAt),
        lastSync: iso(r.lastSyncAt || r.updatedAt),
        followers: r.followersCount || 0,
        dmsSentToday: r.dmsSentToday || 0,
        dailyLimit: r.dailyLimit || 250,
        errorCount: r.apiErrorCount || 0,
        webhookStatus: r.webhookStatus || 'healthy',
        actions: r.reconnectRequired ? 'Reconnect' : 'Inspect',
      };
    }) });
  }

  if (section === 'automations') {
    const [rows, users] = await Promise.all([Automation.find({}).sort({ updatedAt: -1 }).limit(500).lean(), User.find({}).lean()]);
    return NextResponse.json({ rows: rows.map((a: any) => ({
      automationId: String(a._id),
      user: users.find((u: any) => String(u._id) === String(a.userId))?.name || String(a.userId),
      triggerKeyword: (a.keywords || []).join(', '),
      automationType: a.automationType || a.replyMode || 'keyword_dm',
      status: a.status,
      queueStatus: a.queueStatus || 'pending',
      successRate: `${a.successRate || 0}%`,
      totalExecutions: a.totalExecutions || a.dmsSent || 0,
      failedExecutions: a.failedExecutions || 0,
      lastTriggered: iso(a.lastFired),
      lastError: a.lastError || '',
      actions: 'Pause / Resume / Replay',
    })) });
  }

  if (section === 'live-activity') {
    const rows = await Activity.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows: rows.map((a: any) => ({
      timestamp: iso(a.createdAt),
      event: a.eventType || 'dm_send',
      user: a.username,
      module: 'Automation',
      status: a.status,
      detail: a.failReason || a.dmPreview,
    })) });
  }

  if (section === 'audit-logs') {
    const rows = await AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows: rows.map((a: any) => ({
      timestamp: iso(a.createdAt),
      actor: a.actorEmail,
      role: a.role || 'admin',
      action: a.action,
      module: a.targetType,
      resource: a.targetId,
      beforeState: JSON.stringify(a.beforeState || {}),
      afterState: JSON.stringify(a.afterState || a.metadata || {}),
      ipAddress: a.ipAddress || '',
    })) });
  }

  if (section === 'webhook-monitor') {
    const rows = await WebhookLog.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows: rows.map((w: any) => ({
      webhookId: String(w._id),
      source: w.source,
      user: w.userId ? String(w.userId) : 'System',
      endpoint: w.endpoint,
      status: w.status,
      responseCode: w.responseCode,
      processingTime: `${w.processingTimeMs || 0} ms`,
      receivedAt: iso(w.createdAt),
      actions: w.replayable ? 'Replay / Payload / Headers' : 'Inspect',
    })) });
  }

  if (section === 'queue-monitor') {
    const rows = await QueueJob.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows: rows.map((j: any) => ({
      jobId: String(j._id),
      queueName: j.queueName,
      user: j.userId ? String(j.userId) : 'System',
      jobType: j.jobType,
      status: j.status,
      retryCount: j.retryCount,
      startedAt: iso(j.startedAt),
      completedAt: iso(j.completedAt),
      processingTime: `${j.processingTimeMs || 0} ms`,
      errorMessage: j.errorMessage || '',
    })) });
  }

  if (section === 'errors-failures') {
    const rows = await ErrorLog.find({}).sort({ lastSeenAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows: rows.map((e: any) => ({
      errorId: String(e._id),
      severity: e.severity,
      module: e.module,
      user: e.userId ? String(e.userId) : 'System',
      errorType: e.errorType,
      errorMessage: e.errorMessage,
      occurrences: e.occurrences,
      firstSeen: iso(e.firstSeenAt),
      lastSeen: iso(e.lastSeenAt),
      status: e.status,
    })) });
  }

  if (section === 'payments') {
    const [rows, users] = await Promise.all([BillingRecord.find({}).sort({ createdAt: -1 }).limit(500).lean(), User.find({}).lean()]);
    return NextResponse.json({ rows: rows.map((p: any) => ({
      paymentId: String(p._id),
      user: users.find((u: any) => String(u._id) === String(p.userId))?.name || String(p.userId),
      plan: p.description || p.type,
      amount: money(p.amount, p.currency || 'INR'),
      gateway: p.gateway || 'razorpay',
      transactionId: p.transactionId || p.providerRef || '',
      status: p.status,
      paidAt: iso(p.paidAt || p.createdAt),
      renewalDate: iso(p.renewalDate),
      refundStatus: p.refundStatus || '',
    })) });
  }

  if (section === 'subscriptions') {
    const [rows, users] = await Promise.all([Subscription.find({}).sort({ updatedAt: -1 }).limit(500).lean(), User.find({}).lean()]);
    return NextResponse.json({ rows: rows.map((s: any) => ({
      subscriptionId: String(s._id),
      user: users.find((u: any) => String(u._id) === String(s.userId))?.name || String(s.userId),
      plan: s.plan,
      status: s.status,
      gateway: s.gateway,
      startedAt: iso(s.startedAt),
      endsAt: iso(s.endsAt),
      renewalStatus: s.renewalStatus,
      renewalDate: iso(s.renewalDate),
    })) });
  }

  if (section === 'tickets') {
    const [rows, users] = await Promise.all([SupportTicket.find({}).sort({ createdAt: -1 }).limit(500).lean(), User.find({}).lean()]);
    return NextResponse.json({ rows: rows.map((t: any) => ({
      ticketId: String(t._id),
      user: users.find((u: any) => String(u._id) === String(t.userId))?.name || String(t.userId),
      subject: t.subject,
      issueType: t.category,
      priority: t.priority,
      status: t.status,
      assignedTo: t.assignedAdminId ? String(t.assignedAdminId) : '',
      createdAt: iso(t.createdAt),
      lastReply: iso(t.lastReplyAt || t.updatedAt),
      actions: 'Respond / Note / Attach',
    })) });
  }

  if (section === 'notifications') {
    const [notifications, alerts] = await Promise.all([
      Notification.find({}).sort({ createdAt: -1 }).limit(300).lean(),
      SystemAlert.find({}).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    return NextResponse.json({ rows: [
      ...notifications.map((n: any) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, severity: n.severity, createdAt: iso(n.createdAt) })),
      ...alerts.map((a: any) => ({ id: String(a._id), type: 'system_alert', title: a.title, message: a.message, severity: a.level, createdAt: iso(a.createdAt) })),
    ] });
  }

  if (section === 'analytics') {
    const rows = await Activity.find({}).sort({ createdAt: -1 }).limit(5000).lean();
    const byDay = new Map<string, { name: string; users: number; mrr: number; churn: number; usage: number; dmSuccess: number; failures: number }>();
    for (const row of rows as any[]) {
      const date = new Date(row.createdAt);
      const key = date.toISOString().slice(0, 10);
      const current = byDay.get(key) || { name: key, users: 0, mrr: 0, churn: 0, usage: 0, dmSuccess: 0, failures: 0 };
      current.usage += 1;
      if (row.status === 'sent') current.dmSuccess += 1;
      if (['failed', 'rate-limited'].includes(row.status)) current.failures += 1;
      byDay.set(key, current);
    }
    return NextResponse.json({ rows: [...byDay.values()].slice(-30).map((r) => ({ ...r, dmSuccess: r.usage ? Number(((r.dmSuccess / r.usage) * 100).toFixed(1)) : 0 })) });
  }

  if (section === 'admins-roles') {
    const [admins, sessions] = await Promise.all([User.find({ role: 'admin' }).sort({ updatedAt: -1 }).lean(), LoginSession.find({ adminUserId: { $ne: null } }).lean()]);
    return NextResponse.json({ rows: admins.map((a: any) => ({
      id: String(a._id),
      name: a.name,
      email: a.email,
      role: a.role,
      permissions: 'admin',
      twoFactor: 'not_configured',
      lastLogin: iso(a.lastLoginAt),
      sessions: sessions.filter((s: any) => String(s.adminUserId) === String(a._id) && s.active).length,
    })) });
  }

  if (section === 'feature-flags') {
    await ensureFeatureFlags();
    const rows = await FeatureFlag.find({}).sort({ key: 1 }).lean();
    return NextResponse.json({ rows: rows.map((f: any) => ({
      key: f.key,
      name: f.name,
      description: f.description,
      enabled: f.enabled,
      rolloutPercent: f.rolloutPercent,
      updatedBy: f.updatedBy,
    })) });
  }

  if (section === 'settings') {
    return NextResponse.json({ rows: [
      { setting: 'RBAC permissions', status: 'enabled', owner: 'Security', detail: 'Admin routes require admin role or ADMIN_EMAILS' },
      { setting: 'Session tracking', status: 'enabled', owner: 'Security', detail: 'LoginSession collection is available' },
      { setting: 'IP tracking', status: 'enabled', owner: 'Security', detail: 'User and audit log IP fields are available' },
      { setting: 'Admin audit trail', status: 'enabled', owner: 'Compliance', detail: 'AdminAuditLog captures admin actions' },
      { setting: 'Impersonate user', status: 'planned', owner: 'Support', detail: 'Model support exists; destructive action remains disabled until explicitly implemented' },
      { setting: '2FA support', status: 'planned', owner: 'Security', detail: 'Admin role field ready; 2FA enrollment not implemented yet' },
    ] });
  }

  if (section === 'logs') {
    const [api, auto] = await Promise.all([ApiLog.find({}).sort({ createdAt: -1 }).limit(300).lean(), AutomationLog.find({}).sort({ createdAt: -1 }).limit(300).lean()]);
    return NextResponse.json({ rows: [
      ...api.map((l: any) => ({ timestamp: iso(l.createdAt), module: l.service, eventType: `${l.method} ${l.endpoint}`, status: l.statusCode < 400 ? 'success' : 'failed', errorMessage: l.errorMessage, rawPayload: JSON.stringify(l.requestPayload || {}), responsePayload: JSON.stringify(l.responsePayload || {}) })),
      ...auto.map((l: any) => ({ timestamp: iso(l.createdAt), module: 'Automation', eventType: l.eventType, status: l.status, errorMessage: l.errorMessage, rawPayload: JSON.stringify(l.rawPayload || l.incomingWebhookPayload || {}), responsePayload: JSON.stringify(l.responsePayload || l.instagramApiResponse || {}) })),
    ] });
  }

  if (section === 'team') {
    const rows = await TeamMember.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return NextResponse.json({ rows });
  }

  return NextResponse.json({ error: 'Unknown admin portal section' }, { status: 404 });
}
