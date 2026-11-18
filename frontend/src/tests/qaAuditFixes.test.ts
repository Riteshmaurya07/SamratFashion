import test from "node:test";
import assert from "node:assert/strict";
import { formatCityStatePin } from "../lib/addressFormat.ts";
import { formatFreeShippingRule } from "../lib/storeSettingsDefaults.ts";

test("formatCityStatePin formats city, state, and postal code with proper spacing", () => {
  assert.equal(
    formatCityStatePin({ city: "Lucknow", state: "Uttar Pradesh", postalCode: "226001" }),
    "Lucknow, Uttar Pradesh - 226001"
  );
  assert.equal(
    formatCityStatePin({ city: " Raebareli ", state: " Uttar Pradesh ", postalCode: " 229402 " }),
    "Raebareli, Uttar Pradesh - 229402"
  );
  assert.equal(
    formatCityStatePin({ city: "New Delhi", state: "", postalCode: "110001" }),
    "New Delhi - 110001"
  );
  assert.equal(formatCityStatePin(null), "");
});

test("formatFreeShippingRule handles zero and positive thresholds consistently with >= math", () => {
  assert.equal(formatFreeShippingRule(99), "Free shipping on orders ₹99+");
  assert.equal(formatFreeShippingRule(999, { uppercase: true }), "FREE SHIPPING ON ORDERS ₹999+");
  assert.equal(
    formatFreeShippingRule(499, { includeDomestic: true, uppercase: true }),
    "FREE DOMESTIC SHIPPING ON ORDERS ₹499+"
  );
  assert.equal(formatFreeShippingRule(0), "Free shipping on all orders");
  assert.equal(
    formatFreeShippingRule(0, { includeDomestic: true, uppercase: true }),
    "FREE DOMESTIC SHIPPING ON ALL ORDERS"
  );
});
