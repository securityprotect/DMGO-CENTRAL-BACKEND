import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const queueJobSchema = new Schema(
  {
    queueName: { type: String, required: true, index: true },
    jobKey: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    jobType: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'retrying', 'delayed', 'canceled'],
      default: 'pending',
      index: true,
    },
    retryCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    availableAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date, default: null },
    lockOwner: { type: String, default: '', index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    processingTimeMs: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

queueJobSchema.index({ createdAt: -1 });
queueJobSchema.index({ queueName: 1, status: 1, availableAt: 1 });
queueJobSchema.index({ queueName: 1, jobKey: 1 }, { unique: true });

export type QueueJobDoc = InferSchemaType<typeof queueJobSchema> & { _id: string };

export const QueueJob: Model<QueueJobDoc> =
  mongoose.models.QueueJob || mongoose.model<QueueJobDoc>('QueueJob', queueJobSchema);
