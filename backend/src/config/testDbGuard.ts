/**
 * Test Database Isolation & Safety Guard Utility
 *
 * Prevents test suites and test migrations from connecting or writing to
 * application or production databases. Enforces dedicated isolated test
 * databases (e.g. `samrat_fashion_test_isolated`).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

// Prohibited database names that can NEVER be used as test databases
export const PROHIBITED_DATABASE_NAMES: Record<string, true> = {
  test: true, // Atlas default database name
  admin: true,
  local: true,
  config: true,
  samrat_fashion: true,
  samrat_fashion_prod: true,
  samrat_fashion_production: true,
  production: true,
  prod: true,
  samrat_fashion_dev: true,
  development: true,
  dev: true,
  staging: true,
};

/**
 * Strips authentication credentials from MongoDB URI for safe logging.
 * Never prints passwords, tokens, or raw credentials.
 */
export function maskMongoUri(uri?: string): string {
  if (!uri || typeof uri !== "string") {
    return "[REDACTED_URI]";
  }
  return uri.replace(
    /^((?:mongodb(?:\+srv)?):\/\/)(?:.*@)(.+)$/i,
    "$1***:***@$2"
  );
}

/**
 * Extracts database name from a MongoDB connection URI.
 * Returns empty string if database name is not explicitly specified.
 */
export function extractDatabaseName(uri: string): string {
  if (!uri || typeof uri !== "string") return "";
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^\/]+(?:\/([^?#]*))?/i);
  if (!match || !match[1]) return "";
  return match[1].trim();
}

/**
 * Determines whether a database name clearly identifies as a dedicated isolated test database.
 */
export function isIsolatedTestDatabaseName(dbName: string): boolean {
  if (!dbName || typeof dbName !== "string") return false;
  const normalized = dbName.trim().toLowerCase();

  // 1. Must not be in the prohibited database list
  if (PROHIBITED_DATABASE_NAMES[normalized]) {
    return false;
  }

  // 2. Must not contain any production designations
  if (normalized.includes("prod")) {
    return false;
  }

  // 3. Must clearly identify as a test / isolated database
  const hasIsolatedMarker =
    normalized.includes("test_isolated") ||
    normalized.includes("isolated_test") ||
    normalized.endsWith("_test") ||
    normalized.endsWith("-test") ||
    normalized.startsWith("test_") ||
    normalized.startsWith("test-") ||
    normalized.includes("_test_") ||
    normalized.includes("-test-") ||
    normalized.includes("_isolated") ||
    normalized.includes("-isolated");

  return hasIsolatedMarker;
}

/**
 * Validates that a MongoDB URI targets a valid isolated test database.
 * Throws a descriptive error if missing, invalid, or targeting application/production DB.
 */
export function validateTestDatabaseUri(
  uri?: string,
  options?: { appUri?: string }
): { uri: string; databaseName: string } {
  if (!uri || typeof uri !== "string" || !uri.trim()) {
    throw new Error(
      "CRITICAL SAFETY ERROR: TEST_MONGODB_URI is required for test execution but is missing or empty."
    );
  }

  const trimmedUri = uri.trim();
  if (
    !trimmedUri.startsWith("mongodb://") &&
    !trimmedUri.startsWith("mongodb+srv://")
  ) {
    throw new Error(
      "CRITICAL SAFETY ERROR: Invalid MongoDB connection URI protocol. Expected mongodb:// or mongodb+srv://."
    );
  }

  const databaseName = extractDatabaseName(trimmedUri);
  if (!databaseName) {
    throw new Error(
      "CRITICAL SAFETY ERROR: Test database URI does not specify a database name. " +
        "Connecting without a database name defaults to the non-isolated 'test' database. " +
        "A dedicated test database name (e.g. 'samrat_fashion_test_isolated') is strictly required."
    );
  }

  // Check against application database name
  const appUri = options?.appUri || process.env.MONGODB_URI;
  const appDb = appUri ? (extractDatabaseName(appUri) || "test") : "test";
  if (databaseName.toLowerCase() === appDb.toLowerCase()) {
    throw new Error(
      `CRITICAL SAFETY ERROR: Test database name '${databaseName}' matches the configured application database name ('${appDb}'). ` +
        `Test execution against the application database is strictly prohibited.`
    );
  }

  if (!isIsolatedTestDatabaseName(databaseName)) {
    throw new Error(
      `CRITICAL SAFETY ERROR: Database name '${databaseName}' is not a valid isolated test database. ` +
        `Database name must clearly identify as an isolated test database (e.g. 'samrat_fashion_test_isolated') ` +
        `and cannot be a default ('test'), production, or application database.`
    );
  }

  return { uri: trimmedUri, databaseName };
}

let envLoaded = false;

/**
 * Ensures environment variables are loaded from root or backend .env files.
 */
export function ensureEnvLoaded(): void {
  if (envLoaded) return;
  dotenv.config();
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  envLoaded = true;
}

/**
 * Retrieves and validates the TEST_MONGODB_URI environment variable.
 * NEVER falls back to MONGODB_URI.
 */
export function getVerifiedTestMongoUri(): string {
  ensureEnvLoaded();

  const testUri = process.env.TEST_MONGODB_URI;
  if (!testUri || !testUri.trim()) {
    throw new Error(
      "CRITICAL SAFETY ERROR: TEST_MONGODB_URI is not set in environment. " +
        "Test suites must NEVER silently fall back to MONGODB_URI. " +
        "Please configure TEST_MONGODB_URI with a dedicated isolated test database (e.g. 'samrat_fashion_test_isolated')."
    );
  }

  const { uri } = validateTestDatabaseUri(testUri);
  return uri;
}

export interface DatabaseConnectionTarget {
  readyState: number;
  name?: string;
  db?: { databaseName?: string };
}

/**
 * Asserts that the currently active Mongoose connection is connected to a verified isolated test database.
 * MUST be invoked before any test writes occur.
 */
export function assertSafeTestDatabase(
  connection: DatabaseConnectionTarget = mongoose.connection
): void {
  if (connection.readyState !== 1) {
    throw new Error(
      "CRITICAL SAFETY ERROR: Database is not connected when verifying test database isolation."
    );
  }

  const dbName = connection.name || (connection.db && connection.db.databaseName);
  if (!dbName) {
    throw new Error(
      "CRITICAL SAFETY ERROR: Connected database name cannot be determined."
    );
  }

  const appUri = process.env.MONGODB_URI;
  const appDb = appUri ? (extractDatabaseName(appUri) || "test") : "test";
  if (dbName.toLowerCase() === appDb.toLowerCase()) {
    throw new Error(
      `CRITICAL SAFETY ERROR: Active Mongoose connection is targeting the application database '${dbName}'. ` +
        `Aborting test execution immediately before any database writes occur.`
    );
  }

  if (!isIsolatedTestDatabaseName(dbName)) {
    throw new Error(
      `CRITICAL SAFETY ERROR: Active Mongoose connection is targeting database '${dbName}', ` +
        `which is NOT a verified isolated test database. Aborting test execution immediately before any database writes occur.`
    );
  }
}
