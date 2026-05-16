import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const billingRecordSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['paid', 'pending', 'failed', 'refunded'], default: 'paid' },
    type: { type: String, enum: ['invoice', 'refund', 'credit'], default: 'invoice' },
    description: { type: String, default: '' },
    providerRef: { type: String, default: '' },
  },
  { timestamps: true }
);

export type BillingRecordDoc = InferSchemaType<typeof billingRecordSchema> & { _id: string };

export const BillingRecord: Model<BillingRecordDoc> =
  mongoose.models.BillingRecord || mongoose.model<BillingRecordDoc>('BillingRecord', billingRecordSchema);
