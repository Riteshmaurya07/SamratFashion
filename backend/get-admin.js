const mongoose = require('mongoose');

async function findAdmins() {
  await mongoose.connect('mongodb://localhost:27017/samrat_fashion');
  
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
