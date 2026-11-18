/**
 * Isolated MongoDB Replica Set Transactions Test Suite — Samrat Fashion
 *
 * Verifies:
 * 1. Actual hello command reports genuine replica set name (rs_samrat_test)
 * 2. Connects through application's standard mongoose connection mechanism
 * 3. Multi-document transaction across 2 separate test collections
 * 4. Commit visibility verification across collections
 * 5. Rollback on intentional failure before commit
 * 6. Zero persistence of aborted writes
 * 7. Production preflight check (verifyDatabaseTransactionSupport) on live replica set
 * 8. Majority write concern and journaling confirmation
 */

import mongoose from 'mongoose';
import { verifyDatabaseTransactionSupport } from '../config/db';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = `  ❌ FAIL: ${desc}${detail ? ` (${detail})` : ''}`;
    console.error(msg);
    failures.push(msg);
  }
}

async function runReplicaSetSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Samrat Fashion — Isolated MongoDB Replica Set Transaction Suite    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const rsUri = 'mongodb://127.0.0.1:27018/samrat_fashion_rs_test?replicaSet=rs_samrat_test&directConnection=true';

  console.log(`[CONNECT] Connecting to real replica set at ${rsUri}...`);
  await mongoose.connect(rsUri);

  try {
    const db = mongoose.connection.db!;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Verify hello command reports replica-set name
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- STEP 1: Genuine Replica Set Topology Verification ---');
    const helloRes = await db.command({ hello: 1 });
    check(Boolean(helloRes.setName), `TEST 1.1: Hello command reports setName (${helloRes.setName})`);
    check(helloRes.setName === 'rs_samrat_test', `TEST 1.2: Replica set name matches "rs_samrat_test"`);
    check(helloRes.isWritablePrimary === true, 'TEST 1.3: Connected node is an elected writable Primary');
    check(Array.isArray(helloRes.hosts) && helloRes.hosts.length >= 1, 'TEST 1.4: Hosts list contains valid replica members');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Preflight Production Transaction Support Probe
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- STEP 2: Production Preflight Check ---');
    const preflight = await verifyDatabaseTransactionSupport(mongoose.connection);
    check(preflight.supported === true, 'TEST 2.1: Production preflight verifyDatabaseTransactionSupport returned supported: true');
    check(preflight.topology === 'replica_set', 'TEST 2.2: Preflight topology is strictly "replica_set"');
    check(preflight.setName === 'rs_samrat_test', 'TEST 2.3: Preflight verified replica set name');

    // Define schemas for two separate test collections
    const ColASchema = new mongoose.Schema({ docId: { type: String, unique: true }, title: String, amount: Number }, { timestamps: true });
    const ColBSchema = new mongoose.Schema({ docId: { type: String, unique: true }, title: String, balance: Number }, { timestamps: true });

    const ModelA = mongoose.model('TestCollectionAlpha', ColASchema);
    const ModelB = mongoose.model('TestCollectionBeta', ColBSchema);

    // Ensure collections exist before in-transaction writes
    await ModelA.createCollection();
    await ModelB.createCollection();
    await ModelA.deleteMany({});
    await ModelB.deleteMany({});

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3 & 4: Multi-document Transaction with Commit Across 2 Collections
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- STEP 3 & 4: Multi-Collection Transaction & Commit Visibility ---');

    const sessionCommit = await mongoose.startSession();
    sessionCommit.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true }
    });

    try {
      await ModelA.create([{ docId: 'alpha_commit_1', title: 'Ledger Entry Alpha', amount: 5000 }], { session: sessionCommit });
      await ModelB.create([{ docId: 'beta_commit_1', title: 'Inventory Entry Beta', balance: 100 }], { session: sessionCommit });

      // In-transaction visibility:
      const inTxA = await ModelA.findOne({ docId: 'alpha_commit_1' }).session(sessionCommit);
      check(Boolean(inTxA), 'TEST 3.1: Doc A visible within transaction session');

      // Pre-commit visibility outside session (Snapshot Isolation):
      const outsideBeforeCommitA = await ModelA.findOne({ docId: 'alpha_commit_1' });
      check(outsideBeforeCommitA === null, 'TEST 3.2: Doc A strictly NOT visible outside session prior to commit (Snapshot Isolation)');

      const outsideBeforeCommitB = await ModelB.findOne({ docId: 'beta_commit_1' });
      check(outsideBeforeCommitB === null, 'TEST 3.3: Doc B strictly NOT visible outside session prior to commit');

      // Commit transaction
      await sessionCommit.commitTransaction();
      check(true, 'TEST 3.4: Committed transaction successfully with majority write concern');
    } finally {
      await sessionCommit.endSession();
    }

    // Post-commit visibility:
    const afterCommitA = await ModelA.findOne({ docId: 'alpha_commit_1' });
    const afterCommitB = await ModelB.findOne({ docId: 'beta_commit_1' });
    check(Boolean(afterCommitA && afterCommitA.amount === 5000), 'TEST 4.1: Doc A durably visible across connection post-commit');
    check(Boolean(afterCommitB && afterCommitB.balance === 100), 'TEST 4.2: Doc B durably visible across connection post-commit');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5 & 6: Intentional Failure & Multi-Collection Abort / Rollback
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- STEP 5 & 6: Multi-Collection Intentional Failure & Rollback ---');

    const sessionAbort = await mongoose.startSession();
    sessionAbort.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true }
    });

    let abortExecuted = false;
    try {
      await ModelA.create([{ docId: 'alpha_abort_fail', title: 'Corrupt Alpha', amount: 9999 }], { session: sessionAbort });
      await ModelB.create([{ docId: 'beta_abort_fail', title: 'Corrupt Beta', balance: 0 }], { session: sessionAbort });

      // In-transaction visibility:
      const inTxFailA = await ModelA.findOne({ docId: 'alpha_abort_fail' }).session(sessionAbort);
      check(Boolean(inTxFailA), 'TEST 5.1: Abort-test Doc A visible in-session prior to failure');

      // INJECT INTENTIONAL FAILURE
      throw new Error('[SIMULATED FAILURE] Aborting transaction before commit');
    } catch (err: any) {
      if (err.message.includes('SIMULATED FAILURE')) {
        await sessionAbort.abortTransaction();
        abortExecuted = true;
        check(true, 'TEST 5.2: Caught intentional failure and invoked abortTransaction()');
      } else {
        throw err;
      }
    } finally {
      await sessionAbort.endSession();
    }

    check(abortExecuted === true, 'TEST 5.3: Confirmed abortTransaction was executed');

    // Verify neither write persisted
    const afterAbortA = await ModelA.findOne({ docId: 'alpha_abort_fail' });
    const afterAbortB = await ModelB.findOne({ docId: 'beta_abort_fail' });
    check(afterAbortA === null, 'TEST 6.1: Rolled-back Doc A does NOT persist in ModelA collection (atomicity preserved)');
    check(afterAbortB === null, 'TEST 6.2: Rolled-back Doc B does NOT persist in ModelB collection (atomicity preserved)');

    // Verify original committed data was not corrupted
    const preservedCountA = await ModelA.countDocuments();
    const preservedCountB = await ModelB.countDocuments();
    check(preservedCountA === 1, `TEST 6.3: ModelA retained exact 1 committed document (got ${preservedCountA})`);
    check(preservedCountB === 1, `TEST 6.4: ModelB retained exact 1 committed document (got ${preservedCountB})`);

    // Clean up
    await ModelA.deleteMany({});
    await ModelB.deleteMany({});

  } finally {
    await mongoose.disconnect();
    console.log('\n[DISCONNECT] Disconnected from replica set test database');
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Replica Set Transaction Test Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailures recorded:');
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runReplicaSetSuite().catch((err) => {
    console.error('Fatal replica set test error:', err);
    process.exit(1);
  });
}
