import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const apiLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    service: { type: String, required: true, index: true },
    method: { type: String, default: 'GET' },
    endpoint: { type: String, required: true },
    statusCode: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    requestPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

apiLogSchema.index({ createdAt: -1 });

export type ApiLogDoc = InferSchemaType<typeof apiLogSchema> & { _id: string };

export const ApiLog: Model<ApiLogDoc> =
  mongoose.models.ApiLog || mongoose.model<ApiLogDoc>('ApiLog', apiLogSchema);
