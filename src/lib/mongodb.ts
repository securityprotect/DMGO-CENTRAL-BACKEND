import mongoose from 'mongoose';

declare global {
  var mongooseConn: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const globalCache = global.mongooseConn || { conn: null, promise: null };

export async function connectToDatabase() {
  if (globalCache.conn) return globalCache.conn;

  const rawUri = process.env.MONGODB_URI;
  const uri = rawUri?.trim().replace(/^['"]|['"]$/g, '');
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  // Guard against malformed URI query like `appName=` with empty value.
  const normalizedUri = uri
    .replace(/([?&])appName=(&|$)/, '$1')
    .replace(/[?&]$/, '');

  if (!globalCache.promise) {
    globalCache.promise = mongoose.connect(normalizedUri, {
      dbName: process.env.MONGODB_DB || 'dmgo_prime',
      autoIndex: true,
    });
  }

  globalCache.conn = await globalCache.promise;
  global.mongooseConn = globalCache;
  return globalCache.conn;
}
