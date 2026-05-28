import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const supportTicketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true },
    category: { type: String, default: 'general' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    message: { type: String, required: true },
<<<<<<< HEAD
    status: { type: String, enum: ['open', 'in_progress', 'waiting_for_user', 'resolved', 'closed'], default: 'open' },
    assignedAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    internalNotes: { type: String, default: '' },
    attachments: { type: Schema.Types.Mixed, default: [] },
    cannedReplyKey: { type: String, default: '' },
    lastReplyAt: { type: Date, default: null },
=======
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
>>>>>>> d49aea3092a26efb667c36b33d3531391f2a244b
  },
  { timestamps: true }
);

export type SupportTicketDoc = InferSchemaType<typeof supportTicketSchema> & { _id: string };

export const SupportTicket: Model<SupportTicketDoc> =
  mongoose.models.SupportTicket || mongoose.model<SupportTicketDoc>('SupportTicket', supportTicketSchema);
