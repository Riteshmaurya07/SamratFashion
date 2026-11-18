const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('../backend/node_modules/mongoose');

const dbPath = path.resolve(__dirname, 'mongodb_rs_data');
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';
const rsName = 'rs_samrat_test';
const port = 27018;

console.log(`Starting mongod on port ${port} with replSet ${rsName}...`);

const mongod = spawn(mongodPath, [
  '--port', String(port),
  '--dbpath', dbPath,
  '--replSet', rsName,
  '--bind_ip', '127.0.0.1'
]);

mongod.stdout.on('data', d => {
  const line = d.toString();
  if (line.includes('Waiting for connections')) {
    console.log('[MONGOD] Ready for connections!');
  }
});

mongod.stderr.on('data', d => console.error('[MONGOD STDERR]', d.toString()));

async function initReplicaSet() {
  // Wait 3 seconds for mongod to start listening
  await new Promise(r => setTimeout(r, 3000));
  const directUri = `mongodb://127.0.0.1:${port}/admin?directConnection=true`;
  console.log('Connecting to initialize replica set:', directUri);
  const conn = await mongoose.createConnection(directUri).asPromise();

  try {
    const status = await conn.db.command({ hello: 1 });
    console.log('Initial hello command:', status.setName);
    if (!status.setName) {
      console.log('Initiating replica set...');
      const initRes = await conn.db.command({
        replSetInitiate: {
          _id: rsName,
          members: [{ _id: 0, host: `127.0.0.1:${port}` }]
        }
      });
      console.log('Initiate result:', initRes);
      // Wait for primary election
      let elected = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const checkHello = await conn.db.command({ hello: 1 });
        if (checkHello.isWritablePrimary) {
          console.log('Successfully elected Primary! setName:', checkHello.setName);
          elected = true;
          break;
        }
      }
      if (!elected) console.warn('Warning: not yet primary');
    } else {
      console.log('Replica set already initiated:', status.setName);
    }
  } catch (err) {
    console.error('Replica set init error:', err);
  } finally {
    await conn.close();
  }
}

initReplicaSet();

// Keep process alive
setInterval(() => { }, 60000);

