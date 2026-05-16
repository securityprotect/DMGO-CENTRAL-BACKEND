import jwt from 'jsonwebtoken';

function env(name: string, fallback = '') {
  return (process.env[name] || fallback).trim();
}

export function buildInstagramState(userId: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return jwt.sign({ userId }, secret, { expiresIn: '15m' });
}

export function parseInstagramState(state: string): { userId: string } {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return jwt.verify(state, secret) as { userId: string };
}

export function getInstagramOAuthUrl(state: string) {
  const scopes = env(
    'INSTAGRAM_OAUTH_SCOPES',
    'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages'
  );
  const params = new URLSearchParams({
    client_id: env('INSTAGRAM_APP_ID'),
    redirect_uri: env('META_REDIRECT_URI'),
    scope: scopes,
    response_type: 'code',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const body = new URLSearchParams({
    client_id: env('INSTAGRAM_APP_ID'),
    client_secret: env('INSTAGRAM_APP_SECRET'),
    grant_type: 'authorization_code',
    redirect_uri: env('META_REDIRECT_URI'),
    code,
  });

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_message || 'Token exchange failed');
  return data;
}

export async function fetchInstagramProfile(accessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,username,account_type',
    access_token: accessToken,
  });
  const res = await fetch(`https://graph.instagram.com/me?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Profile fetch failed');
  return data;
}

export async function subscribeInstagramAccountToWebhooks(igUserId: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const params = new URLSearchParams({
    subscribed_fields: 'comments,messages,message_reactions,message_postbacks',
    access_token: accessToken,
  });
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${igUserId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'Failed to subscribe IG account to webhooks');
  return data;
}
