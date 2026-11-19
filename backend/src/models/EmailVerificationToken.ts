import mongoose, { Document, Schema } from "mongoose";

/**
 * EmailVerificationToken Model
 *
 * MIGRATION NOTE:
 * Email verification OTPs and direct tokens are stored hashed (SHA-256) at rest.
 * Any existing plaintext tokens in flight cannot be retroactively hashed, but
 * because they carry a strict 15-minute TTL (enforced by the expiresAt index),
 * they naturally expire within 15 minutes of deployment. No manual database
 * migration script is needed.
 */
export interface IEmailVerificationToken extends Document {
  userId: mongoose.Types.ObjectId;
  email: string;
  otp: string; // SHA-256 hashed 6-digit OTP
  token: string; // SHA-256 hashed 32-byte hex token
  failedAttempts: number; // Lockout after 5 failed attempts
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
    failedAttempts: { type: Number, default: 0, required: true },
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
