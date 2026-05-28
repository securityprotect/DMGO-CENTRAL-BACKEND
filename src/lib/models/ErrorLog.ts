import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const errorLogSchema = new Schema(
  {
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium', index: true },
    module: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    errorType: { type: String, default: 'Error' },
    errorMessage: { type: String, required: true },
    stackTrace: { type: String, default: '' },
    occurrences: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['open', 'investigating', 'mitigated', 'resolved'], default: 'open', index: true },
    affectedUsers: { type: Schema.Types.Mixed, default: [] },
    retryPayload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

errorLogSchema.index({ lastSeenAt: -1 });

export type ErrorLogDoc = InferSchemaType<typeof errorLogSchema> & { _id: string };

export const ErrorLog: Model<ErrorLogDoc> =
  mongoose.models.ErrorLog || mongoose.model<ErrorLogDoc>('ErrorLog', errorLogSchema);
