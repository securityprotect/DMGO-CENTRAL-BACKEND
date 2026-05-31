import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { buildInstagramState, getInstagramOAuthUrl } from '@/lib/services/instagram';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { getPlanLimits, isUnlimited } from '@/lib/billing/planLimits';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Enforce the per-plan Instagram account cap before sending the user off to
  // Instagram. Grandfathered: we only block adding NEW accounts past the limit;
  // existing accounts keep working and can be reconnected (callback upserts).
  await connectToDatabase();
  const plan = (user.plan as string) || 'starter';
  const limit = getPlanLimits(plan).maxAccounts;
  if (!isUnlimited(limit)) {
    const count = await InstagramAccount.countDocuments({ userId: user._id });
    if (count >= limit) {
      return NextResponse.json(
        {
          error: `Your ${plan} plan allows ${limit} Instagram account${limit > 1 ? 's' : ''}. Upgrade to connect more.`,
          code: 'account_limit',
          limit,
          plan,
        },
        { status: 403 }
      );
    }
  }

  const state = buildInstagramState(String(user._id));
  const url = getInstagramOAuthUrl(state);
  return NextResponse.json({ url });
}
