import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const automationLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    automationId: { type: Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
    eventType: { type: String, default: 'automation_execution' },
    status: { type: String, enum: ['success', 'failed', 'queued', 'skipped'], default: 'queued', index: true },
    triggerKeyword: { type: String, default: '' },
    incomingWebhookPayload: { type: Schema.Types.Mixed, default: {} },
    outgoingApiRequest: { type: Schema.Types.Mixed, default: {} },
    instagramApiResponse: { type: Schema.Types.Mixed, default: {} },
    executionFlow: { type: Schema.Types.Mixed, default: [] },
    executionDurationMs: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

automationLogSchema.index({ createdAt: -1 });

export type AutomationLogDoc = InferSchemaType<typeof automationLogSchema> & { _id: string };

export const AutomationLog: Model<AutomationLogDoc> =
  mongoose.models.AutomationLog || mongoose.model<AutomationLogDoc>('AutomationLog', automationLogSchema);
