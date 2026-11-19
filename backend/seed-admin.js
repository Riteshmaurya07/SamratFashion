const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Administrative User Seeder
 *
 * SECURITY NOTICE:
 * This script is intended solely for initial local environment setup.
 * It requires explicit SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables.
 * It MUST NEVER be executed against production databases.
 */
async function seedUsers() {
  const isStrict = process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error('FATAL SECURITY ERROR: Explicit SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }

  if (isStrict) {
    if (
      adminPassword === "DevAdminPass123!" ||
      adminEmail === "admin.dev@samratfashion.local" ||
      adminEmail === "admin@samratfashion.com" ||
      adminPassword === "password123"
    ) {
      console.error('FATAL SECURITY ERROR: Known default development credentials cannot be seeded into production, staging, or non-development environments.');
      process.exit(1);
    }
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;

  // 1. Seed Super Admin
  const hashedAdminPassword = await bcrypt.hash(adminPassword, 12);
  await db.collection('users').updateOne(
    { email: adminEmail },
    {
      $set: {
        name: "Super Admin",
        email: adminEmail,
        passwordHash: hashedAdminPassword,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        emailVerified: true,
        updatedAt: new Date()
      },
      $unset: { password: "" }
    },
    { upsert: true }
  );

  console.log(`[SEED] Super Admin user successfully configured: ${adminEmail}`);
  
  await mongoose.disconnect();
  process.exit(0);
}

seedUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
