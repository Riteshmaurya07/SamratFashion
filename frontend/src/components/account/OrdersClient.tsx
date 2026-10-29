"use client";

import { useOrderStore } from "@/store/useOrderStore";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package, ChevronRight } from "lucide-react";

export function OrdersClient() {
  const router = useRouter();
  const { orders, fetchOrders, isLoading } = useOrderStore();

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return (
    <div className="flex-grow flex flex-col w-full max-w-4xl pb-28 lg:pb-0">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8 pb-5 border-b border-outline-variant/30">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight mb-1.5">
            ORDER HISTORY
          </h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant">
            Track Delhivery shipments, view garment specs, and access GST tax invoices.
          </p>
        </div>
        <Link
          href="/shop"
          className="px-4 py-2.5 rounded-lg border border-outline-variant/60 hover:bg-surface-container font-mono text-xs font-bold uppercase text-on-surface transition-colors shrink-0"
        >
          Explore Drops
        </Link>
      </div>

      {isLoading && orders.length === 0 ? (
        <div className="py-16 text-center text-on-surface-variant font-mono text-xs">Loading order history...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 px-6 bg-surface-container-lowest border border-outline-variant/30 rounded-xl max-w-lg mx-auto space-y-3">
          <Package className="w-12 h-12 text-outline-variant mx-auto mb-2" />
          <h3 className="font-headline-sm text-base font-bold text-on-surface">No orders placed yet</h3>
          <p className="text-on-surface-variant text-xs sm:text-sm max-w-sm mx-auto leading-relaxed">
            When you place an order for heavyweight tees, graphic capsules, or custom prints, they will appear here.
          </p>
          <div className="pt-2">
            <button
              onClick={() => router.push("/shop")}
              className="px-6 py-3 bg-neutral-950 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-neutral-800 transition-colors shadow-sm"
            >
              Discover Catalog Drops &rarr;
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {orders.map((order) => {
            const itemCount = order.items.reduce((acc, item) => acc + (item.quantity || 1), 0);
            const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
              DELIVERED: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Delivered" },
              SHIPPED: { bg: "bg-blue-100", text: "text-blue-800", label: "In Transit" },
              PROCESSING: { bg: "bg-amber-100", text: "text-amber-800", label: "Processing" },
              CANCELLED: { bg: "bg-red-100", text: "text-red-800", label: "Cancelled" },
              CONFIRMED: { bg: "bg-neutral-100", text: "text-neutral-800", label: "Confirmed" },
              PENDING: { bg: "bg-amber-100", text: "text-amber-800", label: "Pending" },
            };
            const currentStatus = statusConfig[order.status] || { bg: "bg-neutral-100", text: "text-neutral-800", label: order.status };

            return (
              <div
                key={order._id}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs hover:border-neutral-900 transition-all streetwear-card"
              >
                {/* Order Summary Top Bar */}
                <div className="p-4 sm:p-5 bg-surface-container-low/60 border-b border-outline-variant/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                    <span className="font-bold text-neutral-950 text-sm">#{order.orderNumber}</span>
                    <span className="text-neutral-400">·</span>
                    <span className="text-neutral-500">{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                    <span className="text-neutral-400">·</span>
                    <span className="font-bold text-neutral-900">₹{order.total.toLocaleString("en-IN")}</span>
                    <span className="text-neutral-400">({itemCount} {itemCount === 1 ? "item" : "items"})</span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-outline-variant/20">
                    <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider ${currentStatus.bg} ${currentStatus.text}`}>
                      {currentStatus.label}
                    </span>

                    <button
                      onClick={() => router.push(`/account/orders/${order._id}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 text-white font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors shrink-0"
                    >
                      <span>Details &amp; Invoice</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Items Preview List */}
                <div className="p-4 sm:p-5 divide-y divide-outline-variant/20">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                      <div className="w-14 h-18 sm:w-16 sm:h-20 bg-surface-container-high rounded-md overflow-hidden relative shrink-0 border border-outline-variant/20">
                        <Image
                          src={item.productImage || "/placeholder.png"}
                          alt={item.productName}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-body-sm font-bold text-sm text-on-surface truncate">
                          {item.productName}
                        </h4>
                        <div className="flex items-center gap-2 font-mono text-xs text-neutral-500 mt-1 flex-wrap">
                          {item.selectedSize && <span>Size: <strong className="text-on-surface">{item.selectedSize}</strong></span>}
                          {item.selectedColor && (
                            <>
                              <span>·</span>
                              <span>Color: <strong className="text-on-surface">{item.selectedColor}</strong></span>
                            </>
                          )}
                          <span>·</span>
                          <span>Qty: <strong className="text-on-surface">{item.quantity}</strong></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
