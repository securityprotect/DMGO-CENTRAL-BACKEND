import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const webhookEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: 'instagram', index: true },
    entryId: { type: String, required: true, index: true },
    changeField: { type: String, default: '', index: true },
    commentId: { type: String, default: '', index: true },
    mediaId: { type: String, default: '', index: true },
    senderId: { type: String, default: '', index: true },
    senderUsername: { type: String, default: '' },
    recipientId: { type: String, default: '', index: true },
    commentText: { type: String, default: '' },
    isEcho: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['received', 'processing', 'processed', 'failed', 'skipped', 'duplicate'],
      default: 'received',
      index: true,
    },
    queueJobId: { type: String, default: '', index: true },
    processingStartedAt: { type: Date, default: null },
    traceId: { type: String, default: '', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    instagramAccountId: { type: String, default: '', index: true },
    matchedBy: { type: String, default: '' },
    automationCount: { type: Number, default: 0 },
    processingAttempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

webhookEventSchema.index({ createdAt: -1 });
webhookEventSchema.index({ entryId: 1, mediaId: 1, commentId: 1 });

export type WebhookEventDoc = InferSchemaType<typeof webhookEventSchema> & { _id: string };

export const WebhookEvent: Model<WebhookEventDoc> =
  mongoose.models.WebhookEvent || mongoose.model<WebhookEventDoc>('WebhookEvent', webhookEventSchema);
