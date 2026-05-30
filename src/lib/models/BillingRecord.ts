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
    gateway: { type: String, default: 'razorpay' },
    transactionId: { type: String, default: '' },
    invoiceUrl: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    renewalDate: { type: Date, default: null },
    refundStatus: { type: String, default: '' },
    // Payer contact captured at checkout (from Razorpay payment entity).
    customerEmail: { type: String, default: '' },
    customerContact: { type: String, default: '' },
    customerName: { type: String, default: '' },
    planId: { type: String, default: '' },
    billingCycle: { type: String, default: '' },
  },
  { timestamps: true }
);

export type BillingRecordDoc = InferSchemaType<typeof billingRecordSchema> & { _id: string };

export const BillingRecord: Model<BillingRecordDoc> =
  mongoose.models.BillingRecord || mongoose.model<BillingRecordDoc>('BillingRecord', billingRecordSchema);
