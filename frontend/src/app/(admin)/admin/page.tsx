"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  computeActionChips,
  getPaymentHealthWidgetState,
  limitLowStockItems,
} from "@/lib/adminDashboardUtils";
import { fetchAdminPermissions, getFirstAllowedRoute } from "@/lib/adminPermissions";

interface LowStockItem {
  id: string;
  name: string;
  variant?: string;
  size?: string;
  color?: string;
  sku?: string;
  stock: number;
  reorderThreshold: number;
}

interface ServiceHealthStatus {
  database: {
    connected: boolean;
  };
  razorpay: {
    configured: boolean;
    lastWebhookAt: string | null;
  };
  email: {
    configured: boolean;
    provider: string;
    lastEmailSentAt: string | null;
    recentFailures: boolean;
  };
  recoveryScheduler: {
    running: boolean;
    lastRunCompletedAt: string | null;
    status: string;
  };
}

interface PaymentHealthCounts {
  webhooks: {
    processed: number;
    failed: number;
    unresolved?: number;
  };
  attempts: {
    captured: number;
    pending: number;
    failed: number;
  };
}

interface DashboardMetrics {
  totalOrders: number;
  pendingOrders: number;
  confirmedOrders: number;
  processingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  paidOrders: number;
  failedPayments: number;
  revenue: number;
  lowStockProducts: number;
  lowStockList?: LowStockItem[];
  isTestData?: boolean;
  services?: ServiceHealthStatus;
  paymentHealth?: PaymentHealthCounts;
}

interface RecentOrder {
  _id: string;
  orderNumber: string;
  userId: { name: string; email: string };
  total: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

interface TrendDayItem {
  date: string;
  label: string;
  weekday: string;
  revenue: number;
  orders: number;
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const router = useRouter();
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [greeting, setGreeting] = useState("Good morning");

  // Action strip alert states (fail silent: null means fetch failed or hidden)
  const [failedWebhooksCount, setFailedWebhooksCount] = useState<number | null>(null);
  const [failedEmailsCount, setFailedEmailsCount] = useState<number | null>(null);
  const [reconSummary, setReconSummary] = useState<any>(null);

  // Revenue trend chart state
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const [trendData, setTrendData] = useState<TrendDayItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  // Primary data fetch: dashboard metrics + recent orders
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const perms = await fetchAdminPermissions().catch(() => null);
        if (!active) return;
        if (perms && !perms.isSuperAdmin && perms.permissions?.dashboard === "none") {
          const firstRoute = getFirstAllowedRoute(perms);
          if (firstRoute && firstRoute !== "/admin") {
            router.replace(firstRoute);
            return;
          }
          setLoading(false);
          return;
        }

        const [metricsRes, ordersRes] = await Promise.all([
          api.get("/admin/dashboard"),
          api.get("/admin/orders?page=1&limit=5"),
        ]);
        if (!active) return;
        setMetrics(metricsRes.data.data);
        setRecentOrders(ordersRes.data.data.items || []);
      } catch (err: any) {
        if (active) {
          setError(err.response?.data?.message || "Failed to load dashboard");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => {
      active = false;
    };
  }, [router]);

  // Action strip & reconciliation data fetch (fails silently)
  useEffect(() => {
    const fetchActionStripData = async () => {
      // 1. Webhook reconciliation
      try {
        const reconRes = await api.get("/admin/payment-reconciliation", { params: { limit: 1 } });
        if (reconRes.data?.success) {
          const summary = reconRes.data.data?.summary;
          setReconSummary(summary);
          const failed = summary?.failedRazorpayWebhooks ?? summary?.unresolvedTotal ?? 0;
          setFailedWebhooksCount(typeof failed === "number" ? failed : 0);
        }
      } catch {
        // Fail silent: hide webhook chip if error
        setFailedWebhooksCount(null);
      }

      // 2. Notification delivery failures
      try {
        const notifRes = await api.get("/admin/notifications", { params: { status: "FAILED", limit: 1 } });
        if (notifRes.data?.success) {
          const total = notifRes.data.data?.pagination?.total ?? 0;
          setFailedEmailsCount(typeof total === "number" ? total : 0);
        }
      } catch {
        // Fail silent: hide emails chip if error
        setFailedEmailsCount(null);
      }
    };

    fetchActionStripData();
  }, []);

  // Revenue trend data fetch
  const fetchTrend = useCallback(async (days: 7 | 30) => {
    setTrendLoading(true);
    try {
      const res = await api.get("/admin/dashboard/trend", { params: { days } });
      if (res.data?.success && Array.isArray(res.data.data?.items)) {
        setTrendData(res.data.data.items);
      }
    } catch {
      // Keep empty or existing trend on error
    } finally {
      setTrendLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrend(trendDays);
  }, [trendDays, fetchTrend]);

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "PAID": return "bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold";
      case "FAILED": return "bg-red-50 text-red-700 border border-red-300 font-bold";
      default: return "bg-neutral-100 text-neutral-800 border border-neutral-300 font-medium";
    }
  };

  const formatServiceTime = (isoString?: string | null) => {
    if (!isoString) return "never";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "never";
    return d.toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 sm:gap-10 animate-pulse">
        {/* Loading skeleton */}
        <div className="h-16 bg-surface-container-low rounded-xl" />
        <div className="h-12 bg-surface-container-low rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface-container-low rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-surface-container-low rounded-xl" />
          <div className="h-64 bg-surface-container-low rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 p-6 bg-surface border border-outline-variant rounded-xl text-center">
        <span className="material-symbols-outlined text-error text-[48px]">error_outline</span>
        <p className="font-body-md text-body-md text-error max-w-md">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-6 py-2.5 bg-primary text-on-primary font-label-caps text-label-caps rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8 bg-surface border border-outline-variant rounded-xl text-center max-w-lg mx-auto">
        <span className="material-symbols-outlined text-neutral-500 text-[48px]">shield</span>
        <h2 className="font-bold text-lg text-on-surface">No Dashboard Access</h2>
        <p className="font-body-sm text-neutral-600">
          Your staff account does not have access to view dashboard metrics. Please select an allowed module from the navigation sidebar or contact your store owner.
        </p>
      </div>
    );
  }

  const orderTotal = metrics.totalOrders || 1;
  const completedPct = Math.round((metrics.deliveredOrders / orderTotal) * 100);
  const pendingPct = Math.round((metrics.pendingOrders / orderTotal) * 100);
  const cancelledPct = Math.round((metrics.cancelledOrders / orderTotal) * 100);

  // Compute Action Strip chips using authoritative helper
  const chips = computeActionChips({
    failedWebhooks: failedWebhooksCount,
    failedPayments: metrics.failedPayments,
    failedEmails: failedEmailsCount,
    lowStockProducts: metrics.lowStockProducts,
  });

  // Payment health counts derived from reconciliation summary or dashboard metrics
  const unresolvedTotal = reconSummary?.unresolvedTotal ?? 0;
  const paymentHealthState = getPaymentHealthWidgetState(unresolvedTotal);
  const webhooksProcessed = reconSummary?.webhooks?.processed ?? metrics.paymentHealth?.webhooks?.processed ?? 0;
  const webhooksFailed = reconSummary?.webhooks?.failed ?? reconSummary?.failedRazorpayWebhooks ?? metrics.paymentHealth?.webhooks?.failed ?? 0;
  const attemptsCaptured = reconSummary?.attempts?.captured ?? metrics.paymentHealth?.attempts?.captured ?? 0;
  const attemptsPending = reconSummary?.attempts?.pending ?? metrics.paymentHealth?.attempts?.pending ?? 0;
  const attemptsFailed = reconSummary?.attempts?.failed ?? metrics.paymentHealth?.attempts?.failed ?? 0;

  // Trend chart metrics
  const maxTrendRevenue = Math.max(1, ...trendData.map(t => t.revenue));
  const periodTotalRevenue = trendData.reduce((acc, t) => acc + t.revenue, 0);
  const periodTotalOrders = trendData.reduce((acc, t) => acc + t.orders, 0);

  return (
    <div className="flex flex-col gap-6 sm:gap-8 lg:gap-10">
      {/* 6. Honest Test-Data Banner */}
      {metrics.isTestData && (
        <section aria-label="Test data notice" className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 rounded-xl text-xs sm:text-sm font-medium">
          <span className="material-symbols-outlined text-[20px] text-amber-600 shrink-0">science</span>
          <div className="flex-1">
            <span className="font-bold">Test data environment:</span> Payment gateway is running in test mode — no live customer transactions yet.
          </div>
        </section>
      )}

      {/* Header & Quick Actions Row */}
      <section className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 sm:gap-6 border-b border-outline-variant/20 pb-5">
        <div className="flex flex-col gap-1 sm:gap-2">
          <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface uppercase tracking-tight">
            {greeting}
          </h1>
          <p className="font-body-sm text-xs sm:text-sm text-on-surface-variant flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">calendar_today</span>
            {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        {/* Quick Actions (min 44px tap targets on touch) */}
        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
          <Link
            href="/admin/products/new"
            className="min-h-[44px] px-3.5 py-2 bg-neutral-900 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-neutral-800 transition-all flex items-center gap-1.5 shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">add_box</span> Add Product
          </Link>
          <Link
            href="/admin/bulk-orders"
            className="min-h-[44px] px-3.5 py-2 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">view_in_ar</span> B2B Quotes
          </Link>
          <Link
            href="/admin/custom-orders"
            className="min-h-[44px] px-3.5 py-2 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">palette</span> Custom Proofs
          </Link>
          <Link
            href="/admin/invoices"
            className="min-h-[44px] px-3.5 py-2 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">receipt_long</span> Invoices
          </Link>
          <Link
            href="/admin/system-health"
            className="min-h-[44px] px-3.5 py-2 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">monitor_heart</span> Health
          </Link>
        </div>
      </section>

      {/* 1. "Action Needed" Strip — Top of Dashboard, Above KPI Cards */}
      <section aria-label="Action items strip" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider font-bold text-[11px]">
            Action Needed
          </span>
          {chips.length > 0 && (
            <span className="text-[11px] font-mono font-medium text-on-surface-variant">
              {chips.length} item{chips.length === 1 ? "" : "s"} require attention
            </span>
          )}
        </div>

        {/* Horizontal scrollable row on mobile (<640px), wrapping on desktop */}
        <div className="flex items-center gap-2.5 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none sm:flex-wrap sm:overflow-visible">
          {chips.length === 0 ? (
            <div className="min-h-[44px] px-4 py-2.5 bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-xl inline-flex items-center gap-2 text-xs font-mono font-bold uppercase shrink-0 shadow-2xs">
              <span className="material-symbols-outlined text-[18px] text-emerald-700">check_circle</span>
              <span>All caught up — no urgent actions needed</span>
            </div>
          ) : (
            chips.map((chip) => {
              const isRed = chip.severity === "red";
              return (
                <Link
                  key={chip.id}
                  href={chip.href}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl inline-flex items-center gap-2 text-xs font-mono font-bold uppercase transition-all shadow-2xs shrink-0 border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    isRed
                      ? "bg-red-50 hover:bg-red-100/90 text-red-800 border-red-300"
                      : "bg-amber-50 hover:bg-amber-100/90 text-amber-900 border-amber-300"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      isRed ? "text-red-600" : "text-amber-600"
                    }`}
                  >
                    {chip.icon}
                  </span>
                  <span>{chip.label}</span>
                  <span className="material-symbols-outlined text-[14px] opacity-70">arrow_forward</span>
                </Link>
              );
            })
          )}
        </div>
      </section>

      {/* 2 & 5. Operations & Health Bento: Payment Health Widget & Real System Services */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* 2. Payment Health Widget */}
        <div className={`bg-surface border rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5 transition-all ${
          unresolvedTotal > 0
            ? "border-amber-300/80 shadow-xs"
            : "border-outline-variant"
        }`}>
          <div className="flex justify-between items-start gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">account_balance</span>
                <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface">Payment Reconciliation Health</h3>
              </div>
              <p className="font-body-sm text-xs text-on-surface-variant mt-1">
                Gateway webhook delivery and payment attempt states
              </p>
            </div>
            {paymentHealthState.isHealthy ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1 shrink-0">
                <span className="material-symbols-outlined text-[14px] text-emerald-700">check</span> {paymentHealthState.statusText}
              </span>
            ) : (
              <span className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold uppercase ${paymentHealthState.badgeClass} shrink-0`}>
                {paymentHealthState.statusText}
              </span>
            )}
          </div>

          {/* Counts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 text-xs">
            <div className="bg-surface-container-low p-3 rounded-lg border border-outline-variant/50 flex flex-col">
              <span className="font-label-caps text-neutral-600 text-[10px] uppercase font-bold">Webhooks</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-emerald-700 font-mono font-bold text-base">{webhooksProcessed}</span>
                <span className="text-[10px] text-neutral-500 font-medium">proc</span>
                <span className="text-neutral-400">/</span>
                <span className={`font-mono font-bold text-base ${webhooksFailed > 0 ? "text-red-600" : "text-neutral-700"}`}>
                  {webhooksFailed}
                </span>
                <span className="text-[10px] text-neutral-500 font-medium">fail</span>
              </div>
            </div>

            <div className="bg-surface-container-low p-3 rounded-lg border border-outline-variant/50 flex flex-col">
              <span className="font-label-caps text-neutral-600 text-[10px] uppercase font-bold">Attempts: Captured</span>
              <span className="mt-1 text-emerald-700 font-mono font-bold text-base">{attemptsCaptured}</span>
            </div>

            <div className="bg-surface-container-low p-3 rounded-lg border border-outline-variant/50 flex flex-col col-span-2 sm:col-span-1">
              <span className="font-label-caps text-neutral-600 text-[10px] uppercase font-bold">Attempts: Pend / Fail</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-amber-700 font-mono font-bold text-base">{attemptsPending}</span>
                <span className="text-[10px] text-neutral-500 font-medium">pend</span>
                <span className="text-neutral-400">/</span>
                <span className={`font-mono font-bold text-base ${attemptsFailed > 0 ? "text-red-600" : "text-neutral-700"}`}>
                  {attemptsFailed}
                </span>
                <span className="text-[10px] text-neutral-500 font-medium">fail</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-outline-variant/30 flex justify-between items-center">
            <span className="text-xs font-mono text-on-surface-variant">
              {unresolvedTotal > 0 ? "Manual action needed on pending events" : "No lingering payment incidents"}
            </span>
            <Link
              href="/admin/payment-reconciliation"
              className="min-h-[44px] px-3 py-2 text-xs font-mono font-bold text-primary hover:underline inline-flex items-center gap-1"
            >
              Open reconciliation →
            </Link>
          </div>
        </div>

        {/* 5. Real System Health ("Services" Card) */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="flex justify-between items-start gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">dns</span>
                <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface">System Services (Live Status)</h3>
              </div>
              <p className="font-body-sm text-xs text-on-surface-variant mt-1">
                Real operational state, delivery history &amp; scheduler
              </p>
            </div>
            <Link
              href="/admin/system-health"
              className="min-h-[44px] px-2 py-2 text-xs font-mono font-bold text-primary hover:underline inline-flex items-center gap-1 shrink-0"
            >
              Open System Health →
            </Link>
          </div>

          {/* Compact Services List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Database */}
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="font-label-caps font-bold text-on-surface-variant text-[10px]">DATABASE</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  metrics.services?.database?.connected
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}>
                  {metrics.services?.database?.connected ? "CONNECTED" : "DISCONNECTED"}
                </span>
              </div>
              <span className="text-[11px] text-on-surface-variant truncate">MongoDB core replica</span>
            </div>

            {/* Razorpay */}
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="font-label-caps font-bold text-on-surface-variant text-[10px]">RAZORPAY GATEWAY</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  metrics.services?.razorpay?.configured
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  {metrics.services?.razorpay?.configured ? "CONFIGURED" : "MISSING KEY"}
                </span>
              </div>
              <span className="text-[11px] text-on-surface-variant truncate">
                Last webhook: {formatServiceTime(metrics.services?.razorpay?.lastWebhookAt)}
              </span>
            </div>

            {/* Email (Brevo) */}
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="font-label-caps font-bold text-on-surface-variant text-[10px]">
                  EMAIL ({metrics.services?.email?.provider || "BREVO"})
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  metrics.services?.email?.recentFailures
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : metrics.services?.email?.configured
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  {metrics.services?.email?.recentFailures
                    ? "SENDS FAILING"
                    : metrics.services?.email?.configured ? "ACTIVE" : "UNCONFIGURED"}
                </span>
              </div>
              <span className="text-[11px] text-on-surface-variant truncate">
                Last sent: {formatServiceTime(metrics.services?.email?.lastEmailSentAt)}
              </span>
            </div>

            {/* Recovery Scheduler */}
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="font-label-caps font-bold text-on-surface-variant text-[10px]">RECOVERY SCHEDULER</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  metrics.services?.recoveryScheduler?.running
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-neutral-100 text-neutral-600 border border-neutral-300"
                }`}>
                  {metrics.services?.recoveryScheduler?.running ? "RUNNING" : "NOT RUNNING"}
                </span>
              </div>
              <span className="text-[11px] text-on-surface-variant truncate">
                Last run: {formatServiceTime(metrics.services?.recoveryScheduler?.lastRunCompletedAt)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Primary KPI Row: 1 col on mobile (<640px), 2 cols on tablet (640-1023px), 4 cols on desktop (>=1024px) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {/* KPI Card 1: Revenue */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider font-semibold">Total Revenue</span>
            <span className="material-symbols-outlined text-emerald-800 bg-emerald-100 border border-emerald-200 p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
          </div>
          <div>
            <div className="font-price-lg text-[22px] sm:text-price-lg text-on-surface tracking-tight truncate">
              ₹{metrics.revenue.toLocaleString("en-IN")}
            </div>
            <div className="flex items-center gap-1 mt-2 text-emerald-800 font-body-sm text-body-sm font-medium">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span>From paid orders</span>
            </div>
          </div>
        </div>

        {/* KPI Card 2: Total Orders */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider font-semibold">Total Orders</span>
            <span className="material-symbols-outlined text-neutral-700 bg-neutral-100 border border-neutral-200 p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
          </div>
          <div>
            <div className="font-price-lg text-[22px] sm:text-price-lg text-on-surface tracking-tight truncate">
              {metrics.totalOrders.toLocaleString()}
            </div>
            <div className="flex items-center gap-1 mt-2 text-on-surface-variant font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px]">timeline</span>
              <span>All time</span>
            </div>
          </div>
        </div>

        {/* KPI Card 3: Pending Orders (Pending Orders 0 renders 'All caught up' with green check) */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider font-semibold">Pending Orders</span>
            <span className={`material-symbols-outlined p-1.5 rounded-md text-[18px] ${
              metrics.pendingOrders === 0
                ? "text-emerald-800 bg-emerald-100 border border-emerald-200"
                : "text-amber-800 bg-amber-100 border border-amber-200"
            }`} style={{ fontVariationSettings: "'FILL' 1" }}>
              {metrics.pendingOrders === 0 ? "check_circle" : "local_shipping"}
            </span>
          </div>
          <div>
            {metrics.pendingOrders === 0 ? (
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-2xl">check_circle</span>
                <span className="font-headline-sm text-lg sm:text-xl font-bold text-emerald-800">
                  All caught up
                </span>
              </div>
            ) : (
              <div className="font-price-lg text-[22px] sm:text-price-lg text-on-surface tracking-tight truncate">
                {metrics.pendingOrders}
              </div>
            )}
            <div className={`flex items-center gap-1 mt-2 font-body-sm text-body-sm ${
              metrics.pendingOrders === 0 ? "text-emerald-800 font-medium" : "text-amber-800 font-medium"
            }`}>
              <span className="material-symbols-outlined text-[16px]">
                {metrics.pendingOrders === 0 ? "done_all" : "schedule"}
              </span>
              <span>{metrics.pendingOrders === 0 ? "No pending orders" : "Needs attention"}</span>
            </div>
          </div>
        </div>

        {/* KPI Card 4: Low Stock */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider font-semibold">Low Stock Alerts</span>
            <span className={`material-symbols-outlined p-1.5 rounded-md text-[18px] ${
              metrics.lowStockProducts > 0
                ? "text-red-700 bg-red-100 border border-red-200"
                : "text-neutral-700 bg-neutral-100 border border-neutral-200"
            }`} style={{ fontVariationSettings: "'FILL' 1" }}>
              {metrics.lowStockProducts > 0 ? "warning" : "inventory_2"}
            </span>
          </div>
          <div>
            <div className={`font-price-lg text-[22px] sm:text-price-lg tracking-tight truncate ${
              metrics.lowStockProducts > 0 ? "text-red-600 font-bold" : "text-on-surface"
            }`}>
              {metrics.lowStockProducts}
            </div>
            <div className={`flex items-center gap-1 mt-2 font-body-sm text-body-sm ${
              metrics.lowStockProducts > 0 ? "text-red-600 font-medium" : "text-on-surface-variant"
            }`}>
              <span className="material-symbols-outlined text-[16px]">
                {metrics.lowStockProducts > 0 ? "warning" : "check"}
              </span>
              <span>{metrics.lowStockProducts > 0 ? "Variants < 5 units" : "All variants in stock"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Low Stock: from a number to a list */}
      <section className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant/30 pb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-error text-[20px]">inventory_2</span>
            <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface">Low Stock Inventory</h3>
            {metrics.lowStockProducts > 0 && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-error-container/40 text-error border border-error/20">
                {metrics.lowStockProducts} total
              </span>
            )}
          </div>
          <Link
            href="/admin/inventory"
            className="min-h-[44px] px-2 py-2 text-xs font-mono font-bold text-primary hover:underline inline-flex items-center gap-1 self-start sm:self-auto"
          >
            View all →
          </Link>
        </div>

        {/* List of at most 5 low stock products */}
        {(!metrics.lowStockList || metrics.lowStockList.length === 0) ? (
          <div className="py-6 text-center text-xs font-mono text-emerald-800 font-medium flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>All inventory stocked above reorder thresholds</span>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20">
            {limitLowStockItems(metrics.lowStockList).map((item) => (
              <div key={item.id + (item.variant || "")} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs sm:text-sm font-semibold text-on-surface truncate">{item.name}</span>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
                    {item.variant && <span>Variant: {item.variant}</span>}
                    {item.sku && <span>SKU: {item.sku}</span>}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-error-container/40 text-error border border-error/30">
                    {item.stock} unit{item.stock === 1 ? "" : "s"} left
                  </span>
                  <Link
                    href={`/admin/products/${encodeURIComponent(item.id)}/inventory`}
                    className="min-h-[44px] px-3 py-2 bg-surface border border-outline-variant hover:border-primary text-primary font-mono text-xs font-bold uppercase rounded-lg transition-colors inline-flex items-center gap-1"
                  >
                    <span>Restock</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Secondary KPIs Bento Grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="bg-surface border border-outline-variant rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Confirmed</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{metrics.confirmedOrders}</span>
        </div>
        <div className="bg-surface border border-outline-variant rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Processing</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{metrics.processingOrders}</span>
        </div>
        <div className="bg-surface border border-outline-variant rounded-lg p-4 flex items-center justify-between border-l-4 border-l-primary">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Shipped</span>
          <span className="font-headline-sm text-headline-sm text-primary">{metrics.shippedOrders}</span>
        </div>
        <div className="bg-surface border border-outline-variant rounded-lg p-4 flex items-center justify-between border-l-4 border-l-secondary">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Failed Payments</span>
          <span className="font-headline-sm text-headline-sm text-secondary">{metrics.failedPayments}</span>
        </div>
      </section>

      {/* 3. Revenue-over-time trend chart section */}
      <section className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">show_chart</span>
              <h3 className="font-headline-sm text-base sm:text-lg font-bold text-on-surface">Revenue Over Time</h3>
            </div>
            <p className="font-body-sm text-xs text-on-surface-variant mt-1">
              Real order revenue &amp; volume trend • Period total: ₹{periodTotalRevenue.toLocaleString("en-IN")} ({periodTotalOrders} orders)
            </p>
          </div>

          {/* 7 / 30 days toggle pills (min 44px tap target) */}
          <div className="inline-flex rounded-lg border border-outline-variant/60 p-0.5 bg-surface-container-low shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setTrendDays(7)}
              className={`min-h-[44px] px-3.5 py-2 rounded-md text-xs font-mono font-bold uppercase transition-colors cursor-pointer ${
                trendDays === 7
                  ? "bg-neutral-900 text-white shadow-xs"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setTrendDays(30)}
              className={`min-h-[44px] px-3.5 py-2 rounded-md text-xs font-mono font-bold uppercase transition-colors cursor-pointer ${
                trendDays === 30
                  ? "bg-neutral-900 text-white shadow-xs"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              30 Days
            </button>
          </div>
        </div>

        {/* Responsive CSS Bar Chart */}
        <div className="w-full flex flex-col gap-2">
          <div className="h-44 sm:h-52 w-full relative flex items-end justify-between gap-1 pt-6 border-b border-outline-variant pb-2">
            {trendLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/50">
                <span className="font-mono text-xs text-on-surface-variant animate-pulse">Loading trend data...</span>
              </div>
            ) : trendData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-mono text-xs text-on-surface-variant">No order data for selected period</span>
              </div>
            ) : (
              <div className="w-full flex justify-between items-end h-full gap-1 group">
                {trendData.map((item) => {
                  const barHeightPct = Math.max(item.revenue > 0 ? 8 : 2, Math.round((item.revenue / maxTrendRevenue) * 100));
                  return (
                    <div
                      key={item.date}
                      className="flex-1 flex flex-col items-center justify-end h-full relative group/bar min-w-0"
                    >
                      {/* Tooltip on hover */}
                      <div className="absolute bottom-full mb-1 hidden group-hover/bar:flex flex-col items-center z-20 pointer-events-none">
                        <div className="bg-neutral-900 text-white text-[10px] font-mono rounded px-2 py-1 shadow-lg whitespace-nowrap">
                          <p className="font-bold">{item.label}</p>
                          <p>₹{item.revenue.toLocaleString("en-IN")}</p>
                          <p>{item.orders} order{item.orders === 1 ? "" : "s"}</p>
                        </div>
                      </div>

                      {/* Bar visual */}
                      <div
                        className={`w-full rounded-t-sm transition-all duration-300 ${
                          item.revenue > 0
                            ? "bg-primary/80 hover:bg-primary group-hover/bar:bg-primary"
                            : "bg-surface-container-high hover:bg-outline-variant/60"
                        }`}
                        style={{ height: `${barHeightPct}%` }}
                        title={`${item.label}: ₹${item.revenue.toLocaleString("en-IN")} (${item.orders} orders)`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bar X-axis labels (readable at 360px) */}
          <div className="flex justify-between text-[10px] font-label-caps text-outline px-1">
            {trendDays === 7 ? (
              trendData.map((item) => (
                <span key={item.date} className="truncate max-w-[42px] text-center">
                  {item.weekday || item.label}
                </span>
              ))
            ) : (
              // On 30 days show sample labels across width so they don't overlap at 360px
              trendData.filter((_, idx) => idx % 5 === 0 || idx === trendData.length - 1).map((item) => (
                <span key={item.date} className="text-center">
                  {item.label}
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Existing Charts & Summaries Section (Status Bar Chart & Orders Donut) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Existing Order Status Bar Chart (CSS-based) */}
        <div className="lg:col-span-2 bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Order Status Overview</h3>
          </div>
          {/* CSS Bar Chart */}
          <div className="h-48 w-full relative flex items-end justify-between gap-2 pt-10 border-b border-outline-variant pb-2">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[10px] font-label-caps text-outline pb-2 w-8">
              <span>{Math.max(metrics.totalOrders, 1)}</span>
              <span>{Math.round(metrics.totalOrders * 0.75)}</span>
              <span>{Math.round(metrics.totalOrders * 0.5)}</span>
              <span>{Math.round(metrics.totalOrders * 0.25)}</span>
              <span>0</span>
            </div>
            {/* Grid lines */}
            <div className="absolute left-8 right-0 top-2 h-px bg-outline-variant/30"></div>
            <div className="absolute left-8 right-0 top-1/4 h-px bg-outline-variant/30"></div>
            <div className="absolute left-8 right-0 top-1/2 h-px bg-outline-variant/30"></div>
            <div className="absolute left-8 right-0 top-3/4 h-px bg-outline-variant/30"></div>
            {/* Bars */}
            <div className="ml-10 w-full flex justify-between items-end h-full px-2 gap-1 group">
              {[
                { label: "Pending", value: metrics.pendingOrders, color: "bg-secondary/40 hover:bg-secondary" },
                { label: "Confirmed", value: metrics.confirmedOrders, color: "bg-primary/30 hover:bg-primary/60" },
                { label: "Processing", value: metrics.processingOrders, color: "bg-primary/50 hover:bg-primary/80" },
                { label: "Shipped", value: metrics.shippedOrders, color: "bg-primary/70 hover:bg-primary" },
                { label: "Delivered", value: metrics.deliveredOrders, color: "bg-primary hover:bg-primary/80" },
                { label: "Cancelled", value: metrics.cancelledOrders, color: "bg-error/40 hover:bg-error" },
                { label: "Failed Pay", value: metrics.failedPayments, color: "bg-error-container hover:bg-error/30" },
              ].map((bar, i) => (
                <div
                  key={i}
                  className={`flex-1 ${bar.color} transition-colors rounded-t-sm relative`}
                  style={{ height: `${Math.max(4, (bar.value / Math.max(metrics.totalOrders, 1)) * 100)}%` }}
                  title={`${bar.label}: ${bar.value}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between px-10 text-[10px] font-label-caps text-outline">
            {["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "Failed"].map(l => (
              <span key={l}>{l.substring(0, 4)}</span>
            ))}
          </div>
        </div>

        {/* Existing Orders Donut Overview */}
        <div className="bg-surface border border-outline-variant rounded-xl p-5 sm:p-6 flex flex-col gap-6">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Orders Overview</h3>
          <div className="flex-1 flex flex-col justify-center gap-6">
            {/* CSS Donut Chart */}
            <div
              className="relative w-32 h-32 mx-auto rounded-full"
              style={{
                background: `conic-gradient(#004ac6 0% ${completedPct}%, #c3c6d7 ${completedPct}% ${completedPct + pendingPct}%, #aa3000 ${completedPct + pendingPct}% 100%)`,
              }}
            >
              <div className="absolute inset-2 bg-surface rounded-full flex items-center justify-center flex-col">
                <span className="font-price-lg text-[20px] text-on-surface">{metrics.totalOrders}</span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">Total</span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center font-body-sm text-body-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-on-surface">Delivered</span>
                </div>
                <span className="font-medium text-on-surface">{completedPct}%</span>
              </div>
              <div className="flex justify-between items-center font-body-sm text-body-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-outline-variant" />
                  <span className="text-on-surface">Pending</span>
                </div>
                <span className="font-medium text-on-surface">{pendingPct}%</span>
              </div>
              <div className="flex justify-between items-center font-body-sm text-body-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-secondary" />
                  <span className="text-on-surface">Cancelled</span>
                </div>
                <span className="font-medium text-on-surface">{cancelledPct}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Data Tables Grid (Bento) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders Table */}
        <div className="bg-surface border border-outline-variant rounded-xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Recent Orders</h3>
            <Link href="/admin/orders" className="min-h-[44px] px-2 py-2 font-label-caps text-label-caps text-primary hover:underline flex items-center gap-1">
              View All <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>
          {/* Mobile Orders Card List (shown on screens < 640px) */}
          <div className="block sm:hidden divide-y divide-outline-variant/20 p-3 space-y-2.5">
            {recentOrders.length === 0 ? (
              <p className="py-6 text-center text-xs text-on-surface-variant font-mono">No recent orders</p>
            ) : (
              recentOrders.map((order) => (
                <Link
                  key={order._id}
                  href={`/admin/orders/${order._id}`}
                  className="block p-3.5 rounded-lg bg-surface-container-low/40 hover:bg-surface-container-low transition-colors space-y-1.5 border border-outline-variant/20"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-primary">#{order.orderNumber}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getPaymentBadge(order.paymentStatus)}`}>
                      {order.paymentStatus}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-on-surface font-medium truncate max-w-[160px]">{order.userId?.name || "Customer"}</span>
                    <span className="font-mono font-bold text-neutral-900">₹{order.total?.toLocaleString("en-IN")}</span>
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* Desktop Table (hidden on mobile, shown on sm+) */}
          <div className="hidden sm:block overflow-x-auto p-4 sm:p-5">
            <table className="w-full text-left border-collapse min-w-[360px]">
              <thead>
                <tr>
                  <th className="font-label-caps text-label-caps text-on-surface-variant pb-3 border-b border-outline-variant/50 font-medium">Order ID</th>
                  <th className="font-label-caps text-label-caps text-on-surface-variant pb-3 border-b border-outline-variant/50 font-medium">Customer</th>
                  <th className="font-label-caps text-label-caps text-on-surface-variant pb-3 border-b border-outline-variant/50 font-medium text-right">Amount</th>
                  <th className="font-label-caps text-label-caps text-on-surface-variant pb-3 border-b border-outline-variant/50 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm">
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-on-surface-variant font-body-sm">
                      No recent orders
                    </td>
                  </tr>
                ) : recentOrders.map((order) => (
                  <tr key={order._id} className="hover:bg-surface-container-lowest transition-colors border-b border-outline-variant/30 last:border-0 cursor-pointer" onClick={() => router.push(`/admin/orders/${order._id}`)}>
                    <td className="py-3 text-on-surface font-medium font-label-caps text-label-caps">{order.orderNumber}</td>
                    <td className="py-3 text-on-surface-variant truncate max-w-[120px]">{order.userId?.name || "—"}</td>
                    <td className="py-3 text-on-surface text-right font-medium font-label-caps">₹{order.total?.toLocaleString("en-IN")}</td>
                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded font-label-caps text-[10px] ${getPaymentBadge(order.paymentStatus)}`}>
                        {order.paymentStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Existing Order Status Breakdown Table */}
        <div className="bg-surface border border-outline-variant rounded-xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Status Breakdown</h3>
            <Link href="/admin/orders" className="min-h-[44px] px-2 py-2 font-label-caps text-label-caps text-primary hover:underline flex items-center gap-1">
              Manage <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>
          <div className="p-5 flex flex-col gap-3">
            {[
              { label: "Delivered", value: metrics.deliveredOrders, color: "bg-primary", pct: completedPct },
              { label: "Shipped", value: metrics.shippedOrders, color: "bg-primary/50", pct: Math.round((metrics.shippedOrders / orderTotal) * 100) },
              { label: "Processing", value: metrics.processingOrders, color: "bg-outline-variant", pct: Math.round((metrics.processingOrders / orderTotal) * 100) },
              { label: "Pending", value: metrics.pendingOrders, color: "bg-secondary/50", pct: pendingPct },
              { label: "Cancelled", value: metrics.cancelledOrders, color: "bg-secondary", pct: cancelledPct },
            ].map(item => (
              <div key={item.label} className="flex flex-col gap-1">
                <div className="flex justify-between items-center font-body-sm text-body-sm">
                  <span className="text-on-surface">{item.label}</span>
                  <span className="font-medium text-on-surface">{item.value} <span className="text-outline text-[10px] font-label-caps">({item.pct}%)</span></span>
                </div>
                <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                  <div className={`${item.color} h-full rounded-full transition-all duration-500`} style={{ width: `${Math.max(item.pct, 2)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
