/* eslint-disable @next/next/no-img-element */
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
  shippingAddress?: {
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
  subtotal?: number;
  total: number | null;
  createdAt: string;
  isPrintingRequest?: boolean;
  customItems: Array<{
    item: {
      productId: string;
      productName: string;
      selectedColor: string;
      selectedSize: string;
      quantity: number;
      unitPrice: number | null;
      instructions?: string;
      artwork?: { url: string };
      requestType?: string;
        customizationSnapshot?: {
          name: string;
          previewImage?: string;
          printLocations?: string[];
          selectedPlacements?: Array<{ code: string; name: string }>;
          designAssistance?: { requested: boolean; name?: string; email?: string; instructions?: string };
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
    } | null;
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
          const currentPrintJob = updatedCustomItems[0]?.printJob;
          if (!currentPrintJob) return prev;
          currentPrintJob.status = newStatus;
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
          const currentPrintJob = updatedCustomItems[0]?.printJob;
          if (!currentPrintJob) return prev;
          currentPrintJob.notes = res.data.data.notes;
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
  const previewUrl = item?.customizationSnapshot?.previewImage;

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {toast && <div className={`fixed top-20 right-6 z-50 rounded-lg px-6 py-4 text-white shadow-xl ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>{toast.text}</div>}
      <div className="mb-6 flex items-center gap-3 text-xs font-label-caps uppercase tracking-widest text-on-surface-variant">
        <Link href="/admin/custom-orders" className="hover:text-primary">Custom Orders</Link>
        <span aria-hidden="true">›</span><span className="font-bold text-primary">{order.orderNumber}</span>
      </div>
      <div className="mb-8 flex flex-col items-start justify-between gap-4 border-b border-outline-variant/10 pb-6 lg:flex-row lg:items-center">
        <div><h1 className="flex items-center gap-3 font-display-lg text-2xl font-extrabold text-on-surface md:text-4xl">{item?.customizationSnapshot?.name || "Custom Printing Request"}<span className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-bold uppercase tracking-wider">{order.isPrintingRequest ? "REQUESTED" : printJob?.status || "PENDING_REVIEW"}</span></h1><p className="mt-1 text-xs text-on-surface-variant">{order.isPrintingRequest ? "Customer request" : `Order #${order.orderNumber}`} · {new Date(order.createdAt).toLocaleDateString()}</p></div>
        {!order.isPrintingRequest && <div className="flex flex-wrap gap-3"><button onClick={() => handleUpdateStatus("REJECTED")} disabled={isUpdatingStatus} className="rounded-lg border border-red-500 px-4 py-2.5 text-xs font-bold text-red-600 disabled:opacity-50">Reject Design</button><button onClick={() => handleUpdateStatus("READY_FOR_PRINT")} disabled={isUpdatingStatus} className="rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-on-primary disabled:opacity-50">Approve for Print</button><button onClick={handleDownloadPrintSheet} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white">Export Print Sheet</button></div>}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-8">
          <div className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
            <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-low p-4"><span className="font-label-caps text-xs font-bold uppercase">Artwork / product preview</span><span className="text-xs text-on-surface-variant">{item?.customizationSnapshot?.printLocations?.join(", ") || "No placement"}</span></div>
            <div className="flex min-h-72 items-center justify-center bg-surface-container-low p-8">{previewUrl ? <img src={previewUrl} alt="Uploaded artwork or product preview" className="max-h-80 max-w-full object-contain drop-shadow-xl" /> : <p className="text-center text-sm text-on-surface-variant">No artwork provided — design assistance requested.</p>}</div>
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6">
            <h2 className="mb-4 text-lg font-bold">Request details</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div><dt className="text-on-surface-variant">Product</dt><dd className="font-bold">{item?.productName}</dd></div>
              <div><dt className="text-on-surface-variant">Color / size</dt><dd className="font-bold">{item?.selectedColor} · {item?.selectedSize}</dd></div>
              <div>
                <dt className="text-on-surface-variant">Print placements</dt>
                <dd className="font-bold">
                  {item?.customizationSnapshot?.selectedPlacements?.length 
                    ? item.customizationSnapshot.selectedPlacements.map(p => p.name).join(", ") 
                    : item?.customizationSnapshot?.printLocations?.join(", ") || "None"}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Artwork</dt>
                <dd className="font-bold">
                  {item?.artwork?.url ? "Provided" : item?.customizationSnapshot?.designAssistance?.requested ? "Design Assistance Requested" : "No artwork provided"}
                </dd>
              </div>
            </dl>
            {item?.customizationSnapshot?.designAssistance?.requested && (
              <div className="mt-5 rounded-xl bg-primary/10 border border-primary/20 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">Design Assistance Requested</p>
                <dl className="mt-2 text-sm grid gap-2 md:grid-cols-2">
                  <div><dt className="text-on-surface-variant">Name</dt><dd className="font-bold">{item?.customizationSnapshot.designAssistance.name || "N/A"}</dd></div>
                  <div><dt className="text-on-surface-variant">Email</dt><dd className="font-bold">{item?.customizationSnapshot.designAssistance.email || "N/A"}</dd></div>
                </dl>
              </div>
            )}
            <div className="mt-5 rounded-xl bg-surface-container-low p-4"><p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Customer instructions</p><p className="mt-2 whitespace-pre-wrap text-sm">{item?.instructions || "No instructions provided."}</p></div>
          </div>
        </div>
        <div className="flex flex-col gap-6 lg:col-span-4">
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6"><h2 className="mb-4 text-lg font-bold">Customer & request info</h2><dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-on-surface-variant">Customer</dt><dd className="text-right font-bold">{order.user?.name || order.shippingAddress?.fullName || "Customer"}</dd></div><div className="flex justify-between gap-4"><dt className="text-on-surface-variant">Contact</dt><dd className="text-right font-bold">{order.user?.email || "Account contact"}</dd></div><div className="flex justify-between gap-4"><dt className="text-on-surface-variant">Status</dt><dd className="font-bold text-primary">{order.isPrintingRequest ? "REQUESTED" : printJob?.status}</dd></div></dl></div>
          {!order.isPrintingRequest && <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6"><h2 className="mb-4 text-lg font-bold">Internal production notes</h2><div className="max-h-52 space-y-3 overflow-y-auto">{printJob?.notes?.map((note, index) => <div key={note._id || index} className="rounded-xl bg-surface-container-low p-3 text-xs">{note.text}</div>)}</div><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} className="mt-4 w-full rounded-xl border border-outline-variant p-3 text-xs" rows={3} placeholder="Add admin-only production notes" /><button onClick={handleAddNote} disabled={isAddingNote || !noteText.trim()} className="mt-3 w-full rounded-xl bg-surface-container-high px-3 py-2.5 text-xs font-bold disabled:opacity-50">{isAddingNote ? "Saving…" : "Save Production Note"}</button></div>}
        </div>
      </div>
    </div>
  );
}

