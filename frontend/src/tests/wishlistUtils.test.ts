import test from "node:test";
import assert from "node:assert/strict";
import { cleanId, isItemInWishlist } from "../store/useWishlistStore.ts";
import type { WishlistItem } from "../store/useWishlistStore.ts";

test("cleanId: preserves hyphenated product slugs without truncating to first word", () => {
  const slug = "classic-4-pocket-nehru-jacket-for-men";
  assert.strictEqual(cleanId(slug), "classic-4-pocket-nehru-jacket-for-men");
  assert.notStrictEqual(cleanId(slug), "classic");
});

test("cleanId: extracts 24-character hexadecimal ObjectId when appended with colorway suffix", () => {
  const compositeId = "6ae0e27a0ef3bca7f413996a-Sage-Green";
  assert.strictEqual(cleanId(compositeId), "6ae0e27a0ef3bca7f413996a");

  const compositeIdObject = { _id: "6ae0e27a0ef3bca7f413996a-Midnight-Black" };
  assert.strictEqual(cleanId(compositeIdObject), "6ae0e27a0ef3bca7f413996a");
});

test("cleanId: preserves pure 24-character hexadecimal ObjectId without modification", () => {
  const pureObjectId = "6ae0e27a0ef3bca7f413996a";
  assert.strictEqual(cleanId(pureObjectId), "6ae0e27a0ef3bca7f413996a");
});

test("isItemInWishlist: matches wishlisted item by exact id or variant", () => {
  const items: WishlistItem[] = [
    {
      productId: {
        _id: "6ae0e27a0ef3bca7f413996a",
        name: "Classic 4-Pocket Nehru Jacket for Men",
        slug: "classic-4-pocket-nehru-jacket-for-men",
        basePrice: 102,
        images: [],
        isNewArrival: true,
        isBestSeller: false,
        status: "ACTIVE",
        variants: [
          { _id: "var-sage-green", color: "Sage Green", size: "L" },
          { _id: "var-midnight-black", color: "Midnight Black", size: "M" },
        ],
      },
      variantId: "var-sage-green",
      addedAt: new Date().toISOString(),
    },
  ];

  // Matches when querying the exact variant
  assert.strictEqual(
    isItemInWishlist(items, "6ae0e27a0ef3bca7f413996a", "var-sage-green"),
    true
  );

  // Matches when querying by selectedColor
  assert.strictEqual(
    isItemInWishlist(items, "6ae0e27a0ef3bca7f413996a", undefined, "Sage Green"),
    true
  );

  // Matches composite colorway ID
  assert.strictEqual(
    isItemInWishlist(items, "6ae0e27a0ef3bca7f413996a-Sage-Green", undefined, "Sage Green"),
    true
  );

  // Does not match a different variant or color
  assert.strictEqual(
    isItemInWishlist(items, "6ae0e27a0ef3bca7f413996a", "var-midnight-black"),
    false
  );
  assert.strictEqual(
    isItemInWishlist(items, "6ae0e27a0ef3bca7f413996a", undefined, "Navy Blue"),
    false
  );
});
