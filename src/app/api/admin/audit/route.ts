import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { AdminAuditLog } from '@/lib/models/AdminAuditLog';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();
  const rows = await AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(400).lean();
  return NextResponse.json({ logs: rows });
}

