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
    status: {
      type: String,
      enum: ['sent', 'failed', 'queued', 'rate-limited'],
      default: 'queued',
    },
    retries: { type: Number, default: 0 },
    failReason: { type: String, default: '' },
  },
  { timestamps: true }
);

export type ActivityDoc = InferSchemaType<typeof activitySchema> & { _id: string };

export const Activity: Model<ActivityDoc> =
  mongoose.models.Activity || mongoose.model<ActivityDoc>('Activity', activitySchema);
