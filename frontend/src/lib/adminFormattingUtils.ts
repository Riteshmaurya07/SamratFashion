/**
 * Pure formatting and presentation utilities for admin pages.
 * Kept free of JSX so tests can run cleanly via standard node runner.
 */

export function formatCustomerDisplayName(customer?: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
} | null): string {
  if (!customer) return "Customer";
  const rawName = (customer.name || "").trim();

  // Generated UID/hex strings like "samrat-64a6...d2", "user_...", or 24-char ObjectId hex
  const isGeneratedUid =
    !rawName ||
    /^samrat-[0-9a-f]{6,}/i.test(rawName) ||
    /^user[-_][0-9a-f]{6,}/i.test(rawName) ||
    /^[0-9a-f]{24}$/i.test(rawName);

  if (!isGeneratedUid) {
    return rawName;
  }

  // Fallback 1: Email prefix
  if (customer.email && customer.email.includes("@")) {
    const prefix = customer.email.split("@")[0].trim();
    if (prefix) return prefix;
  }

  // Fallback 2: Phone with masked middle
  if (customer.phone) {
    const digits = customer.phone.replace(/\D/g, "");
    if (digits.length >= 4) {
      const last4 = digits.slice(-4);
      return `Customer +91-XXXXX-XX${last4}`;
    }
    return `Customer ${customer.phone.trim()}`;
  }

  return "Customer";
}

export function formatOrderPaymentBadge(order: {
  paymentStatus: string;
  refundedAmount?: number;
  total: number;
  financialSummary?: { refundSettled?: number };
}): { label: string; className: string } {
  const refunded = order.refundedAmount ?? order.financialSummary?.refundSettled ?? 0;
  if (
    order.paymentStatus === "PAID" ||
    order.paymentStatus === "REFUNDED" ||
    order.paymentStatus === "PARTIALLY_REFUNDED"
  ) {
    if (refunded >= order.total && order.total > 0) {
      return {
        label: "REFUNDED",
        className: "bg-indigo-50 text-indigo-700 border border-indigo-200",
      };
    }
    if (refunded > 0 && refunded < order.total) {
      return {
        label: `PAID (₹${refunded.toLocaleString("en-IN")} refunded)`,
        className: "bg-amber-50 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
      };
    }
  }

  const color =
    order.paymentStatus === "PAID"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : order.paymentStatus === "FAILED"
      ? "bg-rose-50 text-rose-700 border border-rose-200"
      : order.paymentStatus === "PENDING"
      ? "bg-amber-50 text-amber-700 border border-amber-200"
      : order.paymentStatus === "REFUNDED"
      ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
      : "bg-neutral-100 text-neutral-700 border border-neutral-200";

  return {
    label: order.paymentStatus,
    className: color,
  };
}
