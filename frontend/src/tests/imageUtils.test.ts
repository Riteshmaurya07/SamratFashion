import { test } from "node:test";
import assert from "node:assert";
import { optimizeCloudinaryUrl } from "../lib/imageUtils.ts";
import { getServerApiBaseUrl } from "../lib/serverApi.ts";

test("optimizeCloudinaryUrl injects f_auto, q_auto:good, and width into raw Cloudinary URL", () => {
  const rawUrl =
    "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/nehru_root_front.jpg";
  const optimized = optimizeCloudinaryUrl(rawUrl, 600);
  assert.strictEqual(
    optimized,
    "https://res.cloudinary.com/dtvkytjnx/image/upload/f_auto,q_auto:good,w_600,c_limit/v1/samrat-fashion/products/nehru_root_front.jpg"
  );
});

test("optimizeCloudinaryUrl preserves already transformed URLs", () => {
  const transformed =
    "https://res.cloudinary.com/dtvkytjnx/image/upload/f_auto,q_auto,w_800/v1/sample.jpg";
  assert.strictEqual(optimizeCloudinaryUrl(transformed), transformed);
  assert.strictEqual(optimizeCloudinaryUrl(undefined), "");
});

test("optimizeCloudinaryUrl optimizes Unsplash URLs to target width", () => {
  const unsplash =
    "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=2070";
  const optimized = optimizeCloudinaryUrl(unsplash, 600);
  assert.ok(optimized.includes("w=600"));
  assert.ok(optimized.includes("auto=format"));
});

test("getServerApiBaseUrl returns normalized API base url", () => {
  const baseUrl = getServerApiBaseUrl();
  assert.ok(baseUrl.endsWith("/api"));
  assert.ok(!baseUrl.endsWith("/api/"));
});
