"use client";

import { useOrderStore, type Order } from "@/store/useOrderStore";
import { useAuthStore } from "@/store/useAuthStore";
import { SignInRequiredState } from "@/components/auth/SignInRequiredState";
import { getOrderStatusBadges, ORDER_STATUS_TONE_CLASSES, type OrderDisplayStatusKey } from "@/lib/orderStatus";
import { SITE_CONFIG } from "@/lib/seo";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import {
  Package,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  PackageCheck,
  PackageMinus,
  RotateCcw,
  Undo2,
  Banknote,
  AlertCircle,
  Search,
  X,
  MapPin,
  Heart,
  Star,
  LayoutDashboard,
  Loader2,
  ArrowRight,
  Sparkles,
} from "lucide-react";

const ACCOUNT_TABS = [
  { label: "Overview", href: "/account", icon: LayoutDashboard },
  { label: "Orders", href: "/account/orders", icon: Package, active: true },
  { label: "Addresses", href: "/account/addresses", icon: MapPin },
  { label: "Wishlist", href: "/account/wishlist", icon: Heart },
  { label: "Reviews", href: "/account/reviews", icon: Star },
];

const INITIAL_VISIBLE_COUNT = 5;
const LAZY_LOAD_BATCH_SIZE = 5;

type OrderStatusFilter = "ALL" | OrderDisplayStatusKey;

const ORDER_STATUS_FILTERS: { key: OrderStatusFilter; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "DELIVERED", label: "DELIVERED" },
  { key: "SHIPPED", label: "IN TRANSIT" },
  { key: "PROCESSING", label: "PROCESSING" },
  { key: "CONFIRMED", label: "CONFIRMED" },
  { key: "PENDING", label: "PENDING" },
  { key: "PARTIALLY_CANCELLED", label: "PARTIALLY CANCELLED" },
  { key: "RETURN_REQUESTED", label: "RETURN IN PROGRESS" },
  { key: "RETURNED", label: "RETURNED" },
  { key: "REFUNDED", label: "REFUNDED" },
  { key: "CANCELLED", label: "CANCELLED" },
  { key: "PAYMENT_FAILED", label: "PAYMENT FAILED" },
  { key: "EXPIRED", label: "EXPIRED" },
];

export function OrdersClient() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { orders, fetchOrders, isLoading } = useOrderStore();

  // Filter & Search State
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination & Lazy Load State
  const [isInfiniteMode, setIsInfiniteMode] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Sentinel ref for Intersection Observer
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Initial Fetch
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchOrders();
    }
  }, [authLoading, isAuthenticated, fetchOrders]);

  // Filtered Orders Computation
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter — match the primary status or any supplementary badge
      if (
        statusFilter !== "ALL" &&
        !getOrderStatusBadges(order).some((badge) => badge.key === statusFilter)
      ) {
        return false;
      }

      // Search query filter (Order number or item name)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesNumber = order.orderNumber.toLowerCase().includes(query);
        const matchesItem = order.items.some((item) =>
          item.productName.toLowerCase().includes(query)
        );
        return matchesNumber || matchesItem;
      }

      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  // Status Counts for Chips
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: orders.length };
    for (const order of orders) {
      for (const badge of getOrderStatusBadges(order)) {
        // Partial-return is descriptive only; the RETURNED filter covers it.
        if (badge.key === "PARTIAL_RETURN") continue;
        counts[badge.key] = (counts[badge.key] || 0) + 1;
      }
    }
    return counts;
  }, [orders]);

  // Slice visible orders
  const visibleOrders = useMemo(() => {
    if (!isInfiniteMode) {
      return filteredOrders.slice(0, INITIAL_VISIBLE_COUNT);
    }
    return filteredOrders.slice(0, visibleCount);
  }, [filteredOrders, isInfiniteMode, visibleCount]);

  const hasMoreOrders = isInfiniteMode && visibleCount < filteredOrders.length;
  const canExpandToAll = !isInfiniteMode && filteredOrders.length > INITIAL_VISIBLE_COUNT;

  // Handle "View All Orders" Click
  const handleViewAllClick = () => {
    setIsInfiniteMode(true);
    setVisibleCount(Math.min(INITIAL_VISIBLE_COUNT + LAZY_LOAD_BATCH_SIZE, filteredOrders.length));
  };

  // Handle "Collapse to Recent 5" Click
  const handleCollapseClick = () => {
    setIsInfiniteMode(false);
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    window.scrollTo({ top: 120, behavior: "smooth" });
  };

  // Intersection Observer for Infinite Scrolling Lazy Loading
  const loadNextBatch = useCallback(() => {
    if (isLoadingMore || !hasMoreOrders) return;

    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + LAZY_LOAD_BATCH_SIZE, filteredOrders.length));
      setIsLoadingMore(false);
    }, 450);
  }, [isLoadingMore, hasMoreOrders, filteredOrders.length]);

  useEffect(() => {
    if (!isInfiniteMode || !hasMoreOrders) return;

    const currentSentinel = sentinelRef.current;
    if (!currentSentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
          loadNextBatch();
        }
      },
      {
        root: null,
        rootMargin: "200px",
        threshold: 0.1,
      }
    );

    observer.observe(currentSentinel);

    return () => {
      observer.disconnect();
    };
  }, [isInfiniteMode, hasMoreOrders, loadNextBatch]);

  // Status icon mapping for the derived status badges
  const getStatusIcon = (key: string) => {
    switch (key) {
      case "DELIVERED":
        return CheckCircle2;
      case "SHIPPED":
        return Truck;
      case "PROCESSING":
      case "PENDING":
      case "EXPIRED":
        return Clock;
      case "CONFIRMED":
        return PackageCheck;
      case "CANCELLED":
        return XCircle;
      case "PARTIALLY_CANCELLED":
        return PackageMinus;
      case "RETURN_REQUESTED":
        return Undo2;
      case "RETURNED":
        return RotateCcw;
      case "REFUNDED":
        return Banknote;
      case "PAYMENT_FAILED":
        return AlertCircle;
      default:
        return Package;
    }
  };

  // Customer-friendly fulfilment information
  const getFulfilmentInfo = (order: Order, primaryStatusKey: string) => {
    if (order.status === "DELIVERED" || primaryStatusKey === "DELIVERED") {
      return {
        label: "Delivered",
        description: "Delivered via Express Courier Partner",
        isShipped: true,
      };
    }
    if (order.status === "SHIPPED" || primaryStatusKey === "SHIPPED") {
      return {
        label: "In Transit",
        description: order.shipment?.carrier
          ? `In Transit · ${order.shipment.carrier}`
          : "In Transit · Handed over to courier partner",
        isShipped: true,
      };
    }
    if (primaryStatusKey === "RETURNED") {
      return {
        label: "Returned",
        description: "Return completed · Refund is credited to original payment method",
        isShipped: true,
      };
    }
    if (primaryStatusKey === "RETURN_REQUESTED") {
      return {
        label: "Return in progress",
        description: "Return in progress · Pickup and inspection updates available in order details",
        isShipped: true,
      };
    }
    if (primaryStatusKey === "REFUNDED" || order.paymentStatus === "REFUNDED") {
      return {
        label: "Refunded",
        description: "Refund processed to original payment method",
        isShipped: false,
      };
    }
    if (order.status === "CONFIRMED") {
      return {
        label: "Packed & ready to ship",
        description: "Packed & ready to ship",
        pendingNote: "Tracking will appear here once your order ships",
        isShipped: false,
      };
    }
    if (order.status === "PROCESSING") {
      return {
        label: "In preparation",
        description: "In preparation & quality inspection",
        pendingNote: "Tracking will appear here once your order ships",
        isShipped: false,
      };
    }
    if (order.status === "CANCELLED") {
      const hasPending =
        (order.refunds ?? []).some((r: any) =>
          ["PENDING", "PROCESSING"].includes(String(r.status || "").toUpperCase())
        ) || order.paymentStatus === "PAID";

      if (hasPending) {
        return {
          label: "Refund in progress",
          description: "Refund in progress · Typically reflects within 5-7 business days",
          isShipped: false,
        };
      }
      return {
        label: "Cancelled",
        description: "Order cancelled · No further shipment will be dispatched",
        isShipped: false,
      };
    }
    if (order.paymentStatus === "FAILED") {
      return {
        label: "Payment failed",
        description: "Payment failed · Retry payment from order details",
        isShipped: false,
      };
    }
    if (order.status === "EXPIRED") {
      return {
        label: "Expired",
        description: "Payment window expired · Order was not confirmed",
        isShipped: false,
      };
    }

    return {
      label: "Packed & ready to ship",
      description: "Packed & ready to ship",
      pendingNote: "Tracking will appear here once your order ships",
      isShipped: false,
    };
  };

  if (authLoading) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-neutral-900 animate-spin mb-3" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInRequiredState context="orders" redirectPath="/account/orders" />;
  }

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col pb-8 sm:pb-12 lg:pb-8">
      {/* Account Navigation Tabs */}
      <div className="relative mb-6 sm:mb-8">
        <div className="overflow-x-auto hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 flex items-center gap-1.5 sm:gap-2 pb-1 border-b border-outline-variant/40">
          {ACCOUNT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider transition-all min-h-[40px] ${
                  isActive
                    ? "bg-neutral-950 text-white shadow-xs"
                    : "text-neutral-600 hover:text-neutral-950 hover:bg-surface-container-low"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {isActive && orders.length > 0 && (
                  <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                    {orders.length}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        {/* Subtle fade hint on mobile indicating scrollable row without word clipping */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-surface to-transparent sm:hidden" />
      </div>

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6 sm:mb-8 pb-6 border-b border-outline-variant/40">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface uppercase tracking-tight">
              ORDER HISTORY
            </h1>
            {!isLoading && orders.length > 0 && (
              <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                {orders.length} {orders.length === 1 ? "Order" : "Orders"}
              </span>
            )}
          </div>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
            See where your order is, download your GST invoice, and manage returns — all in one place.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar (Gated: only shown when store scale needs them: orders > 5) */}
      {orders.length > 5 && (
        <div className="mb-6 sm:mb-8 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Status Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1">
              {ORDER_STATUS_FILTERS.map(({ key: filterKey, label }) => {
                const count = statusCounts[filterKey] || 0;
                if (filterKey !== "ALL" && count === 0) return null;
                const isSelected = statusFilter === filterKey;
                return (
                  <button
                    key={filterKey}
                    onClick={() => {
                      setStatusFilter(filterKey);
                      setVisibleCount(INITIAL_VISIBLE_COUNT);
                    }}
                    className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shrink-0 ${
                      isSelected
                        ? "bg-neutral-900 text-white shadow-xs"
                        : "bg-surface-container-low text-neutral-600 hover:text-neutral-900 hover:bg-surface-container"
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isSelected ? "bg-white/20 text-white" : "bg-neutral-200 text-neutral-700"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[240px] sm:w-72">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleCount(INITIAL_VISIBLE_COUNT);
                }}
                placeholder="Search order # or item name..."
                className="w-full pl-9 pr-8 py-2 bg-surface-container-low border border-outline-variant/60 rounded-lg text-xs font-mono text-on-surface placeholder:text-neutral-400 focus:outline-none focus:border-brand focus:bg-white transition-colors"
              />
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-700 p-0.5"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Clean Order View Count */}
          <div className="flex items-center justify-between text-xs font-mono text-neutral-500 pt-1">
            <div>
              <span>
                Showing {Math.min(visibleOrders.length, filteredOrders.length)} of {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"}
              </span>
            </div>

            {isInfiniteMode && (
              <button
                onClick={handleCollapseClick}
                className="inline-flex items-center gap-1 text-neutral-700 hover:text-brand font-bold uppercase tracking-wider hover:underline"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show Recent 5</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content: Loading, Empty, or Order Cards */}
      {isLoading && orders.length === 0 ? (
        /* Skeleton Order Cards */
        <div className="space-y-5">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl overflow-hidden shadow-xs animate-pulse"
            >
              <div className="p-4 sm:p-5 bg-surface-container-low/60 border-b border-outline-variant/20 flex flex-col sm:flex-row justify-between gap-3">
                <div className="flex gap-3">
                  <div className="h-5 w-28 bg-surface-container-high rounded"></div>
                  <div className="h-5 w-20 bg-surface-container-high rounded"></div>
                  <div className="h-5 w-16 bg-surface-container-high rounded"></div>
                </div>
                <div className="h-6 w-24 bg-surface-container-high rounded-full"></div>
              </div>
              <div className="p-4 sm:p-5 flex gap-4">
                <div className="w-16 h-20 bg-surface-container-high rounded-lg"></div>
                <div className="space-y-2 flex-1">
                  <div className="h-5 w-1/2 bg-surface-container-high rounded"></div>
                  <div className="h-4 w-1/4 bg-surface-container-low rounded"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        /* Warm & Reassuring Empty State */
        <div className="text-center py-10 px-6 sm:px-10 bg-surface-container-lowest border border-outline-variant/50 rounded-2xl max-w-lg mx-auto shadow-xs space-y-5">
          <div className="w-24 h-28 mx-auto relative rounded-xl overflow-hidden bg-surface-container border border-outline-variant/40 shadow-inner">
            <Image
              src="https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=400&auto=format&fit=crop"
              alt="Tailored Apparel Collection"
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
          <div className="space-y-2">
            <h2 className="font-headline-sm text-xl font-bold text-on-surface uppercase tracking-tight">
              Your orders will appear here
            </h2>
            <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
              When you order tailored Nehru jackets or menswear from Samrat Fashion, your live delivery tracking, garments specs, and official GST invoices will be ready right here.
            </p>
          </div>
          <div className="p-4 bg-surface-container-low/80 rounded-xl border border-outline-variant/40 text-xs text-neutral-600 space-y-2 text-left font-mono">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              <p className="text-[11px] sm:text-xs leading-relaxed text-neutral-700">
                <strong className="text-neutral-950 font-bold">Just placed an order?</strong> Orders can take a few minutes to appear after payment while your bank verifies the transaction.
              </p>
            </div>
            <div className="pt-2 border-t border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-neutral-500">
              <span>Need help with an order?</span>
              <div className="flex items-center gap-3 text-neutral-900 font-bold">
                <a href={`mailto:${SITE_CONFIG.email}`} className="hover:text-brand transition-colors underline">
                  {SITE_CONFIG.email}
                </a>
                <span>·</span>
                <a href={`tel:${SITE_CONFIG.telephone}`} className="hover:text-brand transition-colors">
                  {SITE_CONFIG.telephone}
                </a>
              </div>
            </div>
          </div>
          <div className="pt-1">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-brand transition-all shadow-sm active:scale-98 min-h-[44px]"
            >
              <span>Explore Collection</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : filteredOrders.length === 0 ? (
        /* No Search Matches */
        <div className="text-center py-12 px-6 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl max-w-md mx-auto shadow-xs space-y-3">
          <Search className="w-8 h-8 text-neutral-400 mx-auto mb-1 stroke-[1.5]" />
          <h3 className="font-headline-sm text-base font-bold text-on-surface uppercase tracking-tight">
            No Matching Orders Found
          </h3>
          <p className="font-body-md text-xs text-on-surface-variant">
            No orders match your filter criteria or search query.
          </p>
          <button
            onClick={() => {
              setStatusFilter("ALL");
              setSearchQuery("");
            }}
            className="px-4 py-2 bg-neutral-900 text-white font-mono text-xs font-bold uppercase rounded-lg hover:bg-brand transition-colors"
          >
            Clear Search &amp; Filters
          </button>
        </div>
      ) : (
        /* Orders List */
        <div className="space-y-6">
          {visibleOrders.map((order, index) => {
            const itemCount = order.items.reduce((acc, item) => acc + (item.quantity || 1), 0);
            const statusBadges = getOrderStatusBadges(order);
            const primaryStatus = statusBadges[0];
            const StatusIcon = getStatusIcon(primaryStatus.key);
            const fulfilmentInfo = getFulfilmentInfo(order, primaryStatus.key);

            return (
              <div
                key={order._id || index}
                className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl overflow-hidden shadow-xs hover:border-neutral-900 transition-all duration-200 streetwear-card"
              >
                {/* Order Summary Top Bar */}
                <div className="p-4 sm:p-5 bg-surface-container-low/70 border-b border-outline-variant/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                    <span className="font-bold text-neutral-950 text-sm tracking-tight">
                      #{order.orderNumber}
                    </span>
                    <span className="text-neutral-300">·</span>
                    <span className="text-neutral-600">
                      {new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span className="text-neutral-300">·</span>
                    <span className="font-bold text-neutral-950">
                      <span className="text-neutral-500 font-normal mr-1">Paid:</span>
                      ₹{order.total.toLocaleString("en-IN")}
                    </span>
                    <span className="text-neutral-500 text-[11px]">
                      ({itemCount} {itemCount === 1 ? "item" : "items"})
                    </span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-outline-variant/30">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {order.status === "CONFIRMED" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand border border-brand/20">
                          <PackageCheck className="w-3.5 h-3.5 shrink-0" />
                          <span>Packed &amp; ready to ship</span>
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider border ${ORDER_STATUS_TONE_CLASSES[primaryStatus.tone]}`}
                        >
                          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{primaryStatus.label}</span>
                        </span>
                      )}
                      {statusBadges.slice(1).map((badge) => (
                        <span
                          key={badge.key}
                          className={`inline-flex items-center px-2 py-1 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider border ${ORDER_STATUS_TONE_CLASSES[badge.tone]}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => router.push(`/account/orders/${order._id}`)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold hover:bg-brand transition-all shrink-0 min-h-[36px]"
                      aria-label={`View details for order ${order.orderNumber}`}
                    >
                      <span>Details &amp; Invoice</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Items Preview List */}
                <div className="p-4 sm:p-5 divide-y divide-outline-variant/20">
                  {order.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start sm:items-center gap-4 py-3.5 first:pt-0 last:pb-0"
                    >
                      {/* Product Thumbnail */}
                      <div className="w-16 h-20 sm:w-20 sm:h-24 bg-surface-container-high rounded-xl overflow-hidden relative shrink-0 border border-outline-variant/30">
                        <Image
                          src={item.productImage || "/placeholder.png"}
                          alt={item.productName}
                          fill
                          sizes="(max-width: 640px) 64px, 80px"
                          className="object-cover"
                        />
                      </div>

                      {/* Product Metadata — Wrap title naturally, never truncate */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                          <h4 className="font-headline-sm font-bold text-sm sm:text-base text-on-surface leading-snug break-words">
                            {item.productName}
                          </h4>
                          <div className="flex items-baseline gap-1.5 shrink-0 sm:pt-0.5">
                            <span className="font-mono text-xs sm:text-sm font-bold text-neutral-950">
                              ₹{item.lineTotal.toLocaleString("en-IN")}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs text-neutral-500 mt-2 flex-wrap">
                          {item.selectedSize && (
                            <span className="bg-surface-container-high px-2 py-0.5 rounded text-[11px] font-bold text-neutral-800">
                              Size: {item.selectedSize}
                            </span>
                          )}
                          {item.selectedColor && (
                            <span className="bg-surface-container-high px-2 py-0.5 rounded text-[11px] font-bold text-neutral-800">
                              Color: {item.selectedColor}
                            </span>
                          )}
                          <span className="text-neutral-400">·</span>
                          <span>
                            Qty: <strong className="text-on-surface">{item.quantity}</strong>
                          </span>
                        </div>

                        {item.isCustomized && (
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand/10 text-brand font-mono text-[10px] uppercase font-bold border border-brand/20">
                            <Sparkles className="w-3 h-3 text-brand" />
                            <span>Custom Graphic Print</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Price Breakdown: Reconciles Item Price with Total Paid */}
                <div className="px-4 sm:px-5 py-3 bg-surface-container-low/35 border-t border-outline-variant/20 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-x-6 gap-y-1.5 text-xs font-mono">
                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-x-4 gap-y-1.5 text-neutral-600">
                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-500">Item total:</span>
                      <span className="font-semibold text-neutral-800">
                        ₹{order.subtotal.toLocaleString("en-IN")}
                      </span>
                    </div>

                    {order.discount > 0 && (
                      <div className="flex items-center gap-1.5 text-brand font-medium">
                        <span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}:</span>
                        <span className="font-semibold">
                          -₹{order.discount.toLocaleString("en-IN")}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-500">Delivery:</span>
                      <span
                        className={
                          order.shipping === 0
                            ? "text-emerald-700 font-bold uppercase text-[11px]"
                            : "font-semibold text-neutral-800"
                        }
                      >
                        {order.shipping > 0 ? `₹${order.shipping.toLocaleString("en-IN")}` : "FREE"}
                      </span>
                    </div>

                    {order.tax > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-500">Taxes:</span>
                        <span className="font-semibold text-neutral-800">
                          ₹{order.tax.toLocaleString("en-IN")}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 pl-2 sm:border-l sm:border-outline-variant/40 font-bold text-neutral-950">
                      <span className="text-neutral-600">Total Paid:</span>
                      <span className="text-sm font-bold text-neutral-950">
                        ₹{order.total.toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer Logistics & Fulfilment State */}
                <div className="px-4 sm:px-5 py-3.5 bg-surface-container-low/50 border-t border-outline-variant/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs font-mono">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-neutral-900 font-semibold shrink-0">
                      <PackageCheck className="w-4 h-4 text-brand shrink-0" />
                      <span>{fulfilmentInfo.description}</span>
                    </div>
                    {fulfilmentInfo.pendingNote && !fulfilmentInfo.isShipped && (
                      <div className="flex items-center gap-2 text-neutral-500">
                        <span className="hidden sm:inline text-neutral-300">·</span>
                        <span className="text-[11px] sm:text-xs text-neutral-500 italic">
                          {fulfilmentInfo.pendingNote}
                        </span>
                      </div>
                    )}
                  </div>

                  <Link
                    href={`/account/orders/${order._id}#tracking`}
                    className="inline-flex items-center gap-1.5 text-neutral-900 hover:text-brand font-bold uppercase transition-colors hover:underline shrink-0 text-xs self-start sm:self-auto"
                  >
                    <span>Track your order</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}

          {/* VIEW ALL ORDERS BANNER (Visible only when orders > 5 and not in infinite mode) */}
          {canExpandToAll && orders.length > 5 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-6 sm:p-8 bg-surface-container-lowest border border-neutral-900 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-5 text-center sm:text-left"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <span className="font-headline-sm text-base sm:text-lg font-black text-on-surface uppercase tracking-tight">
                    Showing 5 of {filteredOrders.length} orders
                  </span>
                </div>
                <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-md">
                  Load your earlier orders to view complete order details and invoices.
                </p>
              </div>

              <button
                onClick={handleViewAllClick}
                className="w-full sm:w-auto px-6 py-3.5 bg-neutral-950 hover:bg-brand text-white font-mono text-xs uppercase tracking-wider font-bold rounded-xl transition-all shadow-sm active:scale-98 flex items-center justify-center gap-2 min-h-[44px] shrink-0"
              >
                <span>View All Orders ({filteredOrders.length})</span>
                <ChevronDown className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* INFINITE SCROLL SENTINEL & LAZY LOADING INDICATOR (Gated on orders.length > 5) */}
          {isInfiniteMode && orders.length > 5 && (
            <div ref={sentinelRef} className="pt-6 pb-4">
              {isLoadingMore ? (
                /* Lazy loading spinner card */
                <div className="p-6 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-xs flex items-center justify-center gap-3 text-neutral-700 animate-pulse">
                  <Loader2 className="w-5 h-5 animate-spin text-neutral-900" />
                  <span className="font-mono text-xs font-bold uppercase tracking-wider">
                    Loading more orders ({visibleOrders.length} of {filteredOrders.length})...
                  </span>
                </div>
              ) : hasMoreOrders ? (
                /* Sentinel in waiting state */
                <div className="text-center py-4">
                  <span className="font-mono text-xs text-neutral-400 uppercase tracking-widest">
                    Scroll down for more orders...
                  </span>
                </div>
              ) : (
                /* All orders loaded message */
                <div className="p-6 bg-surface-container-low/70 border border-outline-variant/30 rounded-2xl text-center space-y-2">
                  <div className="inline-flex items-center gap-1.5 text-emerald-700 font-mono text-xs font-bold uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>All {filteredOrders.length} Orders Loaded</span>
                  </div>
                  <p className="font-body-md text-xs text-on-surface-variant">
                    You have reached the end of your order history.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={handleCollapseClick}
                      className="px-4 py-2 border border-outline-variant/60 hover:bg-surface-container font-mono text-xs font-bold uppercase text-neutral-700 rounded-lg transition-colors inline-flex items-center gap-1.5"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Collapse to Recent 5</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
