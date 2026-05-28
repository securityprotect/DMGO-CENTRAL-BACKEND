import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const loginSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    adminUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ipAddress: { type: String, default: '' },
    device: { type: String, default: '' },
    browser: { type: String, default: '' },
    country: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type LoginSessionDoc = InferSchemaType<typeof loginSessionSchema> & { _id: string };

export const LoginSession: Model<LoginSessionDoc> =
  mongoose.models.LoginSession || mongoose.model<LoginSessionDoc>('LoginSession', loginSessionSchema);
