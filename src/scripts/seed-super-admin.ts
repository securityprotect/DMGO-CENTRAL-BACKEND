import { readFileSync } from 'fs';
import { resolve } from 'path';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

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

  const email = (process.env.SUPER_ADMIN_EMAIL || 'super.admin@dmgo.in').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';

  if (!password) {
    console.error('Set SUPER_ADMIN_PASSWORD env var before running this script.');
    process.exit(1);
  }

  await connectToDatabase();

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ email });

  if (existing) {
    existing.passwordHash = passwordHash;
    (existing as any).role = 'admin';
    (existing as any).status = 'active';
    (existing as any).name = name;
    await existing.save();
    console.log(`Updated existing user ${email} -> role=admin, password reset.`);
  } else {
    await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      plan: 'enterprise',
      subscriptionStatus: 'active',
    });
    console.log(`Created super admin ${email}.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
