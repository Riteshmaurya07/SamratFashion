import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiBaseUrl } from "../lib/api.ts";

test("normalizeApiBaseUrl appends the API path when it is missing", () => {
  assert.equal(normalizeApiBaseUrl("http://localhost:5000"), "http://localhost:5000/api");
});

test("normalizeApiBaseUrl preserves an existing API path and removes trailing slashes", () => {
  assert.equal(normalizeApiBaseUrl("http://localhost:5000/api/"), "http://localhost:5000/api");
  assert.equal(normalizeApiBaseUrl("https://api.example.com/API"), "https://api.example.com/API");
});
