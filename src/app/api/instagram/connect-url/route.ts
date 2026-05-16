import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { buildInstagramState, getInstagramOAuthUrl } from '@/lib/services/instagram';

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const state = buildInstagramState(String(user._id));
  const url = getInstagramOAuthUrl(state);
  return NextResponse.json({ url });
}
