export type OrderStatusTone =
  | "emerald"
  | "blue"
  | "amber"
  | "neutral"
  | "red"
  | "purple"
  | "orange"
  | "slate"
  | "indigo"
  | "brand";

export type OrderDisplayStatusKey =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "PARTIALLY_CANCELLED"
  | "RETURN_REQUESTED"
  | "RETURNED"
  | "REFUNDED"
  | "PAYMENT_FAILED"
  | "EXPIRED";

export interface OrderStatusBadge {
  key: string;
  label: string;
  tone: OrderStatusTone;
}

/**
 * Minimal shape needed to derive a customer-facing status. Both the order list
 * payload and the order detail payload satisfy it.
 */
export interface OrderStatusSource {
  status: string;
  paymentStatus?: string;
  partiallyCancelled?: boolean;
  items?: Array<{ quantity?: number; cancelledQuantity?: number }>;
  returns?: Array<{ status?: string; items?: Array<{ quantity?: number }> }>;
  refunds?: Array<{ status?: string }>;
}

const RETURN_COMPLETED_STATUSES = new Set(["ACCEPTED", "COMPLETED"]);
const RETURN_ACTIVE_STATUSES = new Set([
  "REQUESTED",
  "APPROVED",
  "RECEIVED",
  "INSPECTING",
]);
const REFUND_ACTIVE_STATUSES = new Set(["PENDING", "PROCESSING", "UNKNOWN"]);

export const ORDER_STATUS_TONE_CLASSES: Record<OrderStatusTone, string> = {
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  neutral: "bg-neutral-100 text-neutral-800 border-neutral-300",
  red: "bg-red-50 text-red-800 border-red-200",
  purple: "bg-purple-50 text-purple-800 border-purple-200",
  orange: "bg-orange-50 text-orange-800 border-orange-200",
  slate: "bg-slate-100 text-slate-800 border-slate-300",
  indigo: "bg-indigo-50 text-indigo-800 border-indigo-200",
  brand: "bg-brand/10 text-brand border-brand/20",
};

/**
 * Returns the ordered quantity still attached to the order (ordered minus the
 * quantities that were cancelled line-by-line).
 */
export function getOrderRemainingQuantity(order: OrderStatusSource): number {
  const items = order.items ?? [];
  const ordered = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  const cancelled = items.reduce(
    (sum, item) => sum + (item.cancelledQuantity ?? 0),
    0
  );
  return Math.max(0, ordered - cancelled);
}

/**
 * Derives the badges a customer should see for an order. The first badge is
 * the primary status; the rest are supplementary facts (refunded, partially
 * cancelled, payment failed, partial return).
 *
 * Priority: returned > return in progress > refunded > cancelled >
 * partially cancelled > payment failed > lifecycle status.
 */
export function getOrderStatusBadges(
  order: OrderStatusSource
): OrderStatusBadge[] {
  const status = String(order.status || "").toUpperCase();
  const paymentStatus = String(order.paymentStatus || "").toUpperCase();
  const returns = order.returns ?? [];
  const refunds = order.refunds ?? [];

  const cancelledQuantity = (order.items ?? []).reduce(
    (sum, item) => sum + (item.cancelledQuantity ?? 0),
    0
  );
  const isPartiallyCancelled =
    order.partiallyCancelled === true ||
    (cancelledQuantity > 0 && status !== "CANCELLED");

  const hasActiveReturn = returns.some((ret) =>
    RETURN_ACTIVE_STATUSES.has(String(ret.status || "").toUpperCase())
  );
  const completedReturns = returns.filter((ret) =>
    RETURN_COMPLETED_STATUSES.has(String(ret.status || "").toUpperCase())
  );
  const hasCompletedReturn = completedReturns.length > 0;

  const remainingQuantity = getOrderRemainingQuantity(order);
  const returnedQuantity = completedReturns.reduce(
    (sum, ret) =>
      sum +
      (ret.items ?? []).reduce(
        (itemSum, item) => itemSum + (item.quantity ?? 0),
        0
      ),
    0
  );
  const isPartiallyReturned =
    hasCompletedReturn && remainingQuantity > 0
      ? returnedQuantity < remainingQuantity
      : false;

  const hasProcessedRefund = refunds.some(
    (refund) => String(refund.status || "").toUpperCase() === "PROCESSED"
  );
  const hasPendingRefund = refunds.some((refund) =>
    REFUND_ACTIVE_STATUSES.has(String(refund.status || "").toUpperCase())
  );

  let primary: OrderStatusBadge;

  if (hasCompletedReturn) {
    primary = {
      key: "RETURNED",
      label: "Returned",
      tone: "slate",
    };
  } else if (hasActiveReturn) {
    primary = {
      key: "RETURN_REQUESTED",
      label: "Return In Progress",
      tone: "orange",
    };
  } else if (paymentStatus === "REFUNDED") {
    primary = { key: "REFUNDED", label: "Refunded", tone: "indigo" };
  } else if (status === "CANCELLED") {
    primary = { key: "CANCELLED", label: "Cancelled", tone: "red" };
  } else if (isPartiallyCancelled) {
    primary = {
      key: "PARTIALLY_CANCELLED",
      label: "Partially Cancelled",
      tone: "purple",
    };
  } else if (paymentStatus === "FAILED") {
    primary = {
      key: "PAYMENT_FAILED",
      label: "Payment Failed",
      tone: "red",
    };
  } else if (status === "EXPIRED") {
    primary = { key: "EXPIRED", label: "Expired", tone: "neutral" };
  } else if (status === "DELIVERED") {
    primary = { key: "DELIVERED", label: "Delivered", tone: "emerald" };
  } else if (status === "SHIPPED") {
    primary = { key: "SHIPPED", label: "In Transit", tone: "blue" };
  } else if (status === "PROCESSING") {
    primary = { key: "PROCESSING", label: "Processing", tone: "amber" };
  } else if (status === "CONFIRMED") {
    primary = { key: "CONFIRMED", label: "Confirmed", tone: "neutral" };
  } else {
    primary = { key: "PENDING", label: "Pending", tone: "amber" };
  }

  const badges: OrderStatusBadge[] = [primary];
  const seen = new Set([primary.key]);

  const push = (badge: OrderStatusBadge) => {
    if (seen.has(badge.key)) return;
    seen.add(badge.key);
    badges.push(badge);
  };

  if (primary.key !== "REFUNDED") {
    if (paymentStatus === "REFUNDED" || hasProcessedRefund) {
      push({ key: "REFUNDED", label: "Refunded", tone: "indigo" });
    } else if (hasPendingRefund) {
      push({
        key: "REFUND_PENDING",
        label: "Refund Processing",
        tone: "amber",
      });
    }
  }

  if (primary.key === "REFUNDED" && status === "CANCELLED") {
    push({ key: "CANCELLED", label: "Cancelled", tone: "red" });
  }

  if (primary.key !== "PARTIALLY_CANCELLED" && isPartiallyCancelled) {
    push({
      key: "PARTIALLY_CANCELLED",
      label: "Partially Cancelled",
      tone: "purple",
    });
  }

  if (primary.key !== "PAYMENT_FAILED" && paymentStatus === "FAILED") {
    push({ key: "PAYMENT_FAILED", label: "Payment Failed", tone: "red" });
  }

  if (primary.key === "RETURNED" && isPartiallyReturned) {
    push({ key: "PARTIAL_RETURN", label: "Partial Return", tone: "orange" });
  }

  return badges;
}

export function getPrimaryOrderStatus(
  order: OrderStatusSource
): OrderStatusBadge {
  return getOrderStatusBadges(order)[0];
}
