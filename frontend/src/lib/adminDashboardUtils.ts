export interface ActionChipItem {
  id: string;
  label: string;
  count: number;
  href: string;
  severity: "red" | "amber";
  icon: string;
}

export interface ActionChipCounts {
  failedWebhooks: number | null;
  failedPayments: number;
  failedEmails: number | null;
  lowStockProducts: number;
}

/**
 * Computes action chips for the admin dashboard Action Needed strip.
 * - Shows a chip ONLY when its count is > 0.
 * - If a count is null (e.g. API failed), that chip is omitted (fails silently).
 * - When all counts are 0, returns an empty array (dashboard renders "All caught up" chip).
 */
export function computeActionChips(counts: ActionChipCounts): ActionChipItem[] {
  const chips: ActionChipItem[] = [];

  // 1. Failed webhooks (Severity: RED)
  if (counts.failedWebhooks !== null && counts.failedWebhooks > 0) {
    chips.push({
      id: "webhooks",
      label: `${counts.failedWebhooks} webhook${counts.failedWebhooks === 1 ? "" : "s"} failed`,
      count: counts.failedWebhooks,
      href: "/admin/payment-reconciliation",
      severity: "red",
      icon: "sync_problem",
    });
  }

  // 2. Failed payments (Severity: RED)
  if (counts.failedPayments > 0) {
    chips.push({
      id: "payments",
      label: `${counts.failedPayments} payment${counts.failedPayments === 1 ? "" : "s"} failed`,
      count: counts.failedPayments,
      href: "/admin/orders?paymentStatus=FAILED",
      severity: "red",
      icon: "credit_card_off",
    });
  }

  // 3. Failed notification emails (Severity: AMBER)
  if (counts.failedEmails !== null && counts.failedEmails > 0) {
    chips.push({
      id: "emails",
      label: `${counts.failedEmails} email${counts.failedEmails === 1 ? "" : "s"} failed`,
      count: counts.failedEmails,
      href: "/admin/notifications",
      severity: "amber",
      icon: "mail_lock",
    });
  }

  // 4. Low stock products (Severity: AMBER)
  if (counts.lowStockProducts > 0) {
    chips.push({
      id: "lowStock",
      label: `${counts.lowStockProducts} low stock alert${counts.lowStockProducts === 1 ? "" : "s"}`,
      count: counts.lowStockProducts,
      href: "/admin/inventory",
      severity: "amber",
      icon: "inventory_2",
    });
  }

  return chips;
}

export interface PaymentHealthWidgetState {
  isHealthy: boolean;
  statusText: string;
  badgeClass: string;
  unresolvedCount: number;
}

/**
 * Evaluates payment health widget state.
 * Hard rule: Never show a green "healthy" state when unresolved > 0.
 * If unresolved is 0, show green "All settled".
 */
export function getPaymentHealthWidgetState(unresolvedTotal: number): PaymentHealthWidgetState {
  if (unresolvedTotal > 0) {
    return {
      isHealthy: false,
      statusText: `${unresolvedTotal} Unresolved`,
      badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300",
      unresolvedCount: unresolvedTotal,
    };
  }

  return {
    isHealthy: true,
    statusText: "All settled",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
    unresolvedCount: 0,
  };
}

export interface RawLowStockProduct {
  id: string;
  name: string;
  variant?: string;
  size?: string;
  color?: string;
  sku?: string;
  stock: number;
  reorderThreshold?: number;
}

/**
 * Enforces capping low-stock items at at most 5 items for the dashboard.
 */
export function limitLowStockItems<T extends RawLowStockProduct>(items: T[] | null | undefined): T[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5);
}
