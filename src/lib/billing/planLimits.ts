// Single source of truth for PLAN ENTITLEMENTS (caps), parallel to plans.ts
// which owns pricing. The pricing page (Pricing.tsx) advertises these numbers —
// keep them in sync. Enforced server-side on connect / create / DM-send.

export interface PlanLimits {
  maxAccounts: number;
  maxActiveAutomations: number;
  monthlyDms: number;
}

// Sentinel for "unlimited" — large finite number so comparisons & arithmetic
// stay safe (Infinity would serialize to null in JSON). Treat any limit at or
// above this as unlimited for display.
export const UNLIMITED = 1_000_000;

// "Trusted customer" grace: once a user hits their monthly DM cap we still let
// this many extra DMs through before a hard stop — softens the wall while
// nudging an upgrade.
export const DM_GRACE_BUFFER = 100;

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: { maxAccounts: 1, maxActiveAutomations: 3, monthlyDms: 500 },
  growth: { maxAccounts: 3, maxActiveAutomations: UNLIMITED, monthlyDms: 10_000 },
  agency: { maxAccounts: UNLIMITED, maxActiveAutomations: UNLIMITED, monthlyDms: 100_000 },
};

export function getPlanLimits(plan?: string): PlanLimits {
  return PLAN_LIMITS[plan || 'starter'] ?? PLAN_LIMITS.starter;
}

export function isUnlimited(n: number): boolean {
  return n >= UNLIMITED;
}
