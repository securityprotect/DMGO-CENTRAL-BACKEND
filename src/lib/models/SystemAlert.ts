import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const systemAlertSchema = new Schema(
  {
    level: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'ack', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

export type SystemAlertDoc = InferSchemaType<typeof systemAlertSchema> & { _id: string };

export const SystemAlert: Model<SystemAlertDoc> =
  mongoose.models.SystemAlert || mongoose.model<SystemAlertDoc>('SystemAlert', systemAlertSchema);
