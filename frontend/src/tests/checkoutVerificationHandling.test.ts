import test from "node:test";
import assert from "node:assert/strict";
import { resolveCheckoutVerificationRoute } from "../lib/checkoutRouting.ts";

test("resolveCheckoutVerificationRoute: routes confirmed payment to /order-confirmation", () => {
  const dest = resolveCheckoutVerificationRoute("ord_123", {
    status: 200,
    data: { reason: "CONFIRMED" }
  });
  assert.equal(dest.type, "CONFIRMATION");
  assert.equal(dest.path, "/order-confirmation/ord_123");
  assert.equal(dest.alertMessage, undefined);
});

test("resolveCheckoutVerificationRoute: routes reconciliationRequired to /account/orders with alert", () => {
  const dest = resolveCheckoutVerificationRoute("ord_123", {
    status: 200,
    data: { reconciliationRequired: true, reason: "GATEWAY_VERIFICATION_TIMEOUT" }
  });
  assert.equal(dest.type, "ORDERS_STATUS");
  assert.equal(dest.path, "/account/orders/ord_123");
  assert.match(dest.alertMessage, /payment is being confirmed/i);
});

test("resolveCheckoutVerificationRoute: routes processing flag to /account/orders with alert", () => {
  const dest = resolveCheckoutVerificationRoute("ord_123", {
    status: 200,
    data: { processing: true }
  });
  assert.equal(dest.type, "ORDERS_STATUS");
  assert.equal(dest.path, "/account/orders/ord_123");
  assert.match(dest.alertMessage, /payment is being confirmed/i);
});

test("resolveCheckoutVerificationRoute: routes HTTP 202 to /account/orders with alert", () => {
  const dest = resolveCheckoutVerificationRoute("ord_123", {
    status: 202,
    data: {}
  });
  assert.equal(dest.type, "ORDERS_STATUS");
  assert.equal(dest.path, "/account/orders/ord_123");
  assert.match(dest.alertMessage, /payment is being confirmed/i);
});

test("resolveCheckoutVerificationRoute: handles stock unavailable with refund notice and order confirmation summary", () => {
  const dest = resolveCheckoutVerificationRoute("ord_123", {
    status: 200,
    data: { orderCancelled: true, reason: "STOCK_UNAVAILABLE" }
  });
  assert.equal(dest.type, "CONFIRMATION");
  assert.equal(dest.path, "/order-confirmation/ord_123");
  assert.match(dest.alertMessage || "", /refunded automatically/i);
});
