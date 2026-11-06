import mongoose, { Document, Schema } from "mongoose";

export interface IEmailVerificationToken extends Document {
  userId: mongoose.Types.ObjectId;
  email: string;
  otp: string;
  token: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

const emailVerificationTokenSchema = new Schema<IEmailVerificationToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    otp: { type: String, required: true },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
emailVerificationTokenSchema.index({ email: 1 });
emailVerificationTokenSchema.index({ token: 1 });
emailVerificationTokenSchema.index({ userId: 1 });

export const EmailVerificationToken = mongoose.model<IEmailVerificationToken>(
  "EmailVerificationToken",
  emailVerificationTokenSchema
);
