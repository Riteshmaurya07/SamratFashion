const assert = require("node:assert/strict");

const API_URL = process.env.API_URL || "http://localhost:5000/api";
const ACCESS_TOKEN = process.env.TEST_ACCESS_TOKEN;

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function run() {
  const catalog = await request("/catalog/customizable-products");
  assert.equal(catalog.response.status, 200, "customizable catalog should be public");
  assert.ok(Array.isArray(catalog.body.data), "catalog response should contain products");
  const product = catalog.body.data.find((item) => item.isCustomizable && item.variants?.length);
  assert.ok(product, "at least one customizable product with variants is required");
  const variant = product.variants.find((item) => item.isAvailable && item.stock > 0);
  assert.ok(variant, "a requestable variant is required");

  const unauthenticated = await request("/designs/requests", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticated.response.status, ACCESS_TOKEN ? 400 : 401, "request endpoint must enforce auth and validation");

  if (!ACCESS_TOKEN) {
    console.log("PASS: catalog and authentication boundary checks (set TEST_ACCESS_TOKEN for persistence checks)");
    return;
  }

  const idempotencyKey = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    productId: product._id,
    selectedVariantId: variant._id,
    selectedColor: variant.color,
    selectedSize: variant.size,
    printLocations: ["FRONT"],
    instructions: "E2E design assistance request",
    idempotencyKey,
  };
  const created = await request("/designs/requests", { method: "POST", body: JSON.stringify(payload) });
  assert.equal(created.response.status, 201, "no-artwork request should be created");
  assert.equal(created.body.data.artworkType, "NEEDS_DESIGN_ASSISTANCE");
  assert.equal(created.body.data.status, "REQUESTED");

  const duplicate = await request("/designs/requests", { method: "POST", body: JSON.stringify(payload) });
  assert.equal(duplicate.response.status, 200, "same idempotency key should not create a duplicate");
  assert.equal(duplicate.body.data._id, created.body.data._id);

  const invalidPlacement = await request("/designs/requests", {
    method: "POST",
    body: JSON.stringify({ ...payload, idempotencyKey: `${idempotencyKey}-invalid`, printLocations: ["SLEEVE"] }),
  });
  assert.equal(invalidPlacement.response.status, 400, "unsupported placement must be rejected");

  console.log("PASS: product authority, no-artwork request, REQUESTED state, idempotency, and placement validation");
}

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
