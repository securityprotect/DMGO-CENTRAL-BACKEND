import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { LoginSession } from '@/lib/models/LoginSession';
import { Activity } from '@/lib/models/Activity';
import { BillingRecord } from '@/lib/models/BillingRecord';
import { ErrorLog } from '@/lib/models/ErrorLog';
import { AutomationLog } from '@/lib/models/AutomationLog';
import { AdminAuditLog } from '@/lib/models/AdminAuditLog';
import { ApiLog } from '@/lib/models/ApiLog';

type Source = 'login' | 'activity' | 'billing' | 'error' | 'automation' | 'admin' | 'api';

interface TimelineItem {
  id: string;
  source: Source;
  timestamp: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'danger' | 'success';
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const sourcesParam = (searchParams.get('sources') || '').trim();
  const limit = Math.min(Number(searchParams.get('limit') || 200), 1000);
  const sources = new Set(sourcesParam ? sourcesParam.split(',').map((s) => s.trim()) : ['login', 'activity', 'billing', 'error', 'automation', 'admin', 'api']);

  await connectToDatabase();
  const user = await User.findById(id).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const queries: Array<Promise<TimelineItem[]>> = [];

  if (sources.has('login')) {
    queries.push((async () => {
      const rows = await LoginSession.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `login_${r._id}`,
        source: 'login' as Source,
        timestamp: new Date(r.lastSeenAt || r.createdAt).toISOString(),
        title: `Sign in from ${r.ipAddress || 'unknown ip'}`,
        detail: `${r.browser || 'unknown browser'} · ${r.device || ''} ${r.revokedAt ? '· revoked' : r.active ? '· active' : '· ended'}`.trim(),
        severity: r.revokedAt ? 'warning' : 'info',
      }));
    })());
  }

  if (sources.has('activity')) {
    queries.push((async () => {
      const rows = await Activity.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `activity_${r._id}`,
        source: 'activity' as Source,
        timestamp: new Date(r.createdAt).toISOString(),
        title: `${r.eventType || 'event'}${r.username ? ` → @${r.username}` : ''}`,
        detail: r.failReason || r.dmPreview || '',
        severity: r.status === 'failed' ? 'danger' : r.status === 'sent' || r.status === 'success' ? 'success' : 'info',
      }));
    })());
  }

  if (sources.has('billing')) {
    queries.push((async () => {
      const rows = await BillingRecord.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `billing_${r._id}`,
        source: 'billing' as Source,
        timestamp: new Date(r.paidAt || r.createdAt).toISOString(),
        title: `${r.type || 'payment'} ${r.amount || 0} ${r.currency || 'INR'}`,
        detail: `${r.status} · ${r.gateway || ''} · ${r.transactionId || ''}`,
        severity: r.status === 'failed' ? 'danger' : r.status === 'paid' || r.status === 'success' ? 'success' : 'info',
      }));
    })());
  }

  if (sources.has('error')) {
    queries.push((async () => {
      const rows = await ErrorLog.find({ userId: id }).sort({ lastSeenAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `error_${r._id}`,
        source: 'error' as Source,
        timestamp: new Date(r.lastSeenAt || r.createdAt).toISOString(),
        title: `${r.errorType || 'Error'} in ${r.module || 'unknown'}`,
        detail: String(r.errorMessage || '').slice(0, 200),
        severity: r.severity === 'critical' || r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warning' : 'info',
      }));
    })());
  }

  if (sources.has('automation')) {
    queries.push((async () => {
      const rows = await AutomationLog.find({ userId: id }).sort({ createdAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `automation_${r._id}`,
        source: 'automation' as Source,
        timestamp: new Date(r.createdAt).toISOString(),
        title: `${r.eventType || 'automation'} · ${r.triggerKeyword || ''}`,
        detail: r.errorMessage || (r.status === 'success' ? `${r.executionDurationMs || 0}ms` : ''),
        severity: r.status === 'failed' ? 'danger' : r.status === 'success' ? 'success' : 'info',
      }));
    })());
  }

  if (sources.has('admin')) {
    queries.push((async () => {
      const rows = await AdminAuditLog.find({
        $or: [{ targetType: 'user', targetId: String(id) }, { targetType: 'instagram_account' }, { 'metadata.userId': String(id) }],
      }).sort({ createdAt: -1 }).limit(limit).lean();
      return (rows as Array<any>).map((r) => ({
        id: `admin_${r._id}`,
        source: 'admin' as Source,
        timestamp: new Date(r.createdAt).toISOString(),
        title: `admin: ${r.action}`,
        detail: `by ${r.actorEmail} on ${r.targetType}/${r.targetId}`,
        severity: 'info',
      }));
    })());
  }

  if (sources.has('api')) {
    queries.push((async () => {
      const rows = await ApiLog.find({ userId: id }).sort({ createdAt: -1 }).limit(50).lean();
      return (rows as Array<any>).map((r) => ({
        id: `api_${r._id}`,
        source: 'api' as Source,
        timestamp: new Date(r.createdAt).toISOString(),
        title: `${r.service} ${r.method} ${r.statusCode}`,
        detail: r.errorMessage || `${r.endpoint} (${r.durationMs}ms)`,
        severity: r.statusCode >= 500 ? 'danger' : r.statusCode >= 400 ? 'warning' : 'info',
      }));
    })());
  }

  const allResults = await Promise.all(queries);
  const merged = allResults.flat().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);

  return NextResponse.json({
    user: { id: String((user as any)._id), name: (user as any).name, email: (user as any).email },
    items: merged,
    counts: {
      login: merged.filter((m) => m.source === 'login').length,
      activity: merged.filter((m) => m.source === 'activity').length,
      billing: merged.filter((m) => m.source === 'billing').length,
      error: merged.filter((m) => m.source === 'error').length,
      automation: merged.filter((m) => m.source === 'automation').length,
      admin: merged.filter((m) => m.source === 'admin').length,
      api: merged.filter((m) => m.source === 'api').length,
    },
  });
}
