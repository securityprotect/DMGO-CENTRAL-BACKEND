import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

// Per-user, per-month usage counter. The `period` key ('YYYY-MM') means month
// rollover is automatic: a new month resolves to a new row that starts at 0,
// so no scheduled reset job is required. Only DMs are metered today; add more
// counters here if other metered actions appear.
const usageCounterSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period: { type: String, required: true }, // 'YYYY-MM' (UTC)
    dmsSent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One row per user per month.
usageCounterSchema.index({ userId: 1, period: 1 }, { unique: true });

export type UsageCounterDoc = InferSchemaType<typeof usageCounterSchema> & { _id: string };

export const UsageCounter: Model<UsageCounterDoc> =
  mongoose.models.UsageCounter || mongoose.model<UsageCounterDoc>('UsageCounter', usageCounterSchema);
