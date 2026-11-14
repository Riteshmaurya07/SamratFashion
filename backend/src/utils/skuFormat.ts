/**
 * SKU helpers shared by the product model, the admin catalog API and the
 * order/invoice/fulfilment snapshots.
 *
 * SKUs are canonicalised to trimmed upper-case so that `tv-ovr-blk-m` and
 * `TV-OVR-BLK-M` cannot slip into the catalog as two "different" codes.
 */

export function normalizeSku(sku?: string | null): string {
  return String(sku ?? '').trim().toUpperCase();
}

export function normalizeVariantSkus<T extends { sku?: string }>(variants: T[] = []): T[] {
  return variants.map((variant) => ({ ...variant, sku: normalizeSku(variant.sku) }));
}

/**
 * SKUs repeated inside a single product's variant list. MongoDB's unique
 * multikey index only guards across documents, so this must be enforced in the
 * application too.
 */
export function findDuplicateSkus(variants: Array<{ sku?: string }> = []): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const variant of variants) {
    const sku = normalizeSku(variant.sku);
    if (!sku) continue;
    if (seen.has(sku)) {
      duplicates.add(sku);
    } else {
      seen.add(sku);
    }
  }

  return Array.from(duplicates);
}

export function isDuplicateSkuError(error: unknown): boolean {
  const err = error as { code?: number; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> };
  if (!err || err.code !== 11000) return false;
  const keyPattern = err.keyPattern || {};
  const keyValue = err.keyValue || {};
  return 'variants.sku' in keyPattern || Object.keys(keyValue).some((key) => key.startsWith('variants.sku'));
}
