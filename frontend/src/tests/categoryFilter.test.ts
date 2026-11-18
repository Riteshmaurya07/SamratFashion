import test from "node:test";
import assert from "node:assert/strict";
import { filterStorefrontCategories } from "../lib/categoryFilter.ts";

test("filterStorefrontCategories hides empty categories like Kurta while keeping populated ones", () => {
  const categories = [
    { _id: "1", name: "Coti", slug: "coti", status: "ACTIVE" as const, productCount: 4 },
    { _id: "2", name: "Kurta", slug: "kurta", status: "ACTIVE" as const, productCount: 0 },
    { _id: "3", name: "T-Shirts", slug: "t-shirts", status: "ACTIVE" as const, productCount: 12 },
  ];

  const result = filterStorefrontCategories(categories);
  assert.deepEqual(
    result.map((c) => c.slug),
    ["coti", "t-shirts"]
  );
});

test("filterStorefrontCategories keeps a parent category if an active child has products", () => {
  const categories = [
    { _id: "p1", name: "Ethnic", slug: "ethnic", status: "ACTIVE" as const, productCount: 0 },
    {
      _id: "c1",
      name: "Coti",
      slug: "coti",
      status: "ACTIVE" as const,
      parentCategory: "p1",
      productCount: 3,
    },
    {
      _id: "c2",
      name: "Kurta",
      slug: "kurta",
      status: "ACTIVE" as const,
      parentCategory: "p1",
      productCount: 0,
    },
  ];

  const result = filterStorefrontCategories(categories);
  assert.deepEqual(
    result.map((c) => c.slug),
    ["ethnic", "coti"]
  );
});

test("filterStorefrontCategories excludes hidden internal slugs and inactive categories", () => {
  const categories = [
    { _id: "1", name: "Custom Print", slug: "custom-print", status: "ACTIVE" as const, productCount: 5 },
    { _id: "2", name: "Archived", slug: "archived", status: "INACTIVE" as const, productCount: 5 },
    { _id: "3", name: "Oversized", slug: "oversized", status: "ACTIVE" as const, productCount: 2 },
  ];

  const result = filterStorefrontCategories(categories);
  assert.deepEqual(
    result.map((c) => c.slug),
    ["oversized"]
  );
});
