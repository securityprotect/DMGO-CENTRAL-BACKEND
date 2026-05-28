import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const webhookLogSchema = new Schema(
  {
    source: { type: String, default: 'instagram', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    endpoint: { type: String, required: true },
    status: { type: String, enum: ['received', 'processed', 'failed', 'replayed'], default: 'received', index: true },
    responseCode: { type: Number, default: 200 },
    processingTimeMs: { type: Number, default: 0 },
    headers: { type: Schema.Types.Mixed, default: {} },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
    replayable: { type: Boolean, default: true },
    replayedAt: { type: Date, default: null },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true }
);

webhookLogSchema.index({ createdAt: -1 });

export type WebhookLogDoc = InferSchemaType<typeof webhookLogSchema> & { _id: string };

export const WebhookLog: Model<WebhookLogDoc> =
  mongoose.models.WebhookLog || mongoose.model<WebhookLogDoc>('WebhookLog', webhookLogSchema);
