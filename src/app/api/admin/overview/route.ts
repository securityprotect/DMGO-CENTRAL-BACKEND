import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { Activity } from '@/lib/models/Activity';
import { SupportTicket } from '@/lib/models/SupportTicket';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  const [totalUsers, suspendedUsers, activitiesToday, failedToday, pendingTickets, igConnected] = await Promise.all([
    User.countDocuments({ status: { $ne: 'deleted' } }),
    User.countDocuments({ status: 'suspended' }),
    Activity.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    Activity.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }, status: { $in: ['failed', 'rate-limited'] } }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    InstagramAccount.countDocuments({}),
  ]);

  return NextResponse.json({
    totalUsers,
    suspendedUsers,
    activeUsers: Math.max(totalUsers - suspendedUsers, 0),
    dmsToday: activitiesToday,
    failedDmsToday: failedToday,
    pendingSupportTickets: pendingTickets,
    instagramConnectedAccounts: igConnected,
    apiHealthStatus: failedToday > 25 ? 'red' : failedToday > 8 ? 'yellow' : 'green',
  });
}
