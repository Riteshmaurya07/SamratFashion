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

test("optimizeCloudinaryUrl unwraps nested Next.js image proxy URLs", () => {
  const nested =
    "https://samrat-fashion.vercel.app/_next/image?url=https%3A%2F%2Fres.cloudinary.com%2Fdtvkytjnx%2Fimage%2Fupload%2Fv1793122343%2Fsamrat-fashion%2Fproducts%2Fzt2yyap22wwnwtokkjbv.png&w=1080&q=75";
  const optimized = optimizeCloudinaryUrl(nested, 600);
  assert.ok(
    optimized.startsWith("https://res.cloudinary.com/dtvkytjnx/image/upload/f_auto,q_auto:good,w_600,c_limit/"),
    `Expected unnested Cloudinary URL, got: ${optimized}`
  );
});

test("optimizeCloudinaryUrl unwraps nested Next.js image proxy URLs with Netlify origin", () => {
  const nested =
    "https://samratfashion.netlify.app/_next/image?url=https%3A%2F%2Fres.cloudinary.com%2Fdtvkytjnx%2Fimage%2Fupload%2Fv1793122343%2Fsamrat-fashion%2Fproducts%2Fzt2yyap22wwnwtokkjbv.png&w=1080&q=75";
  const optimized = optimizeCloudinaryUrl(nested, 600);
  assert.ok(
    optimized.startsWith("https://res.cloudinary.com/dtvkytjnx/image/upload/f_auto,q_auto:good,w_600,c_limit/"),
    `Expected unnested Cloudinary URL, got: ${optimized}`
  );
});

test("getServerApiBaseUrl returns normalized API base url", () => {
  const baseUrl = getServerApiBaseUrl();
  assert.ok(baseUrl.endsWith("/api"));
  assert.ok(!baseUrl.endsWith("/api/"));
});
