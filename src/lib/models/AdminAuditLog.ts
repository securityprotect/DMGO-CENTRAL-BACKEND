import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const adminAuditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorEmail: { type: String, required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    role: { type: String, default: 'admin' },
    beforeState: { type: Schema.Types.Mixed, default: null },
    afterState: { type: Schema.Types.Mixed, default: null },
    ipAddress: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export type AdminAuditLogDoc = InferSchemaType<typeof adminAuditLogSchema> & { _id: string };

export const AdminAuditLog: Model<AdminAuditLogDoc> =
  mongoose.models.AdminAuditLog || mongoose.model<AdminAuditLogDoc>('AdminAuditLog', adminAuditLogSchema);
