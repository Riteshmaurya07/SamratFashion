/**
 * Test Database Isolation & Safety Guard Test Suite
 *
 * Verifies that the test database guard strictly rejects:
 * 1. Missing or empty TEST_MONGODB_URI
 * 2. Missing database name in connection string
 * 3. Default MongoDB application database ("test")
 * 4. Application database ("samrat_fashion")
 * 5. Production databases ("production", "samrat_fashion_prod")
 * 6. System databases ("admin", "local", "config")
 * 7. URIs matching the active application MONGODB_URI
 *
 * And accepts:
 * 1. Properly designated isolated test databases ("samrat_fashion_test_isolated", etc.)
 * 2. Verified Mongoose connections targeting isolated test databases
 */

import {
  extractDatabaseName,
  isIsolatedTestDatabaseName,
  validateTestDatabaseUri,
  getVerifiedTestMongoUri,
  assertSafeTestDatabase,
  maskMongoUri,
  ensureEnvLoaded,
  PROHIBITED_DATABASE_NAMES,
} from "../config/testDbGuard";
import {
  ensureMigrationConnection,
  MigrationClientInterface,
} from "../scripts/migrateTaxonomy";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

function expectThrow(fn: () => void, desc: string, expectedSnippets?: string | string[]): void {
  try {
    fn();
    check(false, desc, "Expected function to throw, but it succeeded");
  } catch (err: unknown) {
    const errorMsg = (err as Error).message;
    if (expectedSnippets) {
      const snippets = Array.isArray(expectedSnippets) ? expectedSnippets : [expectedSnippets];
      const matches = snippets.some((s) => errorMsg.toLowerCase().includes(s.toLowerCase()));
      if (!matches) {
        check(false, desc, `Error message '${errorMsg}' did not contain any of [${snippets.join(", ")}]`);
      } else {
        check(true, desc);
      }
    } else {
      check(true, desc);
    }
  }
}

async function runSafetyGuardTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Test Database Isolation & Safety Guard Verification Suite     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Database Name Extraction
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("[TEST GROUP 1: DATABASE NAME EXTRACTION]");

  check(
    extractDatabaseName("mongodb://127.0.0.1:27017/samrat_fashion_test_isolated") === "samrat_fashion_test_isolated",
    "1.1 Extract standard mongodb db name"
  );
  check(
    extractDatabaseName("mongodb://127.0.0.1:27017/samrat_fashion_test_isolated?retryWrites=true") === "samrat_fashion_test_isolated",
    "1.2 Extract db name with query string"
  );
  check(
    extractDatabaseName("mongodb+srv://user:pass@cluster0.mongodb.net/samrat_fashion_test_isolated?retryWrites=true") === "samrat_fashion_test_isolated",
    "1.3 Extract mongodb+srv db name"
  );
  check(
    extractDatabaseName("mongodb://localhost:27017") === "",
    "1.4 URI without trailing slash returns empty string"
  );
  check(
    extractDatabaseName("mongodb://localhost:27017/") === "",
    "1.5 URI with trailing slash only returns empty string"
  );
  check(
    extractDatabaseName("mongodb+srv://user:pass@cluster0.mongodb.net/?retryWrites=true") === "",
    "1.6 Atlas URI with query but no database name returns empty string"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Isolated Test Database Name Classification
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 2: ISOLATED TEST DATABASE NAME CLASSIFICATION]");

  // Acceptance tests
  check(isIsolatedTestDatabaseName("samrat_fashion_test_isolated") === true, "2.1 Accepts 'samrat_fashion_test_isolated'");
  check(isIsolatedTestDatabaseName("samrat_fashion_test") === true, "2.2 Accepts 'samrat_fashion_test'");
  check(isIsolatedTestDatabaseName("test_isolated") === true, "2.3 Accepts 'test_isolated'");
  check(isIsolatedTestDatabaseName("custom_isolated_test_db") === true, "2.4 Accepts 'custom_isolated_test_db'");
  check(isIsolatedTestDatabaseName("store_test") === true, "2.5 Accepts 'store_test'");

  // Rejection tests: Application & Prohibited databases
  check(isIsolatedTestDatabaseName("test") === false, "2.6 Rejects default Atlas database 'test'");
  check(isIsolatedTestDatabaseName("samrat_fashion") === false, "2.7 Rejects application database 'samrat_fashion'");
  check(isIsolatedTestDatabaseName("samrat_fashion_prod") === false, "2.8 Rejects production database 'samrat_fashion_prod'");
  check(isIsolatedTestDatabaseName("production") === false, "2.9 Rejects 'production'");
  check(isIsolatedTestDatabaseName("samrat_fashion_prod_test") === false, "2.10 Rejects database containing 'prod'");
  check(isIsolatedTestDatabaseName("admin") === false, "2.11 Rejects system database 'admin'");
  check(isIsolatedTestDatabaseName("local") === false, "2.12 Rejects system database 'local'");
  check(isIsolatedTestDatabaseName("config") === false, "2.13 Rejects system database 'config'");
  check(isIsolatedTestDatabaseName("samrat_fashion_dev") === false, "2.14 Rejects dev database 'samrat_fashion_dev'");
  check(isIsolatedTestDatabaseName("") === false, "2.15 Rejects empty database name");

  // Verify all entries in PROHIBITED_DATABASE_NAMES are rejected
  let allProhibitedRejected = true;
  for (const name of Object.keys(PROHIBITED_DATABASE_NAMES)) {
    if (isIsolatedTestDatabaseName(name) !== false) {
      allProhibitedRejected = false;
      break;
    }
  }
  check(allProhibitedRejected, "2.16 All static prohibited database names are rejected");

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. validateTestDatabaseUri Rejection & Acceptance
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 3: VALIDATE TEST DATABASE URI GUARD]");

  // Missing or empty URI
  expectThrow(
    () => validateTestDatabaseUri(""),
    "3.1 Rejects empty URI",
    "missing or empty"
  );
  expectThrow(
    () => validateTestDatabaseUri(undefined as unknown as string),
    "3.2 Rejects undefined URI",
    "missing or empty"
  );
  expectThrow(
    () => validateTestDatabaseUri("   "),
    "3.3 Rejects whitespace URI",
    "missing or empty"
  );

  // Invalid protocol
  expectThrow(
    () => validateTestDatabaseUri("postgres://localhost:5432/test"),
    "3.4 Rejects non-MongoDB protocol",
    "Invalid MongoDB connection URI protocol"
  );

  // Missing database name (defaults to 'test')
  expectThrow(
    () => validateTestDatabaseUri("mongodb://localhost:27017"),
    "3.5 Rejects URI without database name",
    "does not specify a database name"
  );
  expectThrow(
    () => validateTestDatabaseUri("mongodb+srv://user:pass@cluster0.mongodb.net/?retryWrites=true"),
    "3.6 Rejects Atlas URI with query but no db name",
    "does not specify a database name"
  );

  // Default Atlas database 'test'
  expectThrow(
    () => validateTestDatabaseUri("mongodb://localhost:27017/test"),
    "3.7 Rejects default 'test' database",
    ["not a valid isolated test database", "matches the configured application database"]
  );
  expectThrow(
    () => validateTestDatabaseUri("mongodb+srv://user:pass@cluster0.mongodb.net/test?retryWrites=true"),
    "3.8 Rejects Atlas 'test' database",
    ["not a valid isolated test database", "matches the configured application database"]
  );

  // Application database 'samrat_fashion'
  expectThrow(
    () => validateTestDatabaseUri("mongodb://localhost:27017/samrat_fashion"),
    "3.9 Rejects application database 'samrat_fashion'",
    "not a valid isolated test database"
  );

  // Production databases
  expectThrow(
    () => validateTestDatabaseUri("mongodb://localhost:27017/samrat_fashion_prod"),
    "3.10 Rejects production database 'samrat_fashion_prod'",
    "not a valid isolated test database"
  );
  expectThrow(
    () => validateTestDatabaseUri("mongodb://localhost:27017/production"),
    "3.11 Rejects 'production' database",
    "not a valid isolated test database"
  );

  // Matching application database via options.appUri
  expectThrow(
    () =>
      validateTestDatabaseUri("mongodb://localhost:27017/samrat_fashion_test_isolated", {
        appUri: "mongodb://localhost:27017/samrat_fashion_test_isolated",
      }),
    "3.12 Rejects test URI that matches configured application database",
    "matches the configured application database"
  );

  // Valid isolated test databases are accepted
  {
    const res1 = validateTestDatabaseUri("mongodb://localhost:27017/samrat_fashion_test_isolated");
    check(
      res1.databaseName === "samrat_fashion_test_isolated",
      "3.13 Accepts local 'samrat_fashion_test_isolated'"
    );

    const res2 = validateTestDatabaseUri("mongodb+srv://user:secret@cluster0.mongodb.net/samrat_fashion_test_isolated?retryWrites=true&w=majority");
    check(
      res2.databaseName === "samrat_fashion_test_isolated",
      "3.14 Accepts Atlas 'samrat_fashion_test_isolated'"
    );

    const res3 = validateTestDatabaseUri("mongodb://127.0.0.1:27017/test_isolated");
    check(
      res3.databaseName === "test_isolated",
      "3.15 Accepts 'test_isolated'"
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. getVerifiedTestMongoUri Environment Enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 4: ENVIRONMENT ENFORCEMENT]");

  ensureEnvLoaded();
  const originalTestUri = process.env.TEST_MONGODB_URI;
  try {
    // Unset TEST_MONGODB_URI
    delete process.env.TEST_MONGODB_URI;
    expectThrow(
      () => getVerifiedTestMongoUri(),
      "4.1 Throws when TEST_MONGODB_URI is not set (never falls back to MONGODB_URI)",
      "TEST_MONGODB_URI is not set"
    );

    // Set to application database
    process.env.TEST_MONGODB_URI = "mongodb://localhost:27017/test";
    expectThrow(
      () => getVerifiedTestMongoUri(),
      "4.2 Throws when TEST_MONGODB_URI is set to application 'test' database",
      ["not a valid isolated test database", "matches the configured application database"]
    );

    // Set to valid isolated test database
    process.env.TEST_MONGODB_URI = "mongodb://localhost:27017/samrat_fashion_test_isolated";
    const verified = getVerifiedTestMongoUri();
    check(
      verified === "mongodb://localhost:27017/samrat_fashion_test_isolated",
      "4.3 Returns verified URI when set to valid isolated test database"
    );
  } finally {
    if (originalTestUri !== undefined) {
      process.env.TEST_MONGODB_URI = originalTestUri;
    } else {
      delete process.env.TEST_MONGODB_URI;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Active Connection Guard: assertSafeTestDatabase
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 5: ACTIVE CONNECTION GUARD]");

  // Not connected
  expectThrow(
    () => assertSafeTestDatabase({ readyState: 0 }),
    "5.1 Rejects disconnected Mongoose connection (readyState 0)",
    "Database is not connected"
  );

  // Connected to 'test'
  expectThrow(
    () => assertSafeTestDatabase({ readyState: 1, name: "test" }),
    "5.2 Rejects Mongoose connection targeting 'test'",
    ["NOT a verified isolated test database", "targeting the application database"]
  );

  // Connected to 'samrat_fashion'
  expectThrow(
    () => assertSafeTestDatabase({ readyState: 1, name: "samrat_fashion" }),
    "5.3 Rejects Mongoose connection targeting 'samrat_fashion'",
    "NOT a verified isolated test database"
  );

  // Connected to 'samrat_fashion_prod'
  expectThrow(
    () => assertSafeTestDatabase({ readyState: 1, name: "samrat_fashion_prod" }),
    "5.4 Rejects Mongoose connection targeting 'samrat_fashion_prod'",
    "NOT a verified isolated test database"
  );

  // Connected to isolated test database
  let safeDbThrew = false;
  try {
    assertSafeTestDatabase({ readyState: 1, name: "samrat_fashion_test_isolated" });
  } catch {
    safeDbThrew = true;
  }
  check(!safeDbThrew, "5.5 Accepts Mongoose connection targeting 'samrat_fashion_test_isolated'");

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Credential Sanitization: maskMongoUri
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 6: CREDENTIAL SANITIZATION]");

  const secretPass = "super_secret_p@ss#123";
  const rawUri = `mongodb+srv://admin_user:${secretPass}@cluster0.nl5bdfe.mongodb.net/samrat_fashion_test_isolated?retryWrites=true`;
  const masked = maskMongoUri(rawUri);

  check(!masked.includes(secretPass), "6.1 Password is completely stripped from masked URI");
  check(!masked.includes("admin_user"), "6.2 Username is replaced in masked URI");
  check(masked.includes("***:***@cluster0.nl5bdfe.mongodb.net"), "6.3 Credentials replaced with '***:***@'");
  check(masked.includes("samrat_fashion_test_isolated"), "6.4 Host and database name are preserved");
  check(maskMongoUri("") === "[REDACTED_URI]", "6.5 Empty URI returns [REDACTED_URI]");


  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Taxonomy Migration Connection-Selection Regression Tests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[TEST GROUP 7: TAXONOMY MIGRATION CONNECTION-SELECTION REGRESSION]");

  // 7.1 Existing connection DB name matches requested DB name, but cluster/target differs
  {
    const tracker = { disconnectCalled: false, connectedToUri: "", mockReadyState: 1 };

    const mockClient: MigrationClientInterface = {
      get readyState() {
        return tracker.mockReadyState;
      },
      disconnect: async () => {
        tracker.disconnectCalled = true;
        tracker.mockReadyState = 0;
      },
      connect: async (uri: string) => {
        tracker.connectedToUri = uri;
        tracker.mockReadyState = 1;
      },
    };

    const clusterBUri = "mongodb://cluster-b.example.com:27017/samrat_fashion_test_isolated";
    const res = await ensureMigrationConnection({ connectionUri: clusterBUri }, mockClient);

    check(
      tracker.disconnectCalled === true,
      "7.1 Disconnects existing connection when explicit URI is supplied even if DB name matches"
    );
    check(
      tracker.connectedToUri === clusterBUri,
      "7.1B Connects to the exact requested target URI rather than relying on matching DB name"
    );
    check(
      res.connectedUri === clusterBUri && res.reusedExisting === false,
      "7.1C Returns requested connection URI and reusedExisting = false"
    );
  }

  // 7.2 Alternative mongoUri option also forces reconnect to exact target
  {
    const tracker = { disconnectCalled: false, connectedToUri: "", mockReadyState: 1 };

    const mockClient: MigrationClientInterface = {
      get readyState() {
        return tracker.mockReadyState;
      },
      disconnect: async () => {
        tracker.disconnectCalled = true;
        tracker.mockReadyState = 0;
      },
      connect: async (uri: string) => {
        tracker.connectedToUri = uri;
        tracker.mockReadyState = 1;
      },
    };

    const clusterCUri = "mongodb://cluster-c.example.com:27017/samrat_fashion_test_isolated";
    await ensureMigrationConnection({ mongoUri: clusterCUri }, mockClient);

    check(tracker.disconnectCalled === true, "7.2 Disconnects when mongoUri alternative option is supplied");
    check(tracker.connectedToUri === clusterCUri, "7.2B Connects to the exact requested mongoUri");
  }

  // 7.3 Preserves existing active connection when no explicit URI is supplied (default CLI/seeder behavior)
  {
    const tracker = { disconnectCalled: false, connectCalled: false };

    const mockClient: MigrationClientInterface = {
      readyState: 1,
      disconnect: async () => {
        tracker.disconnectCalled = true;
      },
      connect: async () => {
        tracker.connectCalled = true;
      },
    };

    const res = await ensureMigrationConnection(undefined, mockClient);
    check(tracker.disconnectCalled === false, "7.3 Does NOT disconnect active connection when no explicit URI is supplied");
    check(tracker.connectCalled === false, "7.3B Does NOT reconnect when connection is already active and no explicit URI");
    check(res.reusedExisting === true && res.connectedUri === null, "7.3C Reuses existing active connection");
  }

  // 7.4 Connects to default URI when no explicit URI is supplied and connection is disconnected
  {
    const tracker = { connectCalledWith: "", mockReadyState: 0 };

    const mockClient: MigrationClientInterface = {
      get readyState() {
        return tracker.mockReadyState;
      },
      disconnect: async () => {},
      connect: async (uri: string) => {
        tracker.connectCalledWith = uri;
        tracker.mockReadyState = 1;
      },
    };

    const res = await ensureMigrationConnection(undefined, mockClient);
    check(tracker.connectCalledWith.length > 0, "7.4 Connects to default URI when disconnected and no explicit URI");
    check(res.reusedExisting === false, "7.4B reusedExisting is false when newly connected");
  }

  // 7.5 Explicit URI when connection is already disconnected does not call disconnect unnecessarily
  {
    const tracker = { disconnectCalled: false, connectCalledWith: "" };

    const mockClient: MigrationClientInterface = {
      readyState: 0,
      disconnect: async () => {
        tracker.disconnectCalled = true;
      },
      connect: async (uri: string) => {
        tracker.connectCalledWith = uri;
      },
    };

    const targetUri = "mongodb://cluster-d.example.com:27017/samrat_fashion_test_isolated";
    await ensureMigrationConnection({ connectionUri: targetUri }, mockClient);
    check(tracker.disconnectCalled === false, "7.5 Does NOT call disconnect when already in readyState 0");
    check(tracker.connectCalledWith === targetUri, "7.5B Connects directly to explicit URI");
  }

  // 7.6 Cleanup and error-handling on connection failure
  {
    const tracker = { disconnectCleanupCalled: false, mockReadyState: 2 };

    const failingClient: MigrationClientInterface = {
      get readyState() {
        return tracker.mockReadyState;
      },
      disconnect: async () => {
        tracker.disconnectCleanupCalled = true;
        tracker.mockReadyState = 0;
      },
      connect: async () => {
        tracker.mockReadyState = 2; // in-flight failure
        throw new Error("Simulated connection timeout to target cluster");
      },
    };

    let errorThrown: Error | null = null;
    try {
      await ensureMigrationConnection(
        { connectionUri: "mongodb://failing-cluster.example.com:27017/samrat_fashion_test_isolated" },
        failingClient
      );
    } catch (err: unknown) {
      errorThrown = err as Error;
    }

    check(
      errorThrown !== null && errorThrown.message.includes("Simulated connection timeout"),
      "7.6 Propagates connection failure error"
    );
    check(
      tracker.disconnectCleanupCalled === true,
      "7.6B Calls disconnect cleanup when connection fails in non-zero readyState"
    );
    check(
      failingClient.readyState === 0,
      "7.6C Leaves client in clean disconnected state (readyState 0) on failure"
    );
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSafetyGuardTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
