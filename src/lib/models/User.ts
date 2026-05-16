import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    plan: { type: String, default: 'starter' },
    role: { type: String, enum: ['creator', 'agency', 'admin'], default: 'creator', index: true },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
    resetPasswordTokenHash: { type: String, default: '' },
    resetPasswordExpiresAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },
    loginFailures24h: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };

export const User: Model<UserDoc> =
  mongoose.models.User || mongoose.model<UserDoc>('User', userSchema);
