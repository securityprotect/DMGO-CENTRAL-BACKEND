import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { Activity } from '@/lib/models/Activity';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();

  const rows = await Activity.find({}).sort({ createdAt: -1 }).limit(5000).lean();
  const total = rows.length;
  const success = rows.filter((x: any) => x.status === 'sent').length;
  const failed = rows.filter((x: any) => x.status === 'failed' || x.status === 'rate-limited').length;
  const rate = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0;

  const keywordCount = new Map<string, number>();
  for (const r of rows as any[]) {
    const k = String(r.keyword || '').trim();
    if (!k) continue;
    keywordCount.set(k, (keywordCount.get(k) || 0) + 1);
  }
  const topKeywords = [...keywordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([keyword, hits]) => ({ keyword, hits }));

  return NextResponse.json({
    dmDelivery: { total, success, failed, successRate: rate },
    topKeywords,
    growthTrend: [
      { day: 'Mon', accounts: 0 },
      { day: 'Tue', accounts: 0 },
      { day: 'Wed', accounts: 0 },
      { day: 'Thu', accounts: 0 },
      { day: 'Fri', accounts: 0 },
      { day: 'Sat', accounts: 0 },
      { day: 'Sun', accounts: 0 },
    ],
  });
}

