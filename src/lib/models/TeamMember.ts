import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const teamMemberSchema = new Schema(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, lowercase: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['admin', 'editor', 'viewer'], default: 'viewer' },
    status: { type: String, enum: ['invited', 'active'], default: 'invited' },
  },
  { timestamps: true }
);

export type TeamMemberDoc = InferSchemaType<typeof teamMemberSchema> & { _id: string };

export const TeamMember: Model<TeamMemberDoc> =
  mongoose.models.TeamMember || mongoose.model<TeamMemberDoc>('TeamMember', teamMemberSchema);
