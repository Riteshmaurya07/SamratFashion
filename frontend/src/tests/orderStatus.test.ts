import test from "node:test";
import assert from "node:assert/strict";
import { getOrderStatusBadges } from "../lib/orderStatus.ts";

const baseOrder = {
  status: "PENDING",
  paymentStatus: "PENDING",
  items: [{ quantity: 2, cancelledQuantity: 0 }],
};

test("orderStatus: lifecycle statuses map to customer-facing labels", () => {
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "DELIVERED", paymentStatus: "PAID" })[0].key,
    "DELIVERED"
  );
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "SHIPPED", paymentStatus: "PAID" })[0].label,
    "In Transit"
  );
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "PROCESSING", paymentStatus: "PAID" })[0].key,
    "PROCESSING"
  );
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "CONFIRMED", paymentStatus: "PAID" })[0].key,
    "CONFIRMED"
  );
  assert.strictEqual(getOrderStatusBadges(baseOrder)[0].key, "PENDING");
});

test("orderStatus: completed return wins over delivered", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "DELIVERED",
    paymentStatus: "PAID",
    returns: [{ status: "COMPLETED", items: [{ quantity: 2 }] }],
  });

  assert.strictEqual(badges[0].key, "RETURNED");
  assert.ok(!badges.some((badge) => badge.key === "PARTIAL_RETURN"));
});

test("orderStatus: active return shows return in progress", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "DELIVERED",
    paymentStatus: "PAID",
    returns: [{ status: "REQUESTED", items: [{ quantity: 1 }] }],
  });

  assert.strictEqual(badges[0].key, "RETURN_REQUESTED");
});

test("orderStatus: partially returned order is flagged", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "DELIVERED",
    paymentStatus: "PAID",
    returns: [{ status: "COMPLETED", items: [{ quantity: 1 }] }],
  });

  assert.strictEqual(badges[0].key, "RETURNED");
  assert.ok(badges.some((badge) => badge.key === "PARTIAL_RETURN"));
});

test("orderStatus: fully refunded cancellation shows refunded and cancelled", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "CANCELLED",
    paymentStatus: "REFUNDED",
  });

  assert.deepStrictEqual(
    badges.map((badge) => badge.key),
    ["REFUNDED", "CANCELLED"]
  );
});

test("orderStatus: partially cancelled order keeps lifecycle and shows refund", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "PROCESSING",
    paymentStatus: "PAID",
    partiallyCancelled: true,
    items: [{ quantity: 2, cancelledQuantity: 1 }],
    refunds: [{ status: "PROCESSED" }],
  });

  assert.strictEqual(badges[0].key, "PARTIALLY_CANCELLED");
  assert.ok(badges.some((badge) => badge.key === "REFUNDED"));
});

test("orderStatus: failed payment and expired orders are surfaced", () => {
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "PENDING", paymentStatus: "FAILED" })[0].key,
    "PAYMENT_FAILED"
  );
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "EXPIRED", paymentStatus: "FAILED" })[0].key,
    "PAYMENT_FAILED"
  );
  assert.strictEqual(
    getOrderStatusBadges({ ...baseOrder, status: "EXPIRED", paymentStatus: "PENDING" })[0].key,
    "EXPIRED"
  );
});

test("orderStatus: rejected or cancelled return requests are ignored", () => {
  const badges = getOrderStatusBadges({
    ...baseOrder,
    status: "DELIVERED",
    paymentStatus: "PAID",
    returns: [
      { status: "REJECTED", items: [{ quantity: 2 }] },
      { status: "CANCELLED", items: [{ quantity: 2 }] },
    ],
  });

  assert.strictEqual(badges[0].key, "DELIVERED");
});
