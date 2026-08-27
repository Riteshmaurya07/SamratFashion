"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface CustomOrderSummary {
  _id: string;
  orderNumber: string;
  user: {
    _id: string;
    name: string;
    email: string;
  };
  shippingAddress?: {
    fullName: string;
    phone: string;
    city: string;
  };
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  customItems: Array<{
    item: {
      productId: string;
      productName: string;
      selectedColor: string;
      selectedSize: string;
      quantity: number;
      unitPrice: number;
      customizationSnapshot?: {
        name: string;
        previewImage?: string;
        printLocations?: string[];
      };
    };
    printJob: {
      _id: string;
      status: string;
      priority: string;
      printLocations: string[];
      printMethod: string;
    };
  }>;
}

export default function AdminCustomOrdersClient() {
  const router = useRouter();

  const [orders, setOrders] = useState<CustomOrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");

  // Fetch Admin Custom Orders
  useEffect(() => {
    async function fetchCustomOrders() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/custom-orders", {
          params: {
            q: searchQuery || undefined,
            productionStatus: statusFilter !== "All" ? statusFilter : undefined,
            priority: priorityFilter !== "All" ? priorityFilter : undefined,
          },
        });
        if (res.data?.success) {
          setOrders(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to fetch custom orders.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchCustomOrders();
  }, [searchQuery, statusFilter, priorityFilter, router]);

  // Compute KPI Counts
  const totalCount = orders.length;
  const pendingReviewCount = orders.filter((o) => o.customItems.some((ci) => ci.printJob.status === "PENDING_REVIEW")).length;
  const approvedCount = orders.filter((o) => o.customItems.some((ci) => ci.printJob.status === "READY_FOR_PRINT")).length;
  const printingCount = orders.filter((o) => o.customItems.some((ci) => ci.printJob.status === "PRINTING")).length;
  const qualityCheckCount = orders.filter((o) => o.customItems.some((ci) => ci.printJob.status === "QUALITY_CHECK")).length;
  const readyToShipCount = orders.filter((o) => o.customItems.some((ci) => ci.printJob.status === "PRINTED")).length;

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Custom Orders & Print Production
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Review customer graphic designs, verify print specs, and manage custom production workflow.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/orders"
            className="px-5 py-2.5 border border-outline-variant text-on-surface rounded-lg font-label-caps text-xs font-bold hover:bg-surface-container-low transition-colors"
          >
            All Retail Orders
          </Link>
        </div>
      </div>

      {/* KPI Summary Cards (Stitch Screen Match) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Total Custom</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{totalCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-amber-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Pending Review</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{pendingReviewCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-emerald-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Ready for Print</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{approvedCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-blue-600 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Printing</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{printingCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-indigo-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Quality Check</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{qualityCheckCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-teal-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Printed / Ready</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{readyToShipCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[280px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg font-body-sm text-sm outline-none focus:border-primary"
            placeholder="Search by order ID, customer name, design or product..."
          />
        </div>
        <div className="flex gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="All">Production Status: All</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="READY_FOR_PRINT">Ready for Print</option>
            <option value="PRINTING">Printing</option>
            <option value="QUALITY_CHECK">Quality Check</option>
            <option value="PRINTED">Printed</option>
            <option value="COMPLETED">Completed</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="All">Priority: All</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant animate-pulse space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-surface-container rounded-lg" />
          ))}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">
          {error}
        </div>
      )}

      {/* Custom Orders Data Table (Stitch Screen Match) */}
      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Artwork Preview</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Order ID</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Customer</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Product / Specs</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Production Status</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Priority</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-sm">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-on-surface-variant">
                      No paid custom orders found matching filters.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const firstCustom = order.customItems[0];
                    const item = firstCustom?.item;
                    const printJob = firstCustom?.printJob;
                    const previewUrl =
                      item?.customizationSnapshot?.previewImage ||
                      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500";

                    return (
                      <tr
                        key={order._id}
                        onClick={() => router.push(`/admin/custom-orders/${order._id}`)}
                        className="border-b border-outline-variant hover:bg-surface-container-low transition-colors cursor-pointer group"
                      >
                        <td className="p-4">
                          <div className="w-12 h-12 bg-surface-container rounded-md border border-outline-variant overflow-hidden relative">
                            {/* eslint-disable-next-next/no-img-element */}
                            <img src={previewUrl} alt="Design Preview" className="w-full h-full object-cover" />
                          </div>
                        </td>
                        <td className="p-4 font-bold font-label-caps text-on-surface">{order.orderNumber}</td>
                        <td className="p-4 text-on-surface-variant font-medium">
                          {order.user?.name || order.shippingAddress?.fullName || "Customer"}
                        </td>
                        <td className="p-4">
                          <p className="font-bold text-on-surface">{item?.productName}</p>
                          <p className="text-xs text-on-surface-variant">
                            Qty: {item?.quantity} • {item?.selectedColor} ({item?.selectedSize})
                          </p>
                        </td>
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                              printJob?.status === "PRINTED" || printJob?.status === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-800"
                                : printJob?.status === "PRINTING"
                                ? "bg-blue-100 text-blue-800"
                                : printJob?.status === "READY_FOR_PRINT"
                                ? "bg-indigo-100 text-indigo-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {printJob?.status || "PENDING_REVIEW"}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs font-bold ${
                              printJob?.priority === "HIGH" ? "text-red-600 font-extrabold" : "text-on-surface-variant"
                            }`}
                          >
                            {printJob?.priority || "MEDIUM"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/admin/custom-orders/${order._id}`);
                            }}
                            className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-lg hover:bg-primary-container transition-colors"
                          >
                            Inspect Print Job
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
