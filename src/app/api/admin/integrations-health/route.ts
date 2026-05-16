import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();

  const rows = await InstagramAccount.find({}).sort({ updatedAt: -1 }).lean();
  const now = Date.now();
  const expiringSoon = rows.filter((x: any) => x.tokenExpiresAt && (new Date(x.tokenExpiresAt).getTime() - now) < 1000 * 60 * 60 * 24).length;
  const expired = rows.filter((x: any) => x.tokenExpiresAt && new Date(x.tokenExpiresAt).getTime() <= now).length;

  return NextResponse.json({
    totalAccounts: rows.length,
    expiringSoon,
    expired,
    apiStatus: expired > 0 ? 'yellow' : 'green',
    encryptionStatus: 'enabled',
    refreshStatus: expiringSoon > 0 ? 'attention' : 'healthy',
    accounts: rows.map((r: any) => ({
      id: String(r._id),
      userId: String(r.userId),
      username: r.username,
      tokenExpiresAt: r.tokenExpiresAt ? new Date(r.tokenExpiresAt).toISOString() : null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    })),
  });
}

