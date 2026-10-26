import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getAdminDiagnostics, getLiveness, getReadiness } from '../controllers/healthController';

dotenv.config({ path: '.env' });

function mockReq(): any {
  return { requestId: 'req_test_diag_123', user: { role: 'ADMIN' } };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.data = data;
      return this;
    }
  };
  return res;
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  System Health Semantics & Security Test Suite   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let testUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';
  if (testUri.includes('?')) {
    testUri = testUri.replace('/?', '/samrat_fashion_test_isolated?');
  } else {
    testUri = testUri.replace(/\/$/, '') + '/samrat_fashion_test_isolated';
  }

  await mongoose.connect(testUri);
  console.log('✅ Connected to MongoDB isolated DB\n');

  let passed = 0;
  let failed = 0;

  const check = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  try {
    // 1. Diagnostics endpoint verification
    const resDiag = mockRes();
    getAdminDiagnostics(mockReq(), resDiag);

    check(resDiag.statusCode === 200, 'Diagnostics returns HTTP 200');
    check(resDiag.data?.database === 'CONNECTED', 'Database status reports actual readiness (CONNECTED)');
    check(resDiag.data?.paymentProvider?.verificationType === 'CONFIGURATION_ONLY', 'Payment verification marked CONFIGURATION_ONLY');
    check(['CONFIGURED', 'NOT_CONFIGURED'].includes(resDiag.data?.paymentProvider?.status), 'Payment status is CONFIGURED or NOT_CONFIGURED');
    check(resDiag.data?.logisticsProvider?.verificationType === 'CONFIGURATION_ONLY', 'Logistics verification marked CONFIGURATION_ONLY');
    check(resDiag.data?.emailProvider?.verificationType === 'CONFIGURATION_ONLY', 'Email verification marked CONFIGURATION_ONLY');

    // 2. Security leak verification: Prove NO secrets, tokens, or credentials leak in response
    const jsonStr = JSON.stringify(resDiag.data);
    check(!jsonStr.includes('rzp_'), 'No Razorpay keys leak in response');
    check(!jsonStr.includes('mongodb'), 'No MongoDB connection strings leak in response');
    check(!jsonStr.includes('secret') && !jsonStr.includes('SECRET'), 'No API secrets leak in response');
    check(!jsonStr.includes('token') && !jsonStr.includes('TOKEN'), 'No auth tokens leak in response');
    check(resDiag.data?.requestId === 'req_test_diag_123', 'RequestId preserved from observability middleware');

    // 3. Liveness & Readiness endpoints
    const resLive = mockRes();
    getLiveness(mockReq(), resLive);
    check(resLive.statusCode === 200 && resLive.data?.status === 'ok', 'Liveness probe returns 200 ok');

    const resReady = mockRes();
    getReadiness(mockReq(), resReady);
    check(resReady.statusCode === 200 && resReady.data?.status === 'ready', 'Readiness probe returns 200 ready');

  } catch (err) {
    console.error('Health test error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
