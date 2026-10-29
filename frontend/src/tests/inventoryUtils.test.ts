import test from "node:test";
import assert from "node:assert/strict";
import type { RawProduct } from "../lib/inventoryUtils.ts";
import {
  groupProductInventory,
  groupAllProductsInventory,
  calculateInventoryStats,
  extractUniqueColors,
  extractUniqueSizes,
  filterProductGroups,
  validateStockAdjustment,
  sortSizes,
  resolveColorHex,
} from "../lib/inventoryUtils.ts";

test("inventoryUtils: sortSizes sorts apparel and numeric sizes in natural fashion order", () => {
  const input = ["XL", "S", "XXL", "M", "XS", "L", "3XL", "FREE", "32", "28", "30"];
  const sorted = sortSizes(input);
  assert.deepStrictEqual(sorted, ["XS", "S", "M", "L", "XL", "XXL", "3XL", "FREE", "28", "30", "32"]);
});

test("inventoryUtils: resolveColorHex resolves hex from variant, sibling, fallback, or undefined", () => {
  assert.strictEqual(resolveColorHex("Black", "#000000"), "#000000");
  assert.strictEqual(resolveColorHex("Sage Green", undefined), "#8A9A86");
  assert.strictEqual(
    resolveColorHex("Custom Tint", undefined, [
      { sku: "T1", color: "Custom Tint", hexCode: "#AABBCC", stock: 10 },
    ]),
    "#AABBCC"
  );
  assert.strictEqual(resolveColorHex("", undefined), undefined);
});

test("inventoryUtils: groupProductInventory calculates exact aggregate stock and groups by colour and size", () => {
  const sampleProduct: RawProduct = {
    _id: "prod-1",
    name: "Classic 4-Pocket Nehru Jacket for Men",
    slug: "classic-4-pocket-nehru-jacket-for-men",
    images: ["https://example.com/jacket-main.jpg"],
    categoryId: { _id: "cat-1", name: "Nehru Jackets" },
    variants: [
      {
        _id: "var-1",
        sku: "NEHRUCOT-SAG-S",
        size: "S",
        color: "Sage Green",
        stock: 2,
        reorderThreshold: 5,
        warehouseLocation: "Bay A1",
      },
      {
        _id: "var-2",
        sku: "NEHRUCOT-SAG-M",
        size: "M",
        color: "Sage Green",
        stock: 5,
        reorderThreshold: 5,
        warehouseLocation: "Bay A1",
      },
      {
        _id: "var-3",
        sku: "NEHRUCOT-SAG-L",
        size: "L",
        color: "Sage Green",
        stock: 5,
        reorderThreshold: 5,
        warehouseLocation: "Bay A1",
      },
      {
        _id: "var-4",
        sku: "CLASSIC4-SAN-S",
        size: "S",
        color: "Sand Beige",
        stock: 5,
        reorderThreshold: 5,
        warehouseLocation: "Bay B2",
      },
      {
        _id: "var-5",
        sku: "CLASSIC4-SAN-M",
        size: "M",
        color: "Sand Beige",
        stock: 5,
        reorderThreshold: 5,
        warehouseLocation: "Bay B2",
      },
    ],
  };

  const group = groupProductInventory(sampleProduct);

  assert.strictEqual(group.productId, "prod-1");
  assert.strictEqual(group.name, "Classic 4-Pocket Nehru Jacket for Men");
  assert.strictEqual(group.categoryName, "Nehru Jackets");
  // Total units: 2 + 5 + 5 + 5 + 5 = 22
  assert.strictEqual(group.totalStock, 22);
  assert.strictEqual(group.totalVariants, 5);

  // Colourways: Sage Green & Sand Beige
  assert.strictEqual(group.colorways.length, 2);
  const sage = group.colorways.find((c) => c.color === "Sage Green");
  assert.ok(sage, "Sage Green colorway must exist");
  assert.strictEqual(sage.totalStock, 12);
  assert.strictEqual(sage.variants.length, 3);
  assert.strictEqual(sage.variantsBySize["S"].length, 1);
  assert.strictEqual(sage.variantsBySize["S"][0].stock, 2);
  assert.strictEqual(sage.variantsBySize["S"][0].stockStatus, "LOW_STOCK");

  const beige = group.colorways.find((c) => c.color === "Sand Beige");
  assert.ok(beige, "Sand Beige colorway must exist");
  assert.strictEqual(beige.totalStock, 10);
  assert.strictEqual(beige.variants.length, 2);

  // All sizes sorted
  assert.deepStrictEqual(group.allSizes, ["S", "M", "L"]);

  // Health summary: 5 units with threshold 5 are considered LOW_STOCK (stock <= 5)
  // 2 <= 5 (low), 5 <= 5 (low) -> 5 low stock items, 0 out of stock
  assert.strictEqual(group.stockHealth.lowStockCount, 5);
  assert.strictEqual(group.stockHealth.outOfStockCount, 0);
  assert.strictEqual(group.overallStatus, "LOW_STOCK");
});

test("inventoryUtils: handles products with empty variant lists gracefully", () => {
  const emptyProd: RawProduct = {
    _id: "prod-empty",
    name: "Draft Hoodie",
    slug: "draft-hoodie",
    variants: [],
  };

  const group = groupProductInventory(emptyProd);
  assert.strictEqual(group.productId, "prod-empty");
  assert.strictEqual(group.totalStock, 0);
  assert.strictEqual(group.totalVariants, 0);
  assert.strictEqual(group.colorways.length, 0);
  assert.deepStrictEqual(group.allSizes, []);
  assert.strictEqual(group.stockHealth.outOfStockCount, 0);
  assert.strictEqual(group.stockHealth.lowStockCount, 0);
  assert.strictEqual(group.stockHealth.healthyCount, 0);
  assert.strictEqual(group.overallStatus, "HEALTHY");
});

test("inventoryUtils: handles duplicate variants for same color and size without losing data or stock", () => {
  const duplicateVariantsProd: RawProduct = {
    _id: "prod-dup",
    name: "Graphic Tee",
    slug: "graphic-tee",
    variants: [
      {
        _id: "v1",
        sku: "TEE-BLK-M-BATCH1",
        size: "M",
        color: "Black",
        stock: 10,
        reorderThreshold: 5,
      },
      {
        _id: "v2",
        sku: "TEE-BLK-M-BATCH2",
        size: "M",
        color: "Black",
        stock: 15,
        reorderThreshold: 5,
      },
    ],
  };

  const group = groupProductInventory(duplicateVariantsProd);
  // Total stock must sum both variants: 10 + 15 = 25
  assert.strictEqual(group.totalStock, 25);
  assert.strictEqual(group.totalVariants, 2);
  const black = group.colorways.find((c) => c.color === "Black");
  assert.ok(black);
  assert.strictEqual(black.totalStock, 25);
  // Size "M" must list both variants
  assert.strictEqual(black.variantsBySize["M"].length, 2);
  assert.strictEqual(black.variantsBySize["M"][0].sku, "TEE-BLK-M-BATCH1");
  assert.strictEqual(black.variantsBySize["M"][1].sku, "TEE-BLK-M-BATCH2");
});

test("inventoryUtils: calculateInventoryStats aggregates all products accurately", () => {
  const prods: RawProduct[] = [
    {
      _id: "p1",
      name: "Item 1",
      slug: "item-1",
      variants: [
        { _id: "v1", sku: "S1", size: "S", color: "Red", stock: 0, reorderThreshold: 5 },
        { _id: "v2", sku: "S2", size: "M", color: "Red", stock: 3, reorderThreshold: 5 },
      ],
    },
    {
      _id: "p2",
      name: "Item 2",
      slug: "item-2",
      variants: [
        { _id: "v3", sku: "S3", size: "L", color: "Blue", stock: 20, reorderThreshold: 5 },
      ],
    },
  ];

  const groups = groupAllProductsInventory(prods);
  const stats = calculateInventoryStats(groups);

  assert.strictEqual(stats.totalProducts, 2);
  assert.strictEqual(stats.totalVariants, 3);
  assert.strictEqual(stats.totalUnits, 23);
  assert.strictEqual(stats.outOfStockCount, 1);
  assert.strictEqual(stats.lowStockCount, 1);
});

test("inventoryUtils: extractUniqueColors and extractUniqueSizes collect sorted sets", () => {
  const prods: RawProduct[] = [
    {
      _id: "p1",
      name: "Item 1",
      slug: "item-1",
      variants: [
        { sku: "S1", size: "XL", color: "White", stock: 10 },
        { sku: "S2", size: "S", color: "Black", stock: 10 },
      ],
    },
    {
      _id: "p2",
      name: "Item 2",
      slug: "item-2",
      variants: [
        { sku: "S3", size: "M", color: "Black", stock: 10 },
        { sku: "S4", size: "L", color: "Amber", stock: 10 },
      ],
    },
  ];

  const groups = groupAllProductsInventory(prods);
  const colors = extractUniqueColors(groups);
  const sizes = extractUniqueSizes(groups);

  assert.deepStrictEqual(colors, ["Amber", "Black", "White"]);
  assert.deepStrictEqual(sizes, ["S", "M", "L", "XL"]);
});

test("inventoryUtils: filterProductGroups handles search, stockStatus, color, and size filters", () => {
  const prods: RawProduct[] = [
    {
      _id: "p1",
      name: "Heavyweight Cotton T-Shirt",
      slug: "heavyweight-cotton-tshirt",
      variants: [
        { sku: "HVY-BLK-S", size: "S", color: "Black", stock: 0, reorderThreshold: 5 },
        { sku: "HVY-BLK-M", size: "M", color: "Black", stock: 12, reorderThreshold: 5 },
      ],
    },
    {
      _id: "p2",
      name: "Linen Summer Shirt",
      slug: "linen-summer-shirt",
      variants: [
        { sku: "LIN-WHT-L", size: "L", color: "White", stock: 2, reorderThreshold: 5 },
      ],
    },
    {
      _id: "p3",
      name: "Denim Jeans",
      slug: "denim-jeans",
      variants: [
        { sku: "DNM-BLU-32", size: "32", color: "Blue", stock: 25, reorderThreshold: 5 },
      ],
    },
  ];

  const groups = groupAllProductsInventory(prods);

  // 1. Search by SKU
  const searchSku = filterProductGroups(groups, { search: "LIN-WHT" });
  assert.strictEqual(searchSku.length, 1);
  assert.strictEqual(searchSku[0].productId, "p2");

  // 2. Search by color
  const searchColor = filterProductGroups(groups, { search: "blue" });
  assert.strictEqual(searchColor.length, 1);
  assert.strictEqual(searchColor[0].productId, "p3");

  // 3. Stock filter: OUT_OF_STOCK
  const filterOOS = filterProductGroups(groups, { stockStatus: "OUT_OF_STOCK" });
  assert.strictEqual(filterOOS.length, 1);
  assert.strictEqual(filterOOS[0].productId, "p1");

  // 4. Stock filter: LOW_STOCK
  const filterLow = filterProductGroups(groups, { stockStatus: "LOW_STOCK" });
  assert.strictEqual(filterLow.length, 1);
  assert.strictEqual(filterLow[0].productId, "p2");

  // 5. Stock filter: HEALTHY
  const filterHealthy = filterProductGroups(groups, { stockStatus: "HEALTHY" });
  assert.strictEqual(filterHealthy.length, 1);
  assert.strictEqual(filterHealthy[0].productId, "p3");

  // 6. Color filter dropdown
  const filterByColor = filterProductGroups(groups, { color: "black" });
  assert.strictEqual(filterByColor.length, 1);
  assert.strictEqual(filterByColor[0].productId, "p1");

  // 7. Size filter dropdown
  const filterBySize = filterProductGroups(groups, { size: "32" });
  assert.strictEqual(filterBySize.length, 1);
  assert.strictEqual(filterBySize[0].productId, "p3");
});

test("inventoryUtils: validateStockAdjustment enforces backend schema constraints", () => {
  // 1. Quantity is 0
  const zeroQty = validateStockAdjustment(10, 0, "Restock");
  assert.strictEqual(zeroQty.valid, false);
  assert.match(zeroQty.error!, /Quantity adjustment cannot be 0/i);

  // 2. Reason is missing or too short
  const shortReason = validateStockAdjustment(10, 5, "a");
  assert.strictEqual(shortReason.valid, false);
  assert.match(shortReason.error!, /Reason is required/i);

  // 3. Decrement exceeds current stock
  const overDeduct = validateStockAdjustment(5, -10, "Physical audit loss");
  assert.strictEqual(overDeduct.valid, false);
  assert.match(overDeduct.error!, /Cannot decrease by 10 units/i);

  // 4. Valid positive restock
  const validRestock = validateStockAdjustment(5, 20, "Shipment arrival PO-99");
  assert.strictEqual(validRestock.valid, true);

  // 5. Valid decrement within current stock
  const validDeduct = validateStockAdjustment(5, -3, "Damaged in transit");
  assert.strictEqual(validDeduct.valid, true);
});
