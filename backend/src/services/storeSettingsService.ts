import { StoreSettings } from '../models/StoreSettings';

export interface StoreShippingSettings {
  freeShippingThreshold: number;
  standardShippingFee: number;
}

/**
 * Defaults preserve the historical behaviour of the storefront so that a
 * missing settings document never changes what customers are charged.
 */
export const STORE_SETTINGS_DEFAULTS: StoreShippingSettings = {
  freeShippingThreshold: 999,
  standardShippingFee: 100,
};

const SINGLETON_KEY = 'default';

/**
 * Reads the singleton settings document. Falls back to defaults when the
 * document has never been saved from the admin panel.
 */
export async function getStoreSettings(): Promise<StoreShippingSettings> {
  const doc = await StoreSettings.findOne({ key: SINGLETON_KEY }).lean();
  if (!doc) {
    return { ...STORE_SETTINGS_DEFAULTS };
  }

  return {
    freeShippingThreshold: doc.freeShippingThreshold,
    standardShippingFee: doc.standardShippingFee,
  };
}

export async function saveStoreSettings(
  settings: StoreShippingSettings,
  actorId?: string
): Promise<StoreShippingSettings> {
  const doc = await StoreSettings.findOneAndUpdate(
    { key: SINGLETON_KEY },
    {
      $set: {
        freeShippingThreshold: settings.freeShippingThreshold,
        standardShippingFee: settings.standardShippingFee,
        ...(actorId ? { updatedBy: actorId } : {}),
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  return {
    freeShippingThreshold: doc.freeShippingThreshold,
    standardShippingFee: doc.standardShippingFee,
  };
}

export interface ShippingCalculationOptions {
  /**
   * True only when every available item in the cart is marked as free delivery.
   * A mixed cart falls back to the normal order-value threshold rule so a
   * single cheap free-delivery item cannot waive shipping on a large order.
   */
  allItemsFreeDelivery?: boolean;
}

/**
 * Authoritative shipping calculation used by both the cart summary and the
 * checkout order creation. Keeping this in one place prevents the classic
 * "cart says free but checkout charges" drift.
 *
 * Rules:
 * - Empty cart: no shipping.
 * - Every item marked free delivery: free shipping.
 * - Order value >= configured threshold: free shipping.
 * - Threshold of 0 means free shipping for every order.
 * - Fee of 0 means delivery is never charged.
 */
export function calculateShipping(
  subtotal: number,
  discount: number,
  settings: StoreShippingSettings,
  options: ShippingCalculationOptions = {}
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return 0;
  }

  if (options.allItemsFreeDelivery) {
    return 0;
  }

  const eligibleSubtotal = subtotal - discount;

  const fee = Number(settings.standardShippingFee);
  if (!Number.isFinite(fee) || fee <= 0) {
    return 0;
  }

  const threshold = Number(settings.freeShippingThreshold);
  if (!Number.isFinite(threshold) || eligibleSubtotal >= threshold) {
    return 0;
  }

  return fee;
}
