const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function findAdmins() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';
  await mongoose.connect(mongoUri);
  
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } }).toArray();
  
  if (users.length === 0) {
    console.log("No admins found.");
  } else {
    users.forEach(u => {
      console.log(`Email: ${u.email}, Role: ${u.role}, Password (hashed): ${u.password}`);
    });
  }
  
  process.exit(0);
}

findAdmins().catch(console.error);
