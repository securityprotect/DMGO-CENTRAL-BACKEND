import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const automationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    account: { type: String, required: true },
    instagramAccountId: { type: String, default: '', index: true },
    reelUrl: { type: String, required: true },
    reelId: { type: String, default: '' },
    reelCaption: { type: String, default: '' },
    commentReplyTemplate: { type: String, default: '' },
    replyTemplate: { type: String, required: true },
    replyMode: { type: String, enum: ['comment_and_dm', 'dm_only'], default: 'comment_and_dm' },
    keywords: [{ type: String, required: true }],
    automationType: { type: String, default: 'keyword_dm' },
    queueStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'retrying', 'delayed'],
      default: 'pending',
      index: true,
    },
    cooldownHours: { type: Number, default: 24 },
    delaySeconds: { type: Number, default: 5 },
    sendDm: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'paused', 'draft'], default: 'active' },
    dmsSent: { type: Number, default: 0 },
    successRate: { type: Number, default: 100 },
    totalExecutions: { type: Number, default: 0 },
    failedExecutions: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    lastFired: { type: Date, default: null },
  },
  { timestamps: true }
);

export type AutomationDoc = InferSchemaType<typeof automationSchema> & { _id: string };

export const Automation: Model<AutomationDoc> =
  mongoose.models.Automation || mongoose.model<AutomationDoc>('Automation', automationSchema);
