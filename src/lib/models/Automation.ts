import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const automationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    account: { type: String, required: true },
    reelUrl: { type: String, required: true },
    reelId: { type: String, default: '' },
    reelCaption: { type: String, default: '' },
    commentReplyTemplate: { type: String, default: '' },
    replyTemplate: { type: String, required: true },
    replyMode: { type: String, enum: ['comment_and_dm', 'dm_only'], default: 'comment_and_dm' },
    keywords: [{ type: String, required: true }],
    cooldownHours: { type: Number, default: 24 },
    delaySeconds: { type: Number, default: 5 },
    sendDm: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'paused', 'draft'], default: 'active' },
    dmsSent: { type: Number, default: 0 },
    successRate: { type: Number, default: 100 },
    lastFired: { type: Date, default: null },
  },
  { timestamps: true }
);

export type AutomationDoc = InferSchemaType<typeof automationSchema> & { _id: string };

export const Automation: Model<AutomationDoc> =
  mongoose.models.Automation || mongoose.model<AutomationDoc>('Automation', automationSchema);
