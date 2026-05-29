import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import {
  exchangeCodeForToken,
  fetchInstagramProfile,
  parseInstagramState,
  subscribeInstagramAccountToWebhooks,
} from '@/lib/services/instagram';
import { setAuthCookie, signAuthToken } from '@/lib/auth/session';

export async function GET(req: Request) {
  const webUrl = (process.env.WEB_URL || 'http://localhost:4028').trim();
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(`${webUrl}/dashboard?connected=0`);
  }

  try {
    const { userId } = parseInstagramState(state);
    const tokenData = await exchangeCodeForToken(code);
    const accessToken = String(tokenData.access_token || '').trim();
    const profile = await fetchInstagramProfile(accessToken);

    await connectToDatabase();
    await InstagramAccount.findOneAndUpdate(
      { igUserId: String(profile.id) },
      {
        $set: {
          userId,
          igUserId: String(profile.id),
          webhookUserId: String(profile.id),
          username: profile.username,
          accountType: profile.account_type || 'PROFESSIONAL',
          accessToken,
          tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000) : null,
          webhookSubscriptionStatus: 'healthy',
          reconnectRequired: false,
        },
      },
      { upsert: true, new: true }
    );

    try {
      await subscribeInstagramAccountToWebhooks(String(profile.id), accessToken);
      console.log('[IG_CONNECT] subscribed to webhooks for igUserId=', String(profile.id));
    } catch (subscribeError) {
      const msg = subscribeError instanceof Error ? subscribeError.message : 'unknown subscribe error';
      console.log('[IG_CONNECT] webhook subscribe failed for igUserId=', String(profile.id), 'reason=', msg);
    }

    const res = NextResponse.redirect(`${webUrl}/dashboard?connected=1`);
    const token = signAuthToken(userId);
    res.cookies.set(setAuthCookie(token));
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagram connect failed';
    return NextResponse.redirect(`${webUrl}/dashboard?connected=0&error=${encodeURIComponent(message)}`);
  }
}
