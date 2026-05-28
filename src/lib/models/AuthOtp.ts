import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const authOtpSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    purpose: { type: String, required: true, enum: ['register', 'forgot-password'], index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

authOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

export type AuthOtpDoc = InferSchemaType<typeof authOtpSchema> & { _id: string };

export const AuthOtp: Model<AuthOtpDoc> =
  mongoose.models.AuthOtp || mongoose.model<AuthOtpDoc>('AuthOtp', authOtpSchema);

