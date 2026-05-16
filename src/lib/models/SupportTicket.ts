import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const supportTicketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true },
    category: { type: String, default: 'general' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

export type SupportTicketDoc = InferSchemaType<typeof supportTicketSchema> & { _id: string };

export const SupportTicket: Model<SupportTicketDoc> =
  mongoose.models.SupportTicket || mongoose.model<SupportTicketDoc>('SupportTicket', supportTicketSchema);
