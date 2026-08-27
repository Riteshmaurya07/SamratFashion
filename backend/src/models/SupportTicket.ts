import mongoose, { Document, Schema } from "mongoose";

export enum SupportCategory {
  ORDER = "ORDER",
  PAYMENT = "PAYMENT",
  DELIVERY = "DELIVERY",
  RETURN = "RETURN",
  REFUND = "REFUND",
  PRODUCT = "PRODUCT",
  CUSTOM_PRINTING = "CUSTOM_PRINTING",
  ACCOUNT = "ACCOUNT",
  OTHER = "OTHER",
}

export enum SupportPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export enum SupportStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  WAITING_FOR_CUSTOMER = "WAITING_FOR_CUSTOMER",
  RESOLVED = "RESOLVED",
  CLOSED = "CLOSED",
}

export interface ISupportMessage {
  _id?: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  senderRole: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  body: string;
  attachments?: string[];
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  ticketNumber: string;
  userId: mongoose.Types.ObjectId;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  orderId?: mongoose.Types.ObjectId;
  assignedAdmin?: mongoose.Types.ObjectId;
  messages: ISupportMessage[];
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const supportMessageSchema = new Schema<ISupportMessage>({
  senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  senderRole: { type: String, enum: ["CUSTOMER", "ADMIN", "SUPER_ADMIN"], required: true },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  attachments: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    ticketNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subject: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
    category: {
      type: String,
      enum: Object.values(SupportCategory),
      default: SupportCategory.ORDER,
    },
    priority: {
      type: String,
      enum: Object.values(SupportPriority),
      default: SupportPriority.MEDIUM,
    },
    status: {
      type: String,
      enum: Object.values(SupportStatus),
      default: SupportStatus.OPEN,
      index: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    assignedAdmin: { type: Schema.Types.ObjectId, ref: "User" },
    messages: [supportMessageSchema],
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

export const SupportTicket = mongoose.model<ISupportTicket>("SupportTicket", supportTicketSchema);
