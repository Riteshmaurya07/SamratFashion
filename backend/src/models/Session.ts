import mongoose, { Document, Schema } from "mongoose";

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId;
  refreshTokenHash: string;
  tokenHash?: string;
  familyId?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt: Date;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    refreshTokenHash: { type: String, required: true },
    tokenHash: { type: String },
    // Group of sessions created by the same login session chain (rotation siblings).
    familyId: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date, default: Date.now },
    userAgent: { type: String },
    ip: { type: String },
  },
  {
    timestamps: true,
  }
);

// Index to automatically remove expired sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
// O(1) token lookup instead of a full-collection sweep + bcrypt per session.
// Sparse keeps the requirement drop-compatible with pre-migration legacy rows.
sessionSchema.index({ tokenHash: 1 }, { unique: true, sparse: true });
sessionSchema.index({ familyId: 1 });

export const Session = mongoose.model<ISession>("Session", sessionSchema);
