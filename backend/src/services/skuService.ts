import { Types } from 'mongoose';
import { IOrder } from '../models/Order';
import { Product } from '../models/Product';
import { normalizeSku } from '../utils/skuFormat';

/**
 * Orders created before SKUs were snapshotted onto line items have no product
 * code to print on invoices or packing slips. Resolve those from the catalog
 * and persist them once, so every later render is cheap and historically
 * stable even if the variant is renamed later.
 *
 * Returns true when the order document was modified and saved.
 */
export async function backfillOrderItemSkus(order: IOrder): Promise<boolean> {
  const items = order.items || [];
  const missing = items.filter((item) => !normalizeSku(item.sku) && item.variantId);
  if (missing.length === 0) return false;

  const variantIds = Array.from(
    new Set(
      missing
        .map((item) => String(item.variantId))
        .filter((id) => Types.ObjectId.isValid(id))
    )
  );
  if (variantIds.length === 0) return false;

  const products = await Product.find({ 'variants._id': { $in: variantIds } })
    .select('variants._id variants.sku')
    .lean();

  const skuByVariantId = new Map<string, string>();
  for (const product of products) {
    for (const variant of product.variants || []) {
      const sku = normalizeSku(variant.sku);
      if (variant._id && sku) {
        skuByVariantId.set(String(variant._id), sku);
      }
    }
  }

  let changed = false;
  for (const item of items) {
    if (normalizeSku(item.sku)) continue;
    const sku = skuByVariantId.get(String(item.variantId));
    if (sku) {
      item.sku = sku;
      changed = true;
    }
  }

  if (changed) {
    order.markModified('items');
    await order.save();
  }

  return changed;
}
