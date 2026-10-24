"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Link from "next/link";

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

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [greeting, setGreeting] = useState("Good morning");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [metricsRes, ordersRes] = await Promise.all([
          api.get("/admin/dashboard"),
          api.get("/admin/orders?page=1&limit=5"),
        ]);
        setMetrics(metricsRes.data.data);
        setRecentOrders(ordersRes.data.data.items || []);
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "PAID": return "bg-[#eef0ff] text-[#003ea8] border border-[#b4c5ff]";
      case "FAILED": return "bg-error-container/40 text-error border border-error/20";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-10 animate-pulse">
        {/* Loading skeleton */}
        <div className="h-20 bg-surface-container-low rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface-container-low rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-surface-container-low rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <span className="material-symbols-outlined text-error text-[48px]">error_outline</span>
        <p className="font-body-md text-body-md text-error">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-on-primary font-label-caps text-label-caps rounded-lg hover:opacity-90 transition-opacity"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!metrics) return null;

  const orderTotal = metrics.totalOrders || 1;
  const completedPct = Math.round((metrics.deliveredOrders / orderTotal) * 100);
  const pendingPct = Math.round((metrics.pendingOrders / orderTotal) * 100);
  const cancelledPct = Math.round((metrics.cancelledOrders / orderTotal) * 100);

  return (
    <div className="flex flex-col gap-10">
      {/* Header & Quick Actions Row */}
      <section className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{greeting}</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">calendar_today</span>
            {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2.5">
          <Link
            href="/admin/products/new"
            className="px-3.5 py-1.5 bg-neutral-900 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-neutral-800 transition-all flex items-center gap-1.5 shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">add_box</span> Add Product
          </Link>
          <Link
            href="/admin/bulk-orders"
            className="px-3.5 py-1.5 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">view_in_ar</span> B2B Quotes
          </Link>
          <Link
            href="/admin/custom-orders"
            className="px-3.5 py-1.5 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">palette</span> Custom Proofs
          </Link>
          <Link
            href="/admin/invoices"
            className="px-3.5 py-1.5 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">receipt_long</span> Invoices
          </Link>
          <Link
            href="/admin/system-health"
            className="px-3.5 py-1.5 bg-surface border border-outline-variant hover:border-primary text-on-surface font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">monitor_heart</span> Health
          </Link>
        </div>
      </section>

      {/* Primary KPI Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* KPI Card 1: Revenue */}
        <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Total Revenue</span>
            <span className="material-symbols-outlined text-primary bg-primary-container p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
          </div>
          <div>
            <div className="font-price-lg text-price-lg text-on-surface tracking-tight">₹{metrics.revenue.toLocaleString("en-IN")}</div>
            <div className="flex items-center gap-1 mt-2 text-primary font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span>From paid orders</span>
            </div>
          </div>
        </div>

        {/* KPI Card 2: Total Orders */}
        <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Total Orders</span>
            <span className="material-symbols-outlined text-on-surface-variant bg-surface-container-high p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
          </div>
          <div>
            <div className="font-price-lg text-price-lg text-on-surface tracking-tight">{metrics.totalOrders.toLocaleString()}</div>
            <div className="flex items-center gap-1 mt-2 text-on-surface-variant font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px]">timeline</span>
              <span>All time</span>
            </div>
          </div>
        </div>

        {/* KPI Card 3: Pending Orders */}
        <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Pending Orders</span>
            <span className="material-symbols-outlined text-on-secondary bg-secondary-container p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_shipping</span>
          </div>
          <div>
            <div className="font-price-lg text-price-lg text-on-surface tracking-tight">{metrics.pendingOrders}</div>
            <div className="flex items-center gap-1 mt-2 text-secondary font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              <span>Needs attention</span>
            </div>
          </div>
        </div>

        {/* KPI Card 4: Low Stock */}
        <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
          <div className="flex justify-between items-start">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Low Stock Alerts</span>
            <span className="material-symbols-outlined text-error bg-error-container p-1.5 rounded-md text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
          </div>
          <div>
            <div className="font-price-lg text-price-lg text-error tracking-tight">{metrics.lowStockProducts}</div>
            <div className="flex items-center gap-1 mt-2 text-error font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              <span>Variants &lt; 5 units</span>
            </div>
          </div>
        </div>
      </section>

      {/* Secondary KPIs Bento Grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

      {/* Charts & Summaries Section */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Bar Chart (CSS-based) */}
        <div className="lg:col-span-2 bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-6">
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

        {/* Orders Donut Overview */}
        <div className="bg-surface border border-outline-variant rounded-xl p-6 flex flex-col gap-6">
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
            <Link href="/admin/orders" className="font-label-caps text-label-caps text-primary hover:underline flex items-center gap-1">
              View All <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="w-full text-left border-collapse min-w-[400px]">
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
                  <tr key={order._id} className="hover:bg-surface-container-lowest transition-colors border-b border-outline-variant/30 last:border-0">
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

        {/* Order Status Breakdown Table */}
        <div className="bg-surface border border-outline-variant rounded-xl flex flex-col overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Status Breakdown</h3>
            <Link href="/admin/orders" className="font-label-caps text-label-caps text-primary hover:underline flex items-center gap-1">
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
