"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface CustomOrderDetail {
  _id: string;
  orderNumber: string;
  user: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
  };
  shippingAddress: {
    fullName: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  status: string;
  paymentStatus: string;
  subtotal: number;
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
        customFee?: number;
      };
    };
    printJob: {
      _id: string;
      status: string;
      priority: string;
      printLocations: string[];
      printMethod: string;
      notes: Array<{
        _id?: string;
        text: string;
        createdBy: { name: string; email: string } | string;
        createdAt: string;
      }>;
    };
    product?: {
      _id: string;
      name: string;
      slug: string;
      sku: string;
      color: string;
      size: string;
      basePrice: number;
    } | null;
  }>;
}

export default function AdminCustomOrderDetailClient({ orderId }: { orderId: string }) {
  const router = useRouter();

  const [order, setOrder] = useState<CustomOrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Studio Preview Side & Zoom State
  const [activeSide, setActiveSide] = useState<"FRONT" | "BACK">("FRONT");
  const [zoomLevel, setZoomLevel] = useState(100);

  // Status Operation State
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Note Input State
  const [noteText, setNoteText] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Fetch Custom Order Details
  useEffect(() => {
    async function fetchOrderDetail() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get(`/admin/custom-orders/${orderId}`);
        if (res.data?.success) {
          setOrder(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load custom order detail.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchOrderDetail();
  }, [orderId, router]);

  // Handle Production Status Transition
  const handleUpdateStatus = async (newStatus: string) => {
    if (!order || !order.customItems[0]?.printJob) return;
    const printJobId = order.customItems[0].printJob._id;

    setIsUpdatingStatus(true);
    setToast(null);

    try {
      const res = await api.put(`/admin/custom-orders/print-jobs/${printJobId}/status`, {
        status: newStatus,
      });

      if (res.data?.success) {
        setOrder((prev) => {
          if (!prev) return null;
          const updatedCustomItems = [...prev.customItems];
          updatedCustomItems[0].printJob.status = newStatus;
          return { ...prev, customItems: updatedCustomItems };
        });
        setToast({ text: `Production status updated to ${newStatus}`, type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Status update failed", type: "error" });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Handle Adding Production Note
  const handleAddNote = async () => {
    if (!noteText.trim() || !order || !order.customItems[0]?.printJob) return;
    const printJobId = order.customItems[0].printJob._id;

    setIsAddingNote(true);
    setToast(null);

    try {
      const res = await api.post(`/admin/custom-orders/print-jobs/${printJobId}/notes`, {
        text: noteText.trim(),
      });

      if (res.data?.success) {
        setOrder((prev) => {
          if (!prev) return null;
          const updatedCustomItems = [...prev.customItems];
          updatedCustomItems[0].printJob.notes = res.data.data.notes;
          return { ...prev, customItems: updatedCustomItems };
        });
        setNoteText("");
        setToast({ text: "Production note saved", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to save note", type: "error" });
    } finally {
      setIsAddingNote(false);
    }
  };

  // Handle High-Res SVG Print Sheet Export Download
  const handleDownloadPrintSheet = () => {
    if (!order) return;
    const exportUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"}/admin/custom-orders/${order._id}/export?side=${activeSide}`;
    window.open(exportUrl, "_blank");
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading custom order detail...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen">
        <div className="p-6 bg-error-container text-on-error-container rounded-xl text-center font-bold">{error || "Order not found."}</div>
      </div>
    );
  }

  const firstCustom = order.customItems[0];
  const item = firstCustom?.item;
  const printJob = firstCustom?.printJob;
  const product = firstCustom?.product;
  const previewUrl = item?.customizationSnapshot?.previewImage || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500";

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Breadcrumb Header */}
      <div className="flex items-center gap-3 text-xs font-label-caps text-on-surface-variant mb-6 uppercase tracking-widest">
        <Link href="/admin/custom-orders" className="hover:text-primary transition-colors">
          Custom Orders
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-primary font-bold">{order.orderNumber}</span>
      </div>

      {/* Main Action Header Section (Stitch Screen Match) */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4 border-b border-outline-variant/10 pb-6">
        <div>
          <h1 className="font-display-lg text-2xl md:text-4xl font-extrabold text-on-surface flex items-center gap-3">
            {item?.customizationSnapshot?.name || "Custom Graphic Tee"}
            <span className="bg-surface-container-high text-on-surface font-label-caps text-xs px-3 py-1 rounded-full uppercase tracking-wider font-bold">
              {printJob?.status || "PENDING_REVIEW"}
            </span>
          </h1>
          <p className="font-label-caps text-xs text-on-surface-variant mt-1">
            Order #{order.orderNumber} • Placed {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Action Status Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleUpdateStatus("REJECTED")}
            disabled={isUpdatingStatus}
            className="px-4 py-2.5 border border-red-500 text-red-600 hover:bg-red-50 font-headline-sm text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            Reject Design
          </button>
          <button
            onClick={() => handleUpdateStatus("READY_FOR_PRINT")}
            disabled={isUpdatingStatus}
            className="px-5 py-2.5 bg-primary text-on-primary font-headline-sm text-xs font-bold rounded-lg hover:bg-primary-container transition-colors shadow-md disabled:opacity-50 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Approve for Print
          </button>
          <button
            onClick={handleDownloadPrintSheet}
            className="px-5 py-2.5 bg-emerald-600 text-white font-headline-sm text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors shadow-md flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Export Print Sheet (300 DPI)
          </button>
        </div>
      </div>

      {/* 2-Column Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Artwork Workspace & Production Specs (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Design Preview Workspace (Stitch Screen Match) */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex justify-between items-center p-4 border-b border-outline-variant/20 bg-surface-container-low">
              <div className="flex gap-4 font-label-caps text-xs font-bold">
                <button
                  onClick={() => setActiveSide("FRONT")}
                  className={`pb-1 transition-colors ${
                    activeSide === "FRONT" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  FRONT MOCKUP
                </button>
                <button
                  onClick={() => setActiveSide("BACK")}
                  className={`pb-1 transition-colors ${
                    activeSide === "BACK" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  BACK MOCKUP
                </button>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-2 text-on-surface-variant">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
                  className="p-1 hover:bg-surface-container-highest rounded"
                >
                  <span className="material-symbols-outlined text-sm">remove</span>
                </button>
                <span className="font-label-caps text-xs font-bold">{zoomLevel}%</span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
                  className="p-1 hover:bg-surface-container-highest rounded"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              </div>
            </div>

            {/* Canvas Viewport */}
            <div className="aspect-[4/3] bg-surface-container-low relative flex items-center justify-center p-8 overflow-hidden">
              {/* eslint-disable-next-next/no-img-element */}
              <img
                src={previewUrl}
                alt="Artwork Preview"
                style={{ transform: `scale(${zoomLevel / 100})` }}
                className="max-h-full max-w-full object-contain drop-shadow-2xl transition-transform duration-300"
              />
            </div>
          </div>

          {/* Production Specification Panel */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-6 shadow-sm">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface mb-4">Production Specification</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-on-surface-variant font-label-caps text-xs uppercase mb-1">Print Position</p>
                <p className="font-body-md font-bold text-on-surface">{activeSide} CENTER</p>
              </div>
              <div>
                <p className="text-on-surface-variant font-label-caps text-xs uppercase mb-1">Method</p>
                <p className="font-body-md font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">print</span> DTG (Direct to Garment)
                </p>
              </div>
              <div>
                <p className="text-on-surface-variant font-label-caps text-xs uppercase mb-1">Target Dimensions</p>
                <p className="font-body-md font-bold text-on-surface">12 x 16 inches (300 DPI)</p>
              </div>
              <div>
                <p className="text-on-surface-variant font-label-caps text-xs uppercase mb-1">Production Status</p>
                <p className="font-body-md font-bold text-primary">{printJob?.status}</p>
              </div>
            </div>

            <div className="mt-6 p-4 bg-surface-container-low rounded-xl border border-outline-variant/20 flex flex-wrap justify-between items-center gap-2">
              <div>
                <span className="font-label-caps text-xs text-on-surface-variant uppercase block">Base Garment Blank</span>
                <span className="font-bold text-on-surface text-sm">{item?.productName}</span>
              </div>
              <span className="font-label-caps text-xs font-bold text-primary bg-surface-container-highest px-3 py-1 rounded-md">
                SKU: {product?.sku || "TS-BLK-OV-L"} • {item?.selectedColor} ({item?.selectedSize})
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Info & Production Notes (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Customer & Order Metadata */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface">Customer & Order Info</h3>
            <div className="flex justify-between py-2 border-b border-outline-variant/10 text-xs">
              <span className="text-on-surface-variant font-label-caps uppercase">Customer</span>
              <span className="font-bold text-on-surface">{order.user?.name || order.shippingAddress.fullName}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-outline-variant/10 text-xs">
              <span className="text-on-surface-variant font-label-caps uppercase">Payment Status</span>
              <span className="font-bold text-emerald-600 uppercase">{order.paymentStatus}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-outline-variant/10 text-xs">
              <span className="text-on-surface-variant font-label-caps uppercase">Line Unit Price</span>
              <span className="font-bold text-on-surface">₹{item ? item.unitPrice / 100 : 0}</span>
            </div>
            <div className="flex justify-between py-2 text-xs">
              <span className="text-on-surface-variant font-label-caps uppercase">Total Custom Paid</span>
              <span className="font-bold text-primary text-base">₹{order.total / 100}</span>
            </div>
          </div>

          {/* Internal Production Notes (Stitch Screen Match) */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">notes</span> Internal Production Notes
            </h3>

            {/* Existing Notes Thread */}
            <div className="flex flex-col gap-3 max-h-[220px] overflow-y-auto pr-1">
              {printJob?.notes && printJob.notes.length > 0 ? (
                printJob.notes.map((n, idx) => (
                  <div key={idx} className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/10 text-xs">
                    <p className="font-body-md text-on-surface">{n.text}</p>
                    <span className="font-label-caps text-[10px] text-on-surface-variant mt-1 block">
                      {typeof n.createdBy === "object" ? n.createdBy.name : "Admin"} • {new Date(n.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-on-surface-variant italic">No admin notes added yet.</p>
              )}
            </div>

            {/* Note Input */}
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs focus:outline-none focus:border-primary resize-none"
              rows={3}
              placeholder="Add admin-only notes regarding printing specs, ink density, or copyright review..."
            />
            <button
              onClick={handleAddNote}
              disabled={isAddingNote || !noteText.trim()}
              className="w-full py-2.5 bg-surface-container-high text-on-surface font-headline-sm text-xs font-bold rounded-xl hover:bg-surface-container-highest transition-colors disabled:opacity-50"
            >
              {isAddingNote ? "Saving..." : "Save Production Note"}
            </button>
          </div>

          {/* Logistics & Real Shipment Management Panel */}
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">local_shipping</span> Logistics & Shipment
            </h3>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  try {
                    const res = await api.post(`/admin/orders/${order._id}/shipment`, { weightGrams: 500 });
                    if (res.data?.success) {
                      setToast({ text: `Shipment created! AWB: ${res.data.data.awbNumber}`, type: "success" });
                    }
                  } catch (err: any) {
                    setToast({ text: err.response?.data?.message || "Failed to create shipment", type: "error" });
                  }
                }}
                className="w-full py-2.5 bg-primary text-on-primary font-headline-sm text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">add_box</span> Create Courier Shipment (AWB)
              </button>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => {
                    const labelUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"}/admin/orders/${order._id}/shipment/label`;
                    window.open(labelUrl, "_blank");
                  }}
                  className="py-2 px-3 border border-outline-variant text-on-surface hover:bg-surface-container font-headline-sm text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">download</span> Print Label
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await api.post(`/admin/orders/${order._id}/shipment/pickup`);
                      if (res.data?.success) {
                        setToast({ text: "Courier pickup requested successfully", type: "success" });
                      }
                    } catch (err: any) {
                      setToast({ text: err.response?.data?.message || "Pickup request failed", type: "error" });
                    }
                  }}
                  className="py-2 px-3 border border-outline-variant text-on-surface hover:bg-surface-container font-headline-sm text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">front_hand</span> Request Pickup
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={async () => {
                    try {
                      const res = await api.put(`/admin/orders/${order._id}/shipment`, { status: "PICKED_UP" });
                      if (res.data?.success) {
                        setToast({ text: "Courier handoff confirmed! Order is now SHIPPED.", type: "success" });
                      }
                    } catch (err: any) {
                      setToast({ text: err.response?.data?.message || "Failed to confirm handoff", type: "error" });
                    }
                  }}
                  className="py-2 px-3 bg-emerald-700 text-white font-headline-sm text-xs font-bold rounded-lg hover:bg-emerald-800 transition-colors flex items-center justify-center gap-1 col-span-2"
                >
                  <span className="material-symbols-outlined text-xs">local_shipping</span> Confirm Courier Handoff (Mark Shipped)
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await api.post(`/admin/orders/${order._id}/shipment/tracking/refresh`);
                      if (res.data?.success) {
                        setToast({ text: `Tracking refreshed: ${res.data.data.status}`, type: "success" });
                      }
                    } catch (err: any) {
                      setToast({ text: err.response?.data?.message || "Tracking refresh failed", type: "error" });
                    }
                  }}
                  className="py-2 px-3 border border-outline-variant text-on-surface hover:bg-surface-container font-headline-sm text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">sync</span> Refresh Tracking
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await api.post(`/admin/orders/${order._id}/shipment/cancel`);
                      if (res.data?.success) {
                        setToast({ text: "Shipment cancelled", type: "success" });
                      }
                    } catch (err: any) {
                      setToast({ text: err.response?.data?.message || "Shipment cancellation failed", type: "error" });
                    }
                  }}
                  className="py-2 px-3 border border-red-300 text-red-600 hover:bg-red-50 font-headline-sm text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">cancel</span> Cancel Shipment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
