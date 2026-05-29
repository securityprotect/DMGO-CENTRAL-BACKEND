import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireAdmin } from '@/lib/admin/auth';
import { connectToDatabase } from '@/lib/mongodb';
import { SystemHealthLog } from '@/lib/models/SystemHealthLog';

const TRACKED_ENV_VARS = [
  { name: 'NODE_ENV', critical: true },
  { name: 'MONGODB_URI', critical: true, mask: true },
  { name: 'MONGODB_DB', critical: false },
  { name: 'JWT_SECRET', critical: true, mask: true },
  { name: 'JWT_EXPIRES_IN', critical: false },
  { name: 'AUTH_COOKIE_SAMESITE', critical: false },
  { name: 'CORS_ORIGINS', critical: true },
  { name: 'ADMIN_EMAILS', critical: true },
  { name: 'INSTAGRAM_APP_ID', critical: true },
  { name: 'INSTAGRAM_APP_SECRET', critical: true, mask: true },
  { name: 'INSTAGRAM_VERIFY_TOKEN', critical: true, mask: true },
  { name: 'META_REDIRECT_URI', critical: true },
  { name: 'META_GRAPH_VERSION', critical: false },
  { name: 'INSTAGRAM_OAUTH_SCOPES', critical: false },
  { name: 'INSTAGRAM_WEBHOOK_FIELDS', critical: false },
  { name: 'WEB_URL', critical: true },
  { name: 'PUBLIC_FRONTEND_ORIGIN', critical: false },
  { name: 'RAZORPAY_KEY_ID', critical: false },
  { name: 'RAZORPAY_KEY_SECRET', critical: false, mask: true },
  { name: 'RAZORPAY_CALLBACK_URL', critical: false },
  { name: 'RESEND_API_KEY', critical: false, mask: true },
  { name: 'EMAIL_FROM', critical: false },
  { name: 'WORKER_POLL_INTERVAL_MS', critical: false },
  { name: 'RATE_LIMIT_WINDOW_MS', critical: false },
  { name: 'RATE_LIMIT_MAX', critical: false },
];

const COLLECTIONS = [
  'users', 'instagramaccounts', 'automations', 'automationlogs',
  'webhooklogs', 'webhookevents', 'queuejobs', 'apilogs', 'errorlogs',
  'systemhealthlogs', 'systemalerts', 'supporttickets', 'ticketmessages',
  'billingrecords', 'subscriptions', 'activities', 'adminauditlogs',
  'loginsessions', 'notifications', 'featureflags',
];

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)} (${value.length} chars)`;
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  await connectToDatabase();
  const db = mongoose.connection.db;

  const collectionCounts: Array<{ name: string; count: number; error?: string }> = [];
  if (db) {
    await Promise.all(COLLECTIONS.map(async (name) => {
      try {
        const count = await db.collection(name).estimatedDocumentCount();
        collectionCounts.push({ name, count });
      } catch (err) {
        collectionCounts.push({ name, count: 0, error: err instanceof Error ? err.message : 'count failed' });
      }
    }));
  }
  collectionCounts.sort((a, b) => b.count - a.count);

  const envChecks = TRACKED_ENV_VARS.map((cfg) => {
    const raw = process.env[cfg.name] || '';
    const present = raw.length > 0;
    return {
      name: cfg.name,
      present,
      critical: cfg.critical,
      value: present ? (cfg.mask ? maskSecret(raw) : (raw.length > 120 ? `${raw.slice(0, 120)}…` : raw)) : null,
      status: present ? 'set' : (cfg.critical ? 'missing-critical' : 'missing-optional'),
    };
  });

  const memory = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  const services = await SystemHealthLog.find({}).sort({ updatedAt: -1 }).lean();
  const serviceHealth = (services as Array<any>).map((s) => ({
    name: s.serviceName,
    status: s.status,
    lastSeenAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    uptimePercent: Number(s.uptimePercent || 0),
    responseTimeMs: Number(s.responseTimeMs || 0),
  }));

  return NextResponse.json({
    backend: {
      uptimeSeconds,
      uptimeHuman: humanDuration(uptimeSeconds),
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
      commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null,
      branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || null,
      deployedAt: process.env.RENDER_DEPLOYED_AT || process.env.DEPLOYED_AT || null,
      renderService: process.env.RENDER_SERVICE_NAME || null,
    },
    mongo: {
      connected: mongoose.connection.readyState === 1,
      dbName: db?.databaseName || null,
      collections: collectionCounts,
      totalDocs: collectionCounts.reduce((sum, c) => sum + c.count, 0),
    },
    env: {
      checks: envChecks,
      criticalMissing: envChecks.filter((c) => c.status === 'missing-critical').length,
    },
    services: serviceHealth,
    generatedAt: new Date().toISOString(),
  });
}

function humanDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
