import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  await connectToDatabase();
  const automations = await Automation.find({ status: 'active' }).lean();

  const keywordMap = new Map<string, string[]>();
  for (const a of automations as any[]) {
    for (const raw of (a.keywords || [])) {
      const k = String(raw || '').trim().toLowerCase();
      if (!k) continue;
      const arr = keywordMap.get(k) || [];
      arr.push(`${a.name} (${a.account})`);
      keywordMap.set(k, arr);
    }
  }

  const conflicts = [...keywordMap.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([keyword, automations]) => ({ keyword, automations }));

  return NextResponse.json({ conflicts });
}

