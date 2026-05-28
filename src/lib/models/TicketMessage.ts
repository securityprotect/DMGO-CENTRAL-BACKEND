import mongoose, { InferSchemaType, Model, Schema } from 'mongoose';

const ticketMessageSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
    authorType: { type: String, enum: ['user', 'admin', 'system'], default: 'user' },
    authorId: { type: String, default: '' },
    body: { type: String, required: true },
    attachments: { type: Schema.Types.Mixed, default: [] },
    internal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export type TicketMessageDoc = InferSchemaType<typeof ticketMessageSchema> & { _id: string };

export const TicketMessage: Model<TicketMessageDoc> =
  mongoose.models.TicketMessage || mongoose.model<TicketMessageDoc>('TicketMessage', ticketMessageSchema);
