import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { Session } from "../models/Session";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0] || process.env.ADMIN_EMAIL || "admin@samratfashion.com";
  const newPassword = args[1];

  if (!newPassword) {
    console.log("\n=======================================================");
    console.log("🔒 Samrat Fashion Admin Password Reset CLI Utility");
    console.log("=======================================================");
    console.log("Usage:   npx ts-node src/scripts/resetPassword.ts <email> <newPassword>");
    console.log("Example: npx ts-node src/scripts/resetPassword.ts admin@samratfashion.com MySecurePass@2026\n");
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("❌ Password must be at least 8 characters long.");
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion";
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUri);

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      console.error(`❌ User not found with email: ${email}`);
      process.exit(1);
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    user.passwordHash = passwordHash;
    await user.save();

    // Revoke existing sessions for security
    const sessionRes = await Session.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );

    console.log("\n=======================================================");
    console.log(`✅ Password successfully updated for: ${user.email}`);
    console.log(`👤 Name: ${user.name}`);
    console.log(`🛡️  Role: ${user.role}`);
    console.log(`🔄 Active sessions revoked: ${sessionRes.modifiedCount}`);
    console.log("=======================================================\n");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Error executing password reset:", err);
  process.exit(1);
});
