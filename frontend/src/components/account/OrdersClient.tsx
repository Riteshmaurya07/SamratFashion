"use client";

import { useOrderStore } from "@/store/useOrderStore";
import { useAuthStore } from "@/store/useAuthStore";
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
  Search,
  X,
  MapPin,
  Heart,
  Star,
  FileText,
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
  { label: "Bulk Quotes", href: "/account/bulk-orders", icon: FileText },
];

const INITIAL_VISIBLE_COUNT = 5;
const LAZY_LOAD_BATCH_SIZE = 5;

type OrderStatusFilter = "ALL" | "DELIVERED" | "SHIPPED" | "PROCESSING" | "CONFIRMED" | "CANCELLED";

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

  // Auth Guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/account/orders");
    }
  }, [authLoading, isAuthenticated, router]);

  // Initial Fetch
  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders();
    }
  }, [isAuthenticated, fetchOrders]);

  // Filtered Orders Computation
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter
      if (statusFilter !== "ALL") {
        if (statusFilter === "SHIPPED" && order.status !== "SHIPPED") return false;
        if (statusFilter === "DELIVERED" && order.status !== "DELIVERED") return false;
        if (statusFilter === "PROCESSING" && order.status !== "PROCESSING") return false;
        if (statusFilter === "CONFIRMED" && order.status !== "CONFIRMED") return false;
        if (statusFilter === "CANCELLED" && order.status !== "CANCELLED") return false;
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
    const counts: Record<string, number> = {
      ALL: orders.length,
      DELIVERED: 0,
      SHIPPED: 0,
      PROCESSING: 0,
      CONFIRMED: 0,
      CANCELLED: 0,
    };
    for (const order of orders) {
      if (counts[order.status] !== undefined) {
        counts[order.status]++;
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
    // Start with 10 or current visible
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
    // Simulated smooth network/render delay for micro-feedback
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

  // Status Config Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DELIVERED":
        return {
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
          icon: CheckCircle2,
          label: "Delivered",
        };
      case "SHIPPED":
        return {
          bg: "bg-blue-50 text-blue-800 border-blue-200",
          icon: Truck,
          label: "In Transit",
        };
      case "PROCESSING":
        return {
          bg: "bg-amber-50 text-amber-800 border-amber-200",
          icon: Clock,
          label: "Processing",
        };
      case "CONFIRMED":
        return {
          bg: "bg-neutral-100 text-neutral-800 border-neutral-300",
          icon: PackageCheck,
          label: "Confirmed",
        };
      case "CANCELLED":
        return {
          bg: "bg-red-50 text-red-800 border-red-200",
          icon: XCircle,
          label: "Cancelled",
        };
      default:
        return {
          bg: "bg-neutral-100 text-neutral-800 border-neutral-300",
          icon: Package,
          label: status,
        };
    }
  };

  if (authLoading) {
    return (
      <div className="w-full py-20 flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-neutral-900 animate-spin mb-3" />
        <p className="font-mono text-xs uppercase tracking-wider text-neutral-500 font-semibold">
          Authenticating lookbook session...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col pb-24 lg:pb-8">
      {/* Breadcrumb Hierarchy */}
      <nav
        aria-label="Breadcrumbs"
        className="flex items-center gap-2 text-xs font-mono text-neutral-500 uppercase tracking-wider mb-4 sm:mb-6"
      >
        <Link href="/" className="hover:text-neutral-900 transition-colors">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        <Link href="/account" className="hover:text-neutral-900 transition-colors">
          Account
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        <span className="text-neutral-950 font-bold">Orders</span>
      </nav>

      {/* Account Navigation Tabs */}
      <div className="mb-6 sm:mb-8 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 sm:gap-2 pb-1 border-b border-outline-variant/40 min-w-max">
          {ACCOUNT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider transition-all min-h-[40px] ${
                  isActive
                    ? "bg-neutral-950 text-white shadow-sm"
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
      </div>

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6 sm:mb-8 pb-6 border-b border-outline-variant/40">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface uppercase tracking-tight">
              ORDER HISTORY
            </h1>
            {!isLoading && (
              <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                {orders.length} {orders.length === 1 ? "Order" : "Orders"}
              </span>
            )}
          </div>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
            Track Delhivery logistics, inspect technical garment specs, and access official GST tax invoices across your purchases.
          </p>
        </div>

        <Link
          href="/shop"
          className="px-4 sm:px-5 py-2.5 rounded-lg border border-outline-variant/60 hover:bg-neutral-950 hover:text-white hover:border-neutral-950 font-mono text-xs font-bold uppercase text-on-surface transition-all flex items-center gap-2 shrink-0 min-h-[44px]"
        >
          <span>Explore Catalog Drops</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Filter and Search Bar (When orders exist) */}
      {orders.length > 0 && (
        <div className="mb-6 sm:mb-8 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Status Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {(
                [
                  "ALL",
                  "DELIVERED",
                  "SHIPPED",
                  "PROCESSING",
                  "CONFIRMED",
                  "CANCELLED",
                ] as OrderStatusFilter[]
              ).map((filterKey) => {
                const count = statusCounts[filterKey] || 0;
                if (filterKey !== "ALL" && count === 0) return null; // Hide empty filters
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
                    <span>{filterKey === "SHIPPED" ? "IN TRANSIT" : filterKey}</span>
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
                className="w-full pl-9 pr-8 py-2 bg-surface-container-low border border-outline-variant/60 rounded-lg text-xs font-mono text-on-surface placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900 focus:bg-white transition-colors"
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

          {/* Active View Indicator */}
          <div className="flex items-center justify-between text-xs font-mono text-neutral-500 pt-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-neutral-900">
                {isInfiniteMode ? "INFINITE SCROLL MODE" : "DEFAULT VIEW"}
              </span>
              <span>·</span>
              <span>
                Showing {Math.min(visibleOrders.length, filteredOrders.length)} of {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"}
              </span>
            </div>

            {isInfiniteMode && (
              <button
                onClick={handleCollapseClick}
                className="inline-flex items-center gap-1 text-neutral-700 hover:text-neutral-950 font-bold uppercase tracking-wider hover:underline"
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
          {[1, 2, 3].map((i) => (
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
        /* Empty State */
        <div className="text-center py-16 px-6 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl max-w-lg mx-auto shadow-sm space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-surface-container-low text-neutral-800 flex items-center justify-center mx-auto mb-2 border border-outline-variant/40">
            <Package className="w-8 h-8 text-neutral-700 stroke-[1.5]" />
          </div>
          <h2 className="font-headline-sm text-xl font-bold text-on-surface uppercase tracking-tight">
            No Orders Placed Yet
          </h2>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-sm mx-auto leading-relaxed">
            When you purchase heavyweight drop-shoulder tees, graphic art capsules, or custom print batches, they will appear here with live tracking.
          </p>
          <div className="pt-2">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-neutral-800 transition-all shadow-sm active:scale-98 min-h-[44px]"
            >
              <span>Discover Catalog Drops</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : filteredOrders.length === 0 ? (
        /* No Search Matches */
        <div className="text-center py-16 px-6 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl max-w-md mx-auto shadow-sm space-y-3">
          <Search className="w-10 h-10 text-neutral-400 mx-auto mb-1 stroke-[1.5]" />
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
            className="px-4 py-2 bg-neutral-900 text-white font-mono text-xs font-bold uppercase rounded-lg hover:bg-neutral-800 transition-colors"
          >
            Clear Search &amp; Filters
          </button>
        </div>
      ) : (
        /* Orders List */
        <div className="space-y-5">
          {visibleOrders.map((order, index) => {
            const itemCount = order.items.reduce((acc, item) => acc + (item.quantity || 1), 0);
            const statusConfig = getStatusBadge(order.status);
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={order._id || index}
                className="bg-surface-container-lowest border border-outline-variant/50 rounded-2xl overflow-hidden shadow-xs hover:border-neutral-900 transition-all duration-200 streetwear-card"
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
                      ₹{order.total.toLocaleString("en-IN")}
                    </span>
                    <span className="text-neutral-500 text-[11px]">
                      ({itemCount} {itemCount === 1 ? "item" : "items"})
                    </span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-outline-variant/30">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider border ${statusConfig.bg}`}
                    >
                      <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{statusConfig.label}</span>
                    </span>

                    <button
                      onClick={() => router.push(`/account/orders/${order._id}`)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold hover:bg-neutral-800 transition-all shrink-0 min-h-[36px]"
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
                      className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
                    >
                      {/* Product Thumbnail Crop */}
                      <div className="w-14 h-18 sm:w-16 sm:h-20 bg-surface-container-high rounded-xl overflow-hidden relative shrink-0 border border-outline-variant/30">
                        <Image
                          src={item.productImage || "/placeholder.png"}
                          alt={item.productName}
                          fill
                          sizes="(max-width: 640px) 56px, 64px"
                          className="object-cover"
                        />
                      </div>

                      {/* Product Metadata */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-headline-sm font-bold text-sm sm:text-base text-on-surface truncate">
                            {item.productName}
                          </h4>
                          <span className="font-mono text-xs font-bold text-neutral-900 shrink-0">
                            ₹{item.lineTotal.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs text-neutral-500 mt-1.5 flex-wrap">
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
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-100 text-neutral-800 font-mono text-[10px] uppercase font-bold border border-neutral-300">
                            <Sparkles className="w-3 h-3 text-neutral-600" />
                            <span>Custom Graphic Print</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Card Footer Logistics Summary */}
                <div className="px-4 sm:px-5 py-3 bg-surface-container-low/40 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-neutral-500">
                  <div className="flex items-center gap-2">
                    <Truck className="w-3.5 h-3.5 text-neutral-400" />
                    <span>
                      {order.status === "DELIVERED"
                        ? "Delivered via Delhivery Express Surface"
                        : order.status === "SHIPPED"
                        ? "In Transit · Delhivery Surface Tracking Active"
                        : "Express Air & Surface Dispatch via Delhivery Logistics"}
                    </span>
                  </div>

                  <Link
                    href={`/account/orders/${order._id}`}
                    className="text-neutral-800 hover:text-neutral-950 font-bold uppercase hover:underline"
                  >
                    View Shipment Timeline &rarr;
                  </Link>
                </div>
              </div>
            );
          })}

          {/* VIEW ALL ORDERS BANNER (Visible when isInfiniteMode is false and orders > 5) */}
          {canExpandToAll && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-6 sm:p-8 bg-surface-container-lowest border-2 border-neutral-950 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-5 text-center sm:text-left"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <span className="font-headline-sm text-base sm:text-lg font-black text-on-surface uppercase tracking-tight">
                    SHOWING 5 OF {filteredOrders.length} ORDERS
                  </span>
                  <span className="bg-neutral-950 text-white font-mono text-[10px] uppercase px-2 py-0.5 rounded font-bold">
                    CAP VIEW
                  </span>
                </div>
                <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-md">
                  Enable infinite scrolling with lazy loading to view your complete lookbook order archive.
                </p>
              </div>

              <button
                onClick={handleViewAllClick}
                className="w-full sm:w-auto px-6 py-3.5 bg-neutral-950 hover:bg-neutral-800 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-xl transition-all shadow-sm active:scale-98 flex items-center justify-center gap-2 min-h-[44px] shrink-0"
              >
                <span>View All Orders ({filteredOrders.length})</span>
                <ChevronDown className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* INFINITE SCROLL SENTINEL & LAZY LOADING INDICATOR */}
          {isInfiniteMode && (
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
                    You have reached the end of your complete order lookbook.
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
