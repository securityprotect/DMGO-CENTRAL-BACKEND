import { connectToDatabase } from '@/lib/mongodb';
import { Automation } from '@/lib/models/Automation';
import { InstagramAccount } from '@/lib/models/InstagramAccount';
import { createLogger } from '@/lib/observability/logger';

function normalizeInstagramHandle(value: string) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

async function main() {
  const logger = createLogger({ scope: 'backfill-instagram-mapping' });
  await connectToDatabase();

  const accounts = await InstagramAccount.find({}).lean();
  let accountsUpdated = 0;
  for (const account of accounts as any[]) {
    const webhookUserId = String(account.webhookUserId || '').trim() || String(account.igUserId || '').trim();
    if (webhookUserId !== String(account.webhookUserId || '').trim()) {
      await InstagramAccount.updateOne({ _id: account._id }, { $set: { webhookUserId } });
      accountsUpdated += 1;
    }
  }

  const automations = await Automation.find({}).lean();
  let automationsUpdated = 0;
  for (const automation of automations as any[]) {
    if (String(automation.instagramAccountId || '').trim()) continue;
    const normalizedHandle = normalizeInstagramHandle(automation.account);
    const account = accounts.find((candidate: any) => {
      const candidateHandle = normalizeInstagramHandle(candidate.username);
      return candidate.userId?.toString?.() === automation.userId?.toString?.() && candidateHandle === normalizedHandle;
    }) as any;
    if (account) {
      await Automation.updateOne({ _id: automation._id }, { $set: { instagramAccountId: String(account._id) } });
      automationsUpdated += 1;
    }
  }

  logger.info({ accountsUpdated, automationsUpdated }, 'instagram mapping backfill complete');
}

main().catch((error) => {
  console.error('[backfill-instagram-mapping] failed', error);
  process.exitCode = 1;
});

