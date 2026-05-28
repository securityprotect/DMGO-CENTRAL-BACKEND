import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, required: true },
    status: { type: String, enum: ['active', 'trialing', 'past_due', 'canceled', 'expired'], default: 'trialing', index: true },
    gateway: { type: String, default: 'razorpay' },
    externalId: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },
    renewalStatus: { type: String, default: 'manual' },
    renewalDate: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema> & { _id: string };

export const Subscription: Model<SubscriptionDoc> =
  mongoose.models.Subscription || mongoose.model<SubscriptionDoc>('Subscription', subscriptionSchema);
