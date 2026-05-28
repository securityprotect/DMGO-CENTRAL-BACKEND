import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    automationId: { type: Schema.Types.ObjectId, ref: 'Automation', required: true },
    username: { type: String, required: true },
    account: { type: String, required: true },
    automation: { type: String, required: true },
    keyword: { type: String, required: true },
    dmPreview: { type: String, required: true },
<<<<<<< HEAD
    eventType: { type: String, default: 'dm_send' },
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
    status: {
      type: String,
      enum: ['sent', 'failed', 'queued', 'rate-limited'],
      default: 'queued',
    },
    retries: { type: Number, default: 0 },
    failReason: { type: String, default: '' },
<<<<<<< HEAD
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
    durationMs: { type: Number, default: 0 },
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
  },
  { timestamps: true }
);

export type ActivityDoc = InferSchemaType<typeof activitySchema> & { _id: string };

export const Activity: Model<ActivityDoc> =
  mongoose.models.Activity || mongoose.model<ActivityDoc>('Activity', activitySchema);
