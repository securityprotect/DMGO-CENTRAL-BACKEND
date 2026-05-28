import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const instagramAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    igUserId: { type: String, required: true, unique: true },
    webhookUserId: { type: String, default: '', index: true },
    username: { type: String, required: true },
    accountType: { type: String, default: 'PROFESSIONAL' },
<<<<<<< HEAD
    businessAccountStatus: { type: String, default: 'unknown' },
    profilePictureUrl: { type: String, default: '' },
    accessToken: { type: String, required: true },
    encryptedAccessToken: { type: String, default: '' },
    encryptedRefreshToken: { type: String, default: '' },
    tokenExpiresAt: { type: Date, default: null },
    connectionStatus: {
      type: String,
      enum: ['connected', 'disconnected', 'token_expired', 'rate_limited', 'webhook_failed'],
      default: 'connected',
      index: true,
    },
    lastSyncAt: { type: Date, default: null },
    webhookStatus: { type: String, default: 'healthy' },
    reconnectRequired: { type: Boolean, default: false },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    dmsSentToday: { type: Number, default: 0 },
    dailyLimit: { type: Number, default: 250 },
    apiErrorCount: { type: Number, default: 0 },
=======
    profilePictureUrl: { type: String, default: '' },
    accessToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, default: null },
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
  },
  { timestamps: true }
);

export type InstagramAccountDoc = InferSchemaType<typeof instagramAccountSchema> & { _id: string };

export const InstagramAccount: Model<InstagramAccountDoc> =
  mongoose.models.InstagramAccount || mongoose.model<InstagramAccountDoc>('InstagramAccount', instagramAccountSchema);
