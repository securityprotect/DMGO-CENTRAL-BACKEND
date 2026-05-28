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
<<<<<<< HEAD
    gateway: { type: String, default: 'razorpay' },
    transactionId: { type: String, default: '' },
    invoiceUrl: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    renewalDate: { type: Date, default: null },
    refundStatus: { type: String, default: '' },
=======
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
  },
  { timestamps: true }
);

export type BillingRecordDoc = InferSchemaType<typeof billingRecordSchema> & { _id: string };

export const BillingRecord: Model<BillingRecordDoc> =
  mongoose.models.BillingRecord || mongoose.model<BillingRecordDoc>('BillingRecord', billingRecordSchema);
