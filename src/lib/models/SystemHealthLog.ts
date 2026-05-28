import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const systemHealthLogSchema = new Schema(
  {
    serviceName: { type: String, required: true, index: true },
    status: { type: String, enum: ['healthy', 'degraded', 'investigating', 'down'], default: 'healthy' },
    responseTimeMs: { type: Number, default: 0 },
    lastIncident: { type: String, default: '' },
    uptimePercent: { type: Number, default: 100 },
  },
  { timestamps: true }
);

systemHealthLogSchema.index({ createdAt: -1 });

export type SystemHealthLogDoc = InferSchemaType<typeof systemHealthLogSchema> & { _id: string };

export const SystemHealthLog: Model<SystemHealthLogDoc> =
  mongoose.models.SystemHealthLog || mongoose.model<SystemHealthLogDoc>('SystemHealthLog', systemHealthLogSchema);
