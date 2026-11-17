/**
 * HTTP integration suite: /api/ops payment health and coordinated recovery.
 *
 * Exercises the real Express app from src/index.ts, including middleware order,
 * shared-secret authentication (header + Vercel-style Bearer), batch-limit
 * validation, single-flight recovery, and read-only health checks.
 *
 * No live Razorpay calls are made: the recovery cycle only sees empty local
 * fixtures and the test environment blocks gateway transport.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';
process.env.ALLOW_PAYMENT_MOCK = 'true';
process.env.OPS_SECRET = 'test_ops_secret_at_least_16_chars';

import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { app } from '../index';
import { connectSafeTestDb } from './testHelpers';
import { RecoveryStatus } from '../models/RecoveryStatus';
import { WorkerLock } from '../models/WorkerLock';
import {
  RECOVERY_LOCK_NAME,
  RecoveryCoordinatorService,
} from '../services/recovery/recoveryCoordinatorService';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${desc}`);
  } else {
    failed++;
    const message = detail ? `${desc} — ${detail}` : desc;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

interface HttpResult {
  status: number;
  body: any;
  raw: string;
}

async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: payload,
  });
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: response.status, body, raw };
}

async function run(): Promise<void> {
  await connectSafeTestDb();
  await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME });
  await RecoveryStatus.deleteOne({ identifier: 'SINGLETON' });

  const coordinator: any = RecoveryCoordinatorService;
  const originalExecute = coordinator.executeCoordinatedRecoveryCycle;
  let executions = 0;
  coordinator.executeCoordinatedRecoveryCycle = (options: any) => {
    executions++;
    return originalExecute.call(coordinator, options);
  };

  const server: http.Server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = process.env.OPS_SECRET as string;

  try {
    // ---------------------------------------------------------------------
    // Authentication
    // ---------------------------------------------------------------------
    const healthUnauthorized = await request(baseUrl, '/api/ops/payments/health');
    check(
      healthUnauthorized.status === 401,
      'OPS-HTTP1: Unauthenticated health request receives 401',
      `status=${healthUnauthorized.status}`
    );

    const healthWrongSecret = await request(baseUrl, '/api/ops/payments/health', {
      headers: { 'x-ops-secret': 'wrong-secret-wrong-secret' },
    });
    check(
      healthWrongSecret.status === 401,
      'OPS-HTTP2: Incorrect OPS_SECRET is rejected',
      `status=${healthWrongSecret.status}`
    );

    const healthQuerySecret = await request(
      baseUrl,
      `/api/ops/payments/health?x-ops-secret=${encodeURIComponent(secret)}`
    );
    check(
      healthQuerySecret.status === 401,
      'OPS-HTTP3: Secret supplied only in the query string is rejected',
      `status=${healthQuerySecret.status}`
    );

    const healthHeader = await request(baseUrl, '/api/ops/payments/health', {
      headers: { 'x-ops-secret': secret },
    });
    check(
      (healthHeader.status === 200 || healthHeader.status === 503) &&
        typeof healthHeader.body?.data?.status === 'string',
      'OPS-HTTP4: Health endpoint works with x-ops-secret',
      `status=${healthHeader.status}, report=${healthHeader.body?.data?.status}`
    );

    const healthBearer = await request(baseUrl, '/api/ops/payments/health', {
      headers: { authorization: `Bearer ${secret}` },
    });
    check(
      (healthBearer.status === 200 || healthBearer.status === 503) &&
        typeof healthBearer.body?.data?.status === 'string',
      'OPS-HTTP5: Vercel-style Bearer authentication works',
      `status=${healthBearer.status}`
    );

    check(
      executions === 0,
      'OPS-HTTP6: Health checks never invoke the recovery coordinator',
      `executions=${executions}`
    );

    const secretValues = [
      process.env.OPS_SECRET,
      process.env.RAZORPAY_KEY_SECRET,
      process.env.RAZORPAY_WEBHOOK_SECRET,
      process.env.JWT_ACCESS_SECRET,
      process.env.JWT_REFRESH_SECRET,
    ].filter((value): value is string => Boolean(value));
    check(
      secretValues.every((value) => !healthHeader.raw.includes(value)),
      'OPS-HTTP7: Health response never exposes configured secrets'
    );
    check(
      healthHeader.body?.data?.configuration?.razorpayKeySecretConfigured === true &&
        healthHeader.body?.data?.configuration?.opsSecretConfigured === true,
      'OPS-HTTP8: Health response reports configuration as booleans only'
    );

    // ---------------------------------------------------------------------
    // Unauthorized recovery is rejected without executing work
    // ---------------------------------------------------------------------
    executions = 0;
    const recoveryUnauthorized = await request(baseUrl, '/api/ops/recovery/run', {
      method: 'POST',
      body: { batchLimit: 5 },
    });
    check(
      recoveryUnauthorized.status === 401,
      'OPS-HTTP9: Unauthorized recovery invocation receives 401',
      `status=${recoveryUnauthorized.status}`
    );
    check(
      executions === 0,
      'OPS-HTTP10: Unauthorized recovery invocation executes no cycle',
      `executions=${executions}`
    );

    // ---------------------------------------------------------------------
    // Batch-limit validation and bounding
    // ---------------------------------------------------------------------
    let lastOptions: any = null;
    coordinator.executeCoordinatedRecoveryCycle = async (options: any) => {
      executions++;
      lastOptions = options;
      return {
        executed: false,
        skippedReason: 'TEST_STUB',
        durationMs: 0,
        inventoryResolvedCount: 0,
        webhookProcessedCount: 0,
        webhookRecoveredCount: 0,
        refundsRecoveredCount: 0,
        errors: [],
      };
    };

    await request(baseUrl, '/api/ops/recovery/run', {
      method: 'POST',
      headers: { 'x-ops-secret': secret },
      body: { batchLimit: 100000 },
    });
    check(
      lastOptions?.batchLimit === 100,
      'OPS-HTTP11: Oversized batchLimit is clamped to 100',
      `batchLimit=${lastOptions?.batchLimit}`
    );

    await request(baseUrl, '/api/ops/recovery/run', {
      method: 'POST',
      headers: { 'x-ops-secret': secret },
      body: { batchLimit: 'not-a-number' },
    });
    check(
      lastOptions?.batchLimit === 20,
      'OPS-HTTP12: Non-numeric batchLimit falls back to the safe default',
      `batchLimit=${lastOptions?.batchLimit}`
    );

    await request(baseUrl, '/api/ops/recovery/run', {
      method: 'POST',
      headers: { 'x-ops-secret': secret },
      body: { batchLimit: -50 },
    });
    check(
      lastOptions?.batchLimit === 1,
      'OPS-HTTP13: Negative batchLimit is bounded to 1',
      `batchLimit=${lastOptions?.batchLimit}`
    );

    // Restore the real coordinator for end-to-end invocation tests.
    coordinator.executeCoordinatedRecoveryCycle = (options: any) => {
      executions++;
      return originalExecute.call(coordinator, options);
    };

    // ---------------------------------------------------------------------
    // One authorized call invokes exactly one coordinated cycle
    // ---------------------------------------------------------------------
    await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME });
    executions = 0;
    const recoveryAuthorized = await request(baseUrl, '/api/ops/recovery/run', {
      method: 'GET',
      headers: { 'x-ops-secret': secret },
    });
    check(
      recoveryAuthorized.status === 200,
      'OPS-HTTP14: Authorized recovery request returns 200',
      `status=${recoveryAuthorized.status}`
    );
    check(
      executions === 1 && recoveryAuthorized.body?.data?.executed === true,
      'OPS-HTTP15: One HTTP request invokes exactly one coordinated cycle',
      `executions=${executions}, executed=${recoveryAuthorized.body?.data?.executed}, reason=${recoveryAuthorized.body?.data?.skippedReason ?? 'none'}`
    );

    const storedStatus: any = await RecoveryStatus.findOne({ identifier: 'SINGLETON' }).lean();
    check(
      Boolean(storedStatus?.lastRunCompletedAt),
      'OPS-HTTP16: Coordinator persisted a completed recovery status'
    );
    check(
      typeof recoveryAuthorized.body?.data?.expiredOrdersCount === 'number',
      'OPS-HTTP17: Recovery report exposes the order-expiry task count'
    );

    // ---------------------------------------------------------------------
    // Concurrent invocations do not duplicate work
    // ---------------------------------------------------------------------
    await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME });
    executions = 0;
    const [concurrentA, concurrentB] = await Promise.all([
      request(baseUrl, '/api/ops/recovery/run', {
        method: 'POST',
        headers: { 'x-ops-secret': secret },
        body: { batchLimit: 10 },
      }),
      request(baseUrl, '/api/ops/recovery/run', {
        method: 'POST',
        headers: { 'x-ops-secret': secret },
        body: { batchLimit: 10 },
      }),
    ]);
    const executedCount = [concurrentA, concurrentB].filter(
      (result) => result.body?.data?.executed === true
    ).length;
    check(
      concurrentA.status === 200 && concurrentB.status === 200,
      'OPS-HTTP18: Both concurrent authorized invocations return 200',
      `statuses=${concurrentA.status}/${concurrentB.status}`
    );
    check(
      executedCount === 1,
      'OPS-HTTP19: Concurrent invocations execute exactly one cycle',
      `executed=${executedCount}, bodies=${JSON.stringify([
        concurrentA.body?.data?.skippedReason,
        concurrentB.body?.data?.skippedReason,
      ])}`
    );
    check(
      [concurrentA, concurrentB].some(
        (result) =>
          result.body?.data?.skippedReason === 'CYCLE_ALREADY_IN_PROGRESS_LOCAL' ||
          result.body?.data?.skippedReason === 'LOCKED_BY_ANOTHER_INSTANCE'
      ),
      'OPS-HTTP20: The losing concurrent invocation is explicitly skipped'
    );
  } catch (err: unknown) {
    failed++;
    failures.push(`Suite error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    console.error('Suite error:', err);
  } finally {
    coordinator.executeCoordinatedRecoveryCycle = originalExecute;
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
    await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME }).catch(() => undefined);
    await RecoveryStatus.deleteOne({ identifier: 'SINGLETON' }).catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log('------------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:');
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exitCode = 1;
  }
  console.log('------------------------------------------------------------');
}

run();
