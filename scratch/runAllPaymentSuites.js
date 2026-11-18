const { execSync } = require('child_process');

const suites = [
  'payment-capture-protection.test.js',
  'payment-idempotency.test.js',
  'phase7-refund-webhook.test.js',
  'partial-item-cancellation.test.js',
  'partial-item-cancellation-audit.test.js',
  'webhook-lease-and-retention.test.js',
  'failure-injection-payment-audit.test.js',
  'payment-edge-cases-audit.test.js',
  'final-critical-review.test.js',
  'deployment-gate-verification.test.js',
  'replica-set-transactions.test.js',
  'payment-health.test.js',
  'order-expiry-recovery.test.js',
  'ops-http-integration.test.js',
  'refund-retry-concurrency.test.js',
  'production-hardening-remediation.test.js'
];

console.log('Running all 16 Payment, Refund, Recovery & Production Hardening Verification Suites...\n');

let totalPassed = 0;
let totalFailed = 0;
const results = [];

for (const suite of suites) {
  process.stdout.write(`Executing ${suite}... `);
  try {
    const env = {
      ...process.env,
      TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/samrat_fashion_test_isolated'
    };
    const out = execSync(`node backend/dist/tests/${suite}`, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 120000
    });

    const lines = out.trim().split('\n').map(l => l.trim()).filter(Boolean);
    let passed = 0;
    let failed = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const match = line.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
      if (match) {
        passed = parseInt(match[1], 10);
        failed = match[2] ? parseInt(match[2], 10) : 0;
        break;
      }
    }

    totalPassed += passed;
    totalFailed += failed;

    results.push({ suite, passed, failed, exitCode: 0 });
    console.log(`PASSED: ${passed}, FAILED: ${failed}`);
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const out = stdout + '\n' + stderr;
    const lines = out.trim().split('\n').map(l => l.trim()).filter(Boolean);
    let passed = 0;
    let failed = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const match = line.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
      if (match) {
        passed = parseInt(match[1], 10);
        failed = match[2] ? parseInt(match[2], 10) : 0;
        break;
      }
    }

    totalPassed += passed;
    totalFailed += (failed || 1);

    results.push({ suite, passed, failed: (failed || 1), exitCode: err.status, error: (stderr || stdout).slice(0, 300) });
    console.log(`FAILED! Passed: ${passed}, Failed: ${failed || 1}`);
  }
}

console.log('\n======================================================================');
console.log(`ALL SUITES SUMMARY: Total Passed: ${totalPassed}, Total Failed: ${totalFailed}`);
console.log('======================================================================');
results.forEach(r => {
  console.log(`- ${r.suite.padEnd(45)}: ${r.passed.toString().padStart(3)} passed, ${r.failed} failed ${r.failed === 0 ? '✅' : '❌'}`);
});
