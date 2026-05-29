import jwt from 'jsonwebtoken';

function env(name: string, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function redirectUri() {
  return (process.env.META_REDIRECT_URI || process.env.INSTAGRAM_REDIRECT_URI || '').trim();
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
    redirect_uri: redirectUri(),
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
    redirect_uri: redirectUri(),
    code,
  });

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_message || 'Token exchange failed');

  const shortLived = String(data?.access_token || '').trim();
  if (!shortLived) throw new Error('Short-lived token missing from Instagram response');

  const longLived = await exchangeForLongLivedToken(shortLived);
  return {
    ...data,
    access_token: longLived.access_token,
    token_type: longLived.token_type || data.token_type,
    expires_in: longLived.expires_in,
  };
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env('INSTAGRAM_APP_SECRET'),
    access_token: shortLivedToken,
  });
  const res = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error?.message || data?.error_message || 'Long-lived token exchange failed');
  }
  return data as { access_token: string; token_type?: string; expires_in?: number };
}

export async function refreshLongLivedToken(longLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: longLivedToken,
  });
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error?.message || data?.error_message || 'Long-lived token refresh failed');
  }
  return data as { access_token: string; token_type?: string; expires_in?: number };
}

export async function fetchInstagramProfile(accessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,username,account_type',
  });
  const res = await fetch(`https://graph.instagram.com/me?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${String(accessToken || '').trim()}`,
      Accept: 'application/json',
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Profile fetch failed');
  return data;
}

export async function subscribeInstagramAccountToWebhooks(igUserId: string, accessToken: string) {
  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const subscribedFields = process.env.INSTAGRAM_WEBHOOK_FIELDS
    || 'messages,messaging_postbacks,messaging_seen,messaging_reactions,messaging_referral,comments,live_comments,mentions';
  const params = new URLSearchParams({
    subscribed_fields: subscribedFields,
    access_token: accessToken,
  });
  const res = await fetch(`https://graph.instagram.com/${graphVersion}/${igUserId}/subscribed_apps?${params.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'Failed to subscribe IG account to webhooks');
  return data;
}
