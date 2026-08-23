const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function seedAdmin() {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.MONGODB_URI) {
      console.error("FATAL: MONGODB_URI environment variable is required in production.");
      process.exit(1);
    }
    if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) {
      console.error("FATAL: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables are required in production.");
      process.exit(1);
    }
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;
  
  const email = process.env.SEED_ADMIN_EMAIL || "admin.dev@samratfashion.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "DevAdminPass123!";
  const hashedPassword = await bcrypt.hash(password, 12);
  
  await db.collection('users').updateOne(
    { email: email },
    {
      $set: {
        name: "Dev Super Admin",
        email: email,
        passwordHash: hashedPassword,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        updatedAt: new Date()
      },
      $unset: { password: "" }
    },
    { upsert: true }
  );
  
  console.log(`[DEV SEED] Admin user seeded:`);
  console.log(`Email: ${email}`);
  console.log(`Password: [PROTECTED]`);
  
  process.exit(0);
}

seedAdmin().catch(console.error);
