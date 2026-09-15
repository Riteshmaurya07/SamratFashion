const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://localhost:27017');
  const admin = mongoose.connection.db.admin();
  const dbs = await admin.listDatabases();
  console.log("Databases:", dbs.databases.map(d => d.name));
  mongoose.disconnect();
}

run().catch(console.error);
