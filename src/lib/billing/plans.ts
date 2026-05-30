// Single source of truth for plan pricing. Amounts are in INR (whole rupees).
// SECURITY: the server NEVER trusts an amount sent from the client — it always
// resolves the price from this table using planId + billingCycle.

export type BillingCycle = 'monthly' | 'annual';

export interface PlanPricing {
  id: string;
  name: string;
  // price the customer is charged right now, in whole rupees
  monthly: number; // charged once for one month
  annual: number; // charged once for a full year (12 months upfront)
  // the "/mo" figure shown on the card for the annual plan (cosmetic only)
  annualPerMonth: number;
}

export const PLANS: Record<string, PlanPricing> = {
  growth: {
    id: 'growth',
    name: 'Growth',
    monthly: 99,
    annual: 49 * 12, // ₹588 charged once
    annualPerMonth: 49,
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    monthly: 199,
    annual: 149 * 12, // ₹1,788 charged once
    annualPerMonth: 149,
  },
};

export function isPaidPlan(planId: string): planId is keyof typeof PLANS {
  return Object.prototype.hasOwnProperty.call(PLANS, planId);
}

/** Resolve the authoritative amount (in rupees) for a plan + cycle. */
export function resolveAmount(planId: string, cycle: BillingCycle): number | null {
  const plan = PLANS[planId];
  if (!plan) return null;
  return cycle === 'annual' ? plan.annual : plan.monthly;
}

/** How long a paid period lasts, used to compute subscription end date. */
export function periodEnd(from: Date, cycle: BillingCycle): Date {
  const end = new Date(from);
  if (cycle === 'annual') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}
