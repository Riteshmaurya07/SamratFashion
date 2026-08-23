const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function seedUsers() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;

  // 1. Seed Super Admin
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin.dev@samratfashion.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "DevAdminPass123!";
  const hashedAdminPassword = await bcrypt.hash(adminPassword, 12);
  
  await db.collection('users').updateOne(
    { email: adminEmail },
    {
      $set: {
        name: "Dev Super Admin",
        email: adminEmail,
        passwordHash: hashedAdminPassword,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        updatedAt: new Date()
      },
      $unset: { password: "" }
    },
    { upsert: true }
  );

  // 2. Seed Customer Dev User
  const devEmail = "dev_user@example.com";
  const devPassword = "Password123";
  const hashedDevPassword = await bcrypt.hash(devPassword, 12);

  await db.collection('users').updateOne(
    { email: devEmail },
    {
      $set: {
        name: "Dev Customer User",
        email: devEmail,
        passwordHash: hashedDevPassword,
        role: "CUSTOMER",
        status: "ACTIVE",
        updatedAt: new Date()
      },
      $unset: { password: "" }
    },
    { upsert: true }
  );

  console.log(`[SEED] Users created/updated:`);
  console.log(`Admin Email: ${adminEmail}`);
  console.log(`Customer Email: ${devEmail}`);
  
  await mongoose.disconnect();
  process.exit(0);
}

seedUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
