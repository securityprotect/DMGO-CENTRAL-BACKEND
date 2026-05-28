import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  const users = await User.find({ status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({
    users: users.map((u: any) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      plan: u.plan || 'starter',
      role: u.role || 'creator',
      status: u.status || 'active',
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
      lastLoginIp: u.lastLoginIp || '',
      loginFailures24h: u.loginFailures24h || 0,
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    })),
  });
}
