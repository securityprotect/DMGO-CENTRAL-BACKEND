import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { ApiLog } from '@/lib/models/ApiLog';
import { ErrorLog } from '@/lib/models/ErrorLog';

interface LogRow {
  id: string;
  timestamp: string;
  source: 'api' | 'error';
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  detail: string;
  statusCode?: number;
  userId?: string;
  errorType?: string;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const sinceId = (searchParams.get('sinceId') || '').trim();
  const level = (searchParams.get('level') || '').trim().toLowerCase();
  const module = (searchParams.get('module') || '').trim();
  const sourceFilter = (searchParams.get('source') || '').trim().toLowerCase();
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);

  await connectToDatabase();

  const apiFilter: Record<string, unknown> = {};
  const errorFilter: Record<string, unknown> = {};

  if (sinceId && mongoose.isValidObjectId(sinceId)) {
    apiFilter._id = { $gt: new mongoose.Types.ObjectId(sinceId) };
    errorFilter._id = { $gt: new mongoose.Types.ObjectId(sinceId) };
  }

  if (module) {
    apiFilter.service = module;
    errorFilter.module = module;
  }

  const wantApi = !sourceFilter || sourceFilter === 'all' || sourceFilter === 'api';
  const wantError = !sourceFilter || sourceFilter === 'all' || sourceFilter === 'error';

  const [apiLogs, errorLogs] = await Promise.all([
    wantApi ? ApiLog.find(apiFilter).sort({ _id: -1 }).limit(limit).lean() : Promise.resolve([] as any[]),
    wantError ? ErrorLog.find(errorFilter).sort({ _id: -1 }).limit(limit).lean() : Promise.resolve([] as any[]),
  ]);

  const apiRows: LogRow[] = (apiLogs as any[]).map((r) => ({
    id: String(r._id),
    timestamp: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    source: 'api',
    level: r.statusCode >= 500 ? 'error' : r.statusCode >= 400 ? 'warn' : 'info',
    module: r.service || 'api',
    message: `${r.method || 'GET'} ${r.endpoint || ''} → ${r.statusCode || 0}`,
    detail: r.errorMessage || (typeof r.durationMs === 'number' ? `${r.durationMs}ms` : ''),
    statusCode: r.statusCode,
    userId: r.userId ? String(r.userId) : undefined,
  }));

  const errorRows: LogRow[] = (errorLogs as any[]).map((r) => ({
    id: String(r._id),
    timestamp: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : new Date(r.createdAt || Date.now()).toISOString(),
    source: 'error',
    level: r.severity === 'critical' || r.severity === 'high' ? 'error' : r.severity === 'medium' ? 'warn' : 'info',
    module: r.module || 'unknown',
    message: `${r.errorType || 'Error'}: ${String(r.errorMessage || '').slice(0, 200)}`,
    detail: r.status ? `status=${r.status} · occurrences=${r.occurrences || 1}` : '',
    userId: r.userId ? String(r.userId) : undefined,
    errorType: r.errorType,
  }));

  const merged = [...apiRows, ...errorRows]
    .filter((r) => {
      if (level && level !== 'all' && r.level !== level) return false;
      if (search) {
        const haystack = `${r.message} ${r.detail} ${r.module}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return NextResponse.json({
    rows: merged,
    lastId: merged[0]?.id || sinceId,
    fetchedAt: new Date().toISOString(),
  });
}
