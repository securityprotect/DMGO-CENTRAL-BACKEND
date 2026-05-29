import { NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { ErrorLog } from '@/lib/models/ErrorLog';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const severity = (searchParams.get('severity') || '').trim().toLowerCase();
  const module = (searchParams.get('module') || '').trim();
  const status = (searchParams.get('status') || '').trim().toLowerCase();
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const page = Math.max(Number(searchParams.get('page') || 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 25), 1), 200);

  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (severity && severity !== 'all') filter.severity = severity;
  if (status && status !== 'all') filter.status = status;
  if (module) filter.module = module;

  const all = await ErrorLog.find(filter).sort({ lastSeenAt: -1 }).limit(1000).lean();
  const filtered = (all as Array<Record<string, unknown>>).filter((row) => {
    if (!search) return true;
    const haystack = [row.errorType, row.errorMessage, row.module].join(' ').toLowerCase();
    return haystack.includes(search);
  });

  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize).map((row: any) => ({
    id: String(row._id),
    severity: row.severity,
    module: row.module,
    errorType: row.errorType || 'Error',
    errorMessage: String(row.errorMessage || '').slice(0, 500),
    occurrences: Number(row.occurrences || 1),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    status: row.status,
    affectedUsersCount: Array.isArray(row.affectedUsers) ? row.affectedUsers.length : 0,
  }));

  const summary = {
    open: filtered.filter((r: any) => r.status === 'open').length,
    investigating: filtered.filter((r: any) => r.status === 'investigating').length,
    mitigated: filtered.filter((r: any) => r.status === 'mitigated').length,
    resolved: filtered.filter((r: any) => r.status === 'resolved').length,
    critical: filtered.filter((r: any) => r.severity === 'critical').length,
  };

  const modules = await ErrorLog.distinct('module');

  return NextResponse.json({
    rows,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    summary,
    modules,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const action = String(body.action || '');

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const statusMap: Record<string, string> = {
    resolve: 'resolved',
    investigate: 'investigating',
    mitigate: 'mitigated',
    reopen: 'open',
  };
  const newStatus = statusMap[action];
  if (!newStatus) return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });

  await connectToDatabase();
  const updated = await ErrorLog.findByIdAndUpdate(id, { $set: { status: newStatus } }, { new: true });
  if (!updated) return NextResponse.json({ error: 'Error log not found' }, { status: 404 });

  await logAdminAction({
    actorUserId: String((auth.user as any)._id),
    actorEmail: String((auth.user as any).email),
    action: `error_${action}`,
    targetType: 'error_log',
    targetId: id,
    metadata: { newStatus },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
