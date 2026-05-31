import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { UsageCounter } from '@/lib/models/UsageCounter';
import { getPlanLimits, DM_GRACE_BUFFER, isUnlimited } from '@/lib/billing/planLimits';

/** Current usage period as 'YYYY-MM' in UTC. */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface DmUsage {
  plan: string;
  used: number;
  limit: number;
  percent: number; // 0..100+ (can exceed 100 inside the grace buffer)
  overLimit: boolean;
  graceRemaining: number; // DMs still allowed past the cap (0..DM_GRACE_BUFFER)
  unlimited: boolean;
}

async function resolvePlan(userId: string): Promise<string> {
  const user = await User.findById(userId).select('plan').lean();
  return (user?.plan as string) || 'starter';
}

/** Read-only snapshot of this month's DM usage for a user (for dashboards). */
export async function getDmUsage(userId: string): Promise<DmUsage> {
  await connectToDatabase();
  const plan = await resolvePlan(userId);
  const limit = getPlanLimits(plan).monthlyDms;
  const row = await UsageCounter.findOne({ userId, period: currentPeriod() }).select('dmsSent').lean();
  const used = row?.dmsSent || 0;
  const unlimited = isUnlimited(limit);
  const percent = unlimited || limit === 0 ? 0 : Math.round((used / limit) * 100);
  const overLimit = !unlimited && used >= limit;
  const graceRemaining = unlimited ? DM_GRACE_BUFFER : Math.max(0, limit + DM_GRACE_BUFFER - used);
  return { plan, used, limit, percent, overLimit, graceRemaining, unlimited };
}

export interface ConsumeResult {
  allowed: boolean;
  used: number;
  limit: number;
  overLimit: boolean; // true once past the plain limit (still allowed inside grace)
}

/**
 * Atomically record one DM and decide whether it may be sent.
 * Allowed while used <= limit + DM_GRACE_BUFFER. We increment first (atomic
 * upsert) then compare, so concurrent webhook workers can't race past the cap.
 * The increment is kept even when not allowed, which is harmless (the counter
 * only ever gates further sends) and keeps the buffer strict.
 */
export async function tryConsumeDm(userId: string): Promise<ConsumeResult> {
  await connectToDatabase();
  const plan = await resolvePlan(userId);
  const limit = getPlanLimits(plan).monthlyDms;

  if (isUnlimited(limit)) {
    await UsageCounter.updateOne(
      { userId, period: currentPeriod() },
      { $inc: { dmsSent: 1 } },
      { upsert: true }
    );
    return { allowed: true, used: 0, limit, overLimit: false };
  }

  const row = await UsageCounter.findOneAndUpdate(
    { userId, period: currentPeriod() },
    { $inc: { dmsSent: 1 } },
    { upsert: true, new: true }
  ).lean();

  const used = row?.dmsSent || 1;
  const allowed = used <= limit + DM_GRACE_BUFFER;
  const overLimit = used > limit;
  return { allowed, used, limit, overLimit };
}
