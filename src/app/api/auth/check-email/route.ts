import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';

// Lightweight existence check used by the checkout page to decide whether to
// ask for a password (existing account) or full sign-up details (new account).
// Returns only a boolean — never leaks any user data.
export async function POST(req: Request) {
  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  await connectToDatabase();
  const existing = await User.findOne({ email }).select('_id name plan').lean();

  return NextResponse.json({
    exists: !!existing,
    name: existing?.name || '',
    plan: existing?.plan || '',
  });
}
