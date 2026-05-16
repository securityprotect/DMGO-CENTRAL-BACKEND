import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const instagramAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    igUserId: { type: String, required: true, unique: true },
    webhookUserId: { type: String, default: '', index: true },
    username: { type: String, required: true },
    accountType: { type: String, default: 'PROFESSIONAL' },
    profilePictureUrl: { type: String, default: '' },
    accessToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type InstagramAccountDoc = InferSchemaType<typeof instagramAccountSchema> & { _id: string };

export const InstagramAccount: Model<InstagramAccountDoc> =
  mongoose.models.InstagramAccount || mongoose.model<InstagramAccountDoc>('InstagramAccount', instagramAccountSchema);
