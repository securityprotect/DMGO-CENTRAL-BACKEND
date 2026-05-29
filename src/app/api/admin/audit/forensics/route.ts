import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { AdminAuditLog } from '@/lib/models/AdminAuditLog';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const actor = (searchParams.get('actor') || '').trim();
  const targetType = (searchParams.get('targetType') || '').trim();
  const action = (searchParams.get('action') || '').trim();
  const dateFrom = (searchParams.get('dateFrom') || '').trim();
  const dateTo = (searchParams.get('dateTo') || '').trim();
  const exportCsv = searchParams.get('export') === 'csv';
  const page = Math.max(Number(searchParams.get('page') || 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 50), 1), 500);

  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (actor) filter.actorEmail = { $regex: actor, $options: 'i' };
  if (targetType) filter.targetType = targetType;
  if (action) filter.action = { $regex: action, $options: 'i' };
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {};
    if (dateFrom) range.$gte = new Date(dateFrom);
    if (dateTo) range.$lte = new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000);
    filter.createdAt = range;
  }

  const all = await AdminAuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();

  const filtered = (all as Array<any>).filter((row) => {
    if (!search) return true;
    const haystack = [
      row.actorEmail, row.action, row.targetType, row.targetId, row.ipAddress,
      JSON.stringify(row.beforeState || ''), JSON.stringify(row.afterState || ''), JSON.stringify(row.metadata || ''),
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });

  const actors = await AdminAuditLog.distinct('actorEmail');
  const targetTypes = await AdminAuditLog.distinct('targetType');
  const actions = await AdminAuditLog.distinct('action');

  if (exportCsv) {
    const cols = ['createdAt', 'actorEmail', 'action', 'targetType', 'targetId', 'ipAddress', 'metadata'];
    const csv = [
      cols.join(','),
      ...filtered.map((row: any) => cols.map((c) => {
        const v = c === 'metadata' ? JSON.stringify(row.metadata || {}) : c === 'createdAt' ? new Date(row.createdAt).toISOString() : String(row[c] ?? '');
        return `"${v.replace(/"/g, '""')}"`;
      }).join(',')),
    ].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-${Date.now()}.csv"`,
      },
    });
  }

  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize).map((row: any) => ({
    id: String(row._id),
    timestamp: row.createdAt,
    actor: row.actorEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    ipAddress: row.ipAddress || '',
    beforeState: row.beforeState,
    afterState: row.afterState,
    metadata: row.metadata || {},
  }));

  return NextResponse.json({
    rows,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    filters: { actors, targetTypes, actions: actions.slice(0, 100) },
  });
}
