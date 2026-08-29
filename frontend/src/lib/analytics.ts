// Google Analytics 4 (GA4) & Custom Event Tracking Utility
// Strictly privacy-safe, idempotent, and non-blocking.

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "";

// Tracked purchase IDs in memory to prevent duplicate events on re-renders/refreshes
const processedPurchaseIds = new Set<string>();

/**
 * Filter out PII and secret values from analytics payload
 */
export function sanitizeAnalyticsParams(params?: Record<string, any>): Record<string, any> {
  if (!params) return {};

  const sensitiveKeys = [
    "password",
    "passwordhash",
    "token",
    "resettoken",
    "jwt",
    "authorization",
    "secret",
    "cvv",
    "cardnumber",
    "ssn",
    "messagebody",
    "artworkdata",
    "rawimage",
    "base64",
    "email",
    "phone",
    "addressline1",
    "addressline2"
  ];

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      // Redact sensitive value
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      sanitized[key] = sanitizeAnalyticsParams(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

/**
 * Track custom analytics event safely
 */
export function trackEvent(eventName: string, params?: Record<string, any>): void {
  try {
    if (typeof window === "undefined") return;

    // Filter PII and sensitive parameters
    const safeParams = sanitizeAnalyticsParams(params);

    // Output to console in development mode
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Analytics Event] ${eventName}:`, safeParams);
    }

    if (window.gtag && GA_MEASUREMENT_ID) {
      window.gtag("event", eventName, safeParams);
    }
  } catch (err) {
    // Analytics failures must never break UI/checkout
    console.warn("Analytics tracking error:", err);
  }
}

/**
 * Track Page View event
 */
export function trackPageView(url: string, title?: string): void {
  trackEvent("page_view", {
    page_location: url,
    page_title: title || (typeof document !== "undefined" ? document.title : ""),
  });
}

/**
 * Track Product View (view_item)
 */
export function trackProductView(product: {
  id: string;
  name: string;
  category?: string;
  price: number;
  currency?: string;
}): void {
  trackEvent("view_item", {
    currency: product.currency || "INR",
    value: product.price / 100, // Convert paise to INR
    items: [
      {
        item_id: product.id,
        item_name: product.name,
        item_category: product.category || "Apparel",
        price: product.price / 100,
      },
    ],
  });
}

/**
 * Track Search (view_search_results)
 */
export function trackSearch(searchQuery: string, resultCount?: number): void {
  const safeTerm = searchQuery.trim().substring(0, 100);
  if (!safeTerm) return;

  trackEvent("search", {
    search_term: safeTerm,
    result_count: resultCount || 0,
  });
}

/**
 * Track Add to Cart (add_to_cart)
 */
export function trackAddToCart(item: {
  id: string;
  name: string;
  category?: string;
  price: number;
  quantity: number;
  variantSize?: string;
  variantColor?: string;
}): void {
  trackEvent("add_to_cart", {
    currency: "INR",
    value: (item.price * item.quantity) / 100,
    items: [
      {
        item_id: item.id,
        item_name: item.name,
        item_category: item.category || "Apparel",
        item_variant: `${item.variantSize || ""} / ${item.variantColor || ""}`.trim(),
        price: item.price / 100,
        quantity: item.quantity,
      },
    ],
  });
}

/**
 * Track Begin Checkout (begin_checkout)
 */
export function trackBeginCheckout(cartTotal: number, itemCount: number): void {
  trackEvent("begin_checkout", {
    currency: "INR",
    value: cartTotal / 100,
    item_count: itemCount,
  });
}

/**
 * Track Idempotent Purchase (purchase)
 * Fired ONLY upon authoritative order confirmation. Deduplicated by orderNumber.
 */
export function trackPurchase(order: {
  orderNumber: string;
  total: number;
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  items: Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    selectedSize?: string;
    selectedColor?: string;
  }>;
}): boolean {
  if (!order || !order.orderNumber) return false;

  // Check if purchase event was already fired for this orderNumber
  if (processedPurchaseIds.has(order.orderNumber)) {
    return false; // Skip duplicate purchase event
  }

  // Also check sessionStorage if available
  if (typeof window !== "undefined" && window.sessionStorage) {
    const sessionKey = `analytics_purchase_${order.orderNumber}`;
    if (window.sessionStorage.getItem(sessionKey)) {
      processedPurchaseIds.add(order.orderNumber);
      return false;
    }
    window.sessionStorage.setItem(sessionKey, "1");
  }

  processedPurchaseIds.add(order.orderNumber);

  trackEvent("purchase", {
    transaction_id: order.orderNumber,
    value: order.total / 100,
    currency: "INR",
    tax: order.tax / 100,
    shipping: order.shipping / 100,
    discount: order.discount / 100,
    items: order.items.map((item) => ({
      item_id: item.productId,
      item_name: item.productName,
      price: item.unitPrice / 100,
      quantity: item.quantity,
      item_variant: `${item.selectedSize || ""} / ${item.selectedColor || ""}`.trim(),
    })),
  });

  return true;
}
