import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'success'], default: 'low', index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: string };

export const Notification: Model<NotificationDoc> =
  mongoose.models.Notification || mongoose.model<NotificationDoc>('Notification', notificationSchema);
