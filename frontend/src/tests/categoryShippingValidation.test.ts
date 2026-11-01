import test from "node:test";
import assert from "node:assert/strict";
import { validateCategoryShipping } from "../lib/categoryShippingValidation.ts";

test("validateCategoryShipping: disabled category always validates cleanly", () => {
  const res1 = validateCategoryShipping(false, 0);
  assert.strictEqual(res1.isValid, true);
  assert.strictEqual(res1.parsedAmount, 0);

  const res2 = validateCategoryShipping(false, undefined);
  assert.strictEqual(res2.isValid, true);
  assert.strictEqual(res2.parsedAmount, 0);

  // When disabled, passing empty or arbitrary input does not block form submission
  const res3 = validateCategoryShipping(false, "");
  assert.strictEqual(res3.isValid, true);
  assert.strictEqual(res3.parsedAmount, 0);
});

test("validateCategoryShipping: rejects empty input when category free delivery is enabled", () => {
  const resEmpty = validateCategoryShipping(true, "");
  assert.strictEqual(resEmpty.isValid, false);
  assert.ok(resEmpty.error?.includes("required"));

  const resWhitespace = validateCategoryShipping(true, "   ");
  assert.strictEqual(resWhitespace.isValid, false);
  assert.ok(resWhitespace.error?.includes("required"));

  const resNull = validateCategoryShipping(true, null);
  assert.strictEqual(resNull.isValid, false);
  assert.ok(resNull.error?.includes("required"));

  const resUndefined = validateCategoryShipping(true, undefined);
  assert.strictEqual(resUndefined.isValid, false);
  assert.ok(resUndefined.error?.includes("required"));
});

test("validateCategoryShipping: rejects negative values when enabled", () => {
  const resNegative = validateCategoryShipping(true, -50);
  assert.strictEqual(resNegative.isValid, false);
  assert.ok(resNegative.error?.includes("negative"));

  const resNegativeStr = validateCategoryShipping(true, "-0.01");
  assert.strictEqual(resNegativeStr.isValid, false);
  assert.ok(resNegativeStr.error?.includes("negative"));
});

test("validateCategoryShipping: rejects NaN, Infinity, and non-numeric inputs", () => {
  const resNaN = validateCategoryShipping(true, "NaN");
  assert.strictEqual(resNaN.isValid, false);
  assert.ok(resNaN.error?.includes("valid finite number"));

  const resAlpha = validateCategoryShipping(true, "invalid_amount");
  assert.strictEqual(resAlpha.isValid, false);
  assert.ok(resAlpha.error?.includes("valid finite number"));

  const resInf = validateCategoryShipping(true, Infinity);
  assert.strictEqual(resInf.isValid, false);
  assert.ok(resInf.error?.includes("valid finite number"));
});

test("validateCategoryShipping: accepts and preserves exact numerical values without silent rounding", () => {
  const resInt = validateCategoryShipping(true, 1499);
  assert.strictEqual(resInt.isValid, true);
  assert.strictEqual(resInt.parsedAmount, 1499);

  // Exact decimal preservation (never silently rounded)
  const resDecimal = validateCategoryShipping(true, "799.50");
  assert.strictEqual(resDecimal.isValid, true);
  assert.strictEqual(resDecimal.parsedAmount, 799.5);

  const resDecimalNum = validateCategoryShipping(true, 1299.75);
  assert.strictEqual(resDecimalNum.isValid, true);
  assert.strictEqual(resDecimalNum.parsedAmount, 1299.75);
});

test("validateCategoryShipping: supports zero-threshold rule value (0)", () => {
  const resZero = validateCategoryShipping(true, 0);
  assert.strictEqual(resZero.isValid, true);
  assert.strictEqual(resZero.parsedAmount, 0);

  const resZeroStr = validateCategoryShipping(true, "0");
  assert.strictEqual(resZeroStr.isValid, true);
  assert.strictEqual(resZeroStr.parsedAmount, 0);
});
