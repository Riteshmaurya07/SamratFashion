export interface StoreSettings {
  freeShippingThreshold: number;
  standardShippingFee: number;
}

/**
 * Fallback values match the backend defaults so the first paint is stable when
 * the settings endpoint is unreachable.
 */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  freeShippingThreshold: 999,
  standardShippingFee: 100,
};

/**
 * Formats the free-shipping threshold consistently with backend eligibility
 * (`eligibleSubtotal >= freeShippingThreshold`, and `threshold <= 0` means all orders ship free).
 */
export function formatFreeShippingRule(
  threshold: number,
  options?: { uppercase?: boolean; includeDomestic?: boolean }
): string {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, Math.round(threshold)) : 0;
  let text: string;
  if (safeThreshold <= 0) {
    text = options?.includeDomestic
      ? "Free domestic shipping on all orders"
      : "Free shipping on all orders";
  } else {
    const formatted = safeThreshold.toLocaleString("en-IN");
    text = options?.includeDomestic
      ? `Free domestic shipping on orders ₹${formatted}+`
      : `Free shipping on orders ₹${formatted}+`;
  }
  return options?.uppercase ? text.toUpperCase() : text;
}
