import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const queueJobSchema = new Schema(
  {
    queueName: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    jobType: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'retrying', 'delayed', 'canceled'],
      default: 'pending',
      index: true,
    },
    retryCount: { type: Number, default: 0 },
    payload: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    processingTimeMs: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

queueJobSchema.index({ createdAt: -1 });

export type QueueJobDoc = InferSchemaType<typeof queueJobSchema> & { _id: string };

export const QueueJob: Model<QueueJobDoc> =
  mongoose.models.QueueJob || mongoose.model<QueueJobDoc>('QueueJob', queueJobSchema);
