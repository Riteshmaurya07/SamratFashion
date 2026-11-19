import test from "node:test";
import assert from "node:assert/strict";
import type { RawLowStockProduct } from "../lib/adminDashboardUtils.ts";
import {
  computeActionChips,
  getPaymentHealthWidgetState,
  limitLowStockItems,
} from "../lib/adminDashboardUtils.ts";

test("adminDashboard: Action strip hides individual chips when all counts are 0 and shows chips when > 0", () => {
  // 1. All counts are 0: no alert chips returned (triggers 'All caught up' UI state)
  const allClear = computeActionChips({
    failedWebhooks: 0,
    failedPayments: 0,
    failedEmails: 0,
    lowStockProducts: 0,
  });
  assert.strictEqual(allClear.length, 0, "All counts at 0 should return zero alert chips");

  // 2. Individual and multiple counts > 0
  const activeAlerts = computeActionChips({
    failedWebhooks: 7,
    failedPayments: 1,
    failedEmails: 8,
    lowStockProducts: 4,
  });

  assert.strictEqual(activeAlerts.length, 4, "Should return 4 alert chips for the 4 positive counts");

  // Verify webhook chip
  const webhookChip = activeAlerts.find(c => c.id === "webhooks");
  assert.ok(webhookChip, "Webhook chip must be present");
  assert.strictEqual(webhookChip.count, 7);
  assert.strictEqual(webhookChip.severity, "red", "Webhooks must have red severity");
  assert.strictEqual(webhookChip.href, "/admin/payment-reconciliation");
  assert.match(webhookChip.label, /7 webhooks failed/);

  // Verify payment chip
  const paymentChip = activeAlerts.find(c => c.id === "payments");
  assert.ok(paymentChip, "Payment chip must be present");
  assert.strictEqual(paymentChip.count, 1);
  assert.strictEqual(paymentChip.severity, "red", "Payments must have red severity");
  assert.strictEqual(paymentChip.href, "/admin/orders?paymentStatus=FAILED");
  assert.match(paymentChip.label, /1 payment failed/);

  // Verify email chip
  const emailChip = activeAlerts.find(c => c.id === "emails");
  assert.ok(emailChip, "Email chip must be present");
  assert.strictEqual(emailChip.count, 8);
  assert.strictEqual(emailChip.severity, "amber", "Emails must have amber severity");
  assert.strictEqual(emailChip.href, "/admin/notifications");
  assert.match(emailChip.label, /8 emails failed/);

  // Verify low stock chip
  const stockChip = activeAlerts.find(c => c.id === "lowStock");
  assert.ok(stockChip, "Stock chip must be present");
  assert.strictEqual(stockChip.count, 4);
  assert.strictEqual(stockChip.severity, "amber", "Low stock must have amber severity");
  assert.strictEqual(stockChip.href, "/admin/inventory");
  assert.match(stockChip.label, /4 low stock alerts/);

  // 3. Fail silent: When webhook or email API fails (represented by null), that chip is omitted
  const apiFailed = computeActionChips({
    failedWebhooks: null,
    failedPayments: 2,
    failedEmails: null,
    lowStockProducts: 0,
  });
  assert.strictEqual(apiFailed.length, 1);
  assert.strictEqual(apiFailed[0].id, "payments");
});

test("adminDashboard: payment-health widget shows red when unresolved > 0 and green when unresolved === 0", () => {
  // Case 1: Unresolved > 0 must NEVER be healthy / green
  const unresolvedState = getPaymentHealthWidgetState(7);
  assert.strictEqual(unresolvedState.isHealthy, false, "Must not be healthy when unresolved > 0");
  assert.strictEqual(unresolvedState.unresolvedCount, 7);
  assert.strictEqual(unresolvedState.statusText, "7 Unresolved");
  assert.ok(unresolvedState.badgeClass.includes("text-red-700"), "Must carry red status class");
  assert.ok(!unresolvedState.badgeClass.includes("emerald"), "Must never carry green emerald class");

  const singleUnresolved = getPaymentHealthWidgetState(1);
  assert.strictEqual(singleUnresolved.isHealthy, false);
  assert.ok(singleUnresolved.badgeClass.includes("text-red-700"));

  // Case 2: Unresolved === 0 shows green 'All settled'
  const settledState = getPaymentHealthWidgetState(0);
  assert.strictEqual(settledState.isHealthy, true, "Must be healthy when unresolved is 0");
  assert.strictEqual(settledState.unresolvedCount, 0);
  assert.strictEqual(settledState.statusText, "All settled");
  assert.ok(settledState.badgeClass.includes("text-emerald-700"), "Must carry emerald green class");
});

test("adminDashboard: low-stock list returns at most 5 items", () => {
  const dummyProducts: RawLowStockProduct[] = Array.from({ length: 9 }, (_, i) => ({
    id: `prod_${i + 1}`,
    name: `Low Stock Product ${i + 1}`,
    stock: i,
    reorderThreshold: 5,
  }));

  const cappedList = limitLowStockItems(dummyProducts);
  assert.strictEqual(cappedList.length, 5, "List with 9 items must be capped at 5");
  assert.strictEqual(cappedList[0].id, "prod_1");
  assert.strictEqual(cappedList[4].id, "prod_5");

  const shortList = limitLowStockItems(dummyProducts.slice(0, 3));
  assert.strictEqual(shortList.length, 3, "List with 3 items should return all 3");

  const emptyList = limitLowStockItems([]);
  assert.strictEqual(emptyList.length, 0);

  const nullList = limitLowStockItems(null);
  assert.strictEqual(nullList.length, 0);
});
