import { readFileSync } from 'fs';
import { resolve } from 'path';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { refreshLongLivedToken } from '@/lib/services/instagram';

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const key = match[1];
      if (process.env[key]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
  }
}

async function main() {
  loadDotEnv();
  await connectToDatabase();

  const refreshThresholdMs = 14 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() + refreshThresholdMs);

  const accounts = await InstagramAccount.find({
    accessToken: { $exists: true, $ne: '' },
    $or: [
      { tokenExpiresAt: null },
      { tokenExpiresAt: { $lte: cutoff } },
    ],
  }).lean();

  console.log(`[REFRESH_TOKENS] candidates=${accounts.length}`);

  let refreshed = 0;
  let failed = 0;
  for (const account of accounts as Array<{ _id: unknown; igUserId: string; accessToken: string; username?: string }>) {
    try {
      const data = await refreshLongLivedToken(account.accessToken);
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
      await InstagramAccount.updateOne(
        { _id: account._id },
        {
          $set: {
            accessToken: data.access_token,
            tokenExpiresAt: expiresAt,
            lastTokenRefreshAt: new Date(),
            connectionStatus: 'connected',
            reconnectRequired: false,
          },
        }
      );
      refreshed += 1;
      console.log(`[REFRESH_TOKENS] ok igUserId=${account.igUserId} username=${account.username || ''} expires=${expiresAt?.toISOString() || 'unknown'}`);
    } catch (error) {
      failed += 1;
      const msg = error instanceof Error ? error.message : 'unknown error';
      await InstagramAccount.updateOne(
        { _id: account._id },
        { $set: { connectionStatus: 'token_expired', reconnectRequired: true } }
      );
      console.error(`[REFRESH_TOKENS] fail igUserId=${account.igUserId} reason=${msg}`);
    }
  }

  console.log(`[REFRESH_TOKENS] done refreshed=${refreshed} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
