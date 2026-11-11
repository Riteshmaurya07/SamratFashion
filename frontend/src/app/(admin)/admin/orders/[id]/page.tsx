"use client";

import { useEffect, useState, use, useCallback } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { StaffMockupManager } from "@/components/admin/StaffMockupManager";
import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";
import { NimbusPostCourierComparison } from "@/components/admin/NimbusPostCourierComparison";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function istDateInputValue(offsetDays = 0): string {
  const shifted = new Date(Date.now() + IST_OFFSET_MS + offsetDays * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

function formatIstDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getShipmentStatusClass(status: string): string {
  switch (status) {
    case "DELIVERED":
      return "bg-green-100 text-green-800 border-green-200";
    case "CANCELLED":
    case "RTO":
      return "bg-error-container/20 text-error border-error/20";
    case "NDR":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "PICKUP_REQUESTED":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "PICKED_UP":
    case "SHIPPED":
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "bg-primary/10 text-primary border-primary/20";
    default:
      return "bg-surface-container-high text-on-surface border-outline-variant/30";
  }
}

export default function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const orderId = unwrappedParams.id;
  const router = useRouter();
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const [refunds, setRefunds] = useState<any[]>([]);
  const [shipment, setShipment] = useState<any>(null);
  const [fulfillment, setFulfillment] = useState<any>(null);
  const [inspectItem, setInspectItem] = useState<any | null>(null);
  const [inspectProductData, setInspectProductData] = useState<any | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
  const [dispatchMode, setDispatchMode] = useState<"PROVIDER" | "MANUAL">("MANUAL");
  const [weightGramsInput, setWeightGramsInput] = useState("500");
  const [lengthCmInput, setLengthCmInput] = useState("30");
  const [widthCmInput, setWidthCmInput] = useState("25");
  const [heightCmInput, setHeightCmInput] = useState("5");
  const [manualCarrierInput, setManualCarrierInput] = useState("Delhivery Express");
  const [manualAwbInput, setManualAwbInput] = useState("");
  const [shipmentModalError, setShipmentModalError] = useState("");
  const [shipmentAction, setShipmentAction] = useState<"pickup" | "tracking" | "cancel" | null>(null);
  const [shipmentActionError, setShipmentActionError] = useState("");
  const [pickupDate, setPickupDate] = useState(() => istDateInputValue(1));
  const [shipmentNotice, setShipmentNotice] = useState("");
  const [showTrackingHistory, setShowTrackingHistory] = useState(false);

  const [isCancelItemsModalOpen, setIsCancelItemsModalOpen] = useState(false);
  const [adminCancelItemsMap, setAdminCancelItemsMap] = useState<Record<string, number>>({});
  const [adminCancelReason, setAdminCancelReason] = useState("Administrative cancellation");
  const [cancelItemsLoading, setCancelItemsLoading] = useState(false);
  const [cancelItemsError, setCancelItemsError] = useState("");

  const handleDispatchShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dispatchMode === "MANUAL") {
      if (!manualCarrierInput.trim()) {
        setShipmentModalError("Carrier Name is required for manual dispatch");
        return;
      }
      if (!manualAwbInput.trim()) {
        setShipmentModalError("Tracking / AWB Number is required for manual dispatch");
        return;
      }
    }
    const weight = Number(weightGramsInput);
    if (!weight || weight <= 0) {
      setShipmentModalError("Package weight must be greater than 0 grams");
      return;
    }

    setStatusLoading(true);
    setShipmentModalError("");
    try {
      const payload: Record<string, unknown> = {
        mode: dispatchMode,
        weightGrams: weight,
        lengthCm: Number(lengthCmInput) || 30,
        widthCm: Number(widthCmInput) || 25,
        heightCm: Number(heightCmInput) || 5,
      };
      if (dispatchMode === "MANUAL") {
        payload.carrier = manualCarrierInput.trim();
        payload.trackingNumber = manualAwbInput.trim();
      }

      await api.post(`/admin/orders/${orderId}/shipment`, payload);
      setIsShipmentModalOpen(false);
      setManualAwbInput("");
      await fetchOrder();
    } catch (err: any) {
      setShipmentModalError(err.response?.data?.message || "Failed to create courier shipment");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleOpenInspect = async (item: any) => {
    setInspectItem(item);
    setInspectProductData(null);
    const prodId = typeof item.productId === "object" ? item.productId?._id : item.productId;
    if (prodId) {
      setInspectLoading(true);
      try {
        const res = await api.get(`/admin/products/${prodId}`);
        if (res.data?.success) {
          setInspectProductData(res.data.data);
        }
      } catch (err) {
        console.error("Failed to fetch product details for cross-confirmation", err);
      } finally {
        setInspectLoading(false);
      }
    }
  };
  const fetchOrder = useCallback(async () => {
    try {
      const res = await api.get(`/admin/orders/${orderId}`);
      setData(res.data.data);

      const refundRes = await api.get(`/admin/orders/${orderId}/refunds`);
      setRefunds(refundRes.data.data);

      try {
        const shipmentRes = await api.get(`/admin/orders/${orderId}/shipment`);
        setShipment(shipmentRes.data.data);
      } catch (err) {
        console.error('Failed to fetch shipment', err);
      }

      try {
        const fulfillmentRes = await api.get(`/admin/orders/${orderId}/fulfillment`);
        setFulfillment(fulfillmentRes.data.data?.fulfillment);
      } catch (err) {
        console.error('Failed to fetch fulfillment', err);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load order details");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const handleStatusChange = async (newStatus: string) => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.patch(`/admin/orders/${orderId}/status`, { status: newStatus });
      await fetchOrder(); // Reload
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!confirm("Are you sure you want to cancel this order?")) return;
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/cancel`);
      await fetchOrder(); // Reload
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to cancel order");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleOpenCancelItemsModal = (preselectedItemId?: string) => {
    setCancelItemsError("");
    const map: Record<string, number> = {};
    if (data?.items) {
      data.items.forEach((it: any) => {
        const remaining = it.quantity - (it.cancelledQuantity || 0);
        if (remaining > 0) {
          if (preselectedItemId && it._id === preselectedItemId) {
            map[it._id] = remaining;
          } else {
            map[it._id] = 0;
          }
        }
      });
    }
    setAdminCancelItemsMap(map);
    setIsCancelItemsModalOpen(true);
  };

  const handleAdminCancelItems = async () => {
    setCancelItemsLoading(true);
    setCancelItemsError("");
    try {
      const itemsToCancel = Object.entries(adminCancelItemsMap)
        .filter(([_, qty]) => qty > 0)
        .map(([itemId, quantity]) => ({ itemId, quantity }));

      if (itemsToCancel.length === 0) {
        setCancelItemsError("Please select at least one item with quantity > 0 to cancel");
        setCancelItemsLoading(false);
        return;
      }

      await api.post(`/admin/orders/${orderId}/cancel-items`, {
        items: itemsToCancel,
        reason: adminCancelReason,
      });

      setIsCancelItemsModalOpen(false);
      await fetchOrder();
    } catch (err: any) {
      setCancelItemsError(err.response?.data?.message || "Failed to cancel selected items");
    } finally {
      setCancelItemsLoading(false);
    }
  };

  // Warehouse Fulfillment Actions
  const handlePickFulfillment = async () => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/fulfillment/pick`);
      await fetchOrder();
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to confirm item picking");
    } finally {
      setStatusLoading(false);
    }
  };

  const handlePackFulfillment = async () => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/fulfillment/pack`, {
        packageDetails: { weightGrams: 600, lengthCm: 30, widthCm: 25, heightCm: 5 }
      });
      await fetchOrder();
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to confirm packing");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleQCFulfillment = async (qcStatus: "PASSED" | "FAILED") => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/fulfillment/qc`, {
        status: qcStatus,
        notes: qcStatus === "PASSED" ? "Quality check passed cleanly." : "Quality check failed inspection."
      });
      await fetchOrder();
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to update Quality Check status");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleReadyToShipFulfillment = async () => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/fulfillment/ready-to-ship`);
      await fetchOrder();
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to mark Ready to Ship");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleDownloadPackingSlip = async () => {
    try {
      const res = await api.get(`/admin/orders/${orderId}/fulfillment/packing-slip`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setActionError(e.response?.data?.message || "Failed to download packing slip.");
    }
  };

  const handleDownloadShippingLabel = async () => {
    try {
      const res = await api.get(`/admin/orders/${orderId}/shipment/label`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setActionError(e.response?.data?.message || "Failed to download shipping label.");
    }
  };

  const handleRequestPickup = async () => {
    setShipmentAction("pickup");
    setShipmentActionError("");
    setShipmentNotice("");
    try {
      const res = await api.post(`/admin/orders/${orderId}/shipment/pickup`, { pickupDate });
      const pickupId = res.data?.data?.pickupId;
      setShipmentNotice(
        `Pickup requested${pickupId ? ` (ID: ${pickupId})` : ""} for ${pickupDate}.`
      );
      await fetchOrder();
    } catch (err: any) {
      setShipmentActionError(err.response?.data?.message || "Failed to schedule pickup.");
    } finally {
      setShipmentAction(null);
    }
  };

  const handleRefreshTracking = async () => {
    setShipmentAction("tracking");
    setShipmentActionError("");
    setShipmentNotice("");
    try {
      const res = await api.post(`/admin/orders/${orderId}/shipment/tracking/refresh`);
      const status = res.data?.data?.status;
      setShipmentNotice(
        status ? `Tracking refreshed — current status: ${status}.` : "Tracking refreshed."
      );
      setShowTrackingHistory(true);
      await fetchOrder();
    } catch (err: any) {
      setShipmentActionError(err.response?.data?.message || "Failed to refresh tracking.");
    } finally {
      setShipmentAction(null);
    }
  };

  const handleCancelShipment = async () => {
    if (!window.confirm("Cancel this shipment with the courier? This cannot be undone.")) return;
    setShipmentAction("cancel");
    setShipmentActionError("");
    setShipmentNotice("");
    try {
      await api.post(`/admin/orders/${orderId}/shipment/cancel`);
      setShipmentNotice("Shipment cancelled.");
      await fetchOrder();
    } catch (err: any) {
      setShipmentActionError(err.response?.data?.message || "Failed to cancel shipment.");
    } finally {
      setShipmentAction(null);
    }
  };

  const handleIssueRefund = async () => {
    const amountStr = window.prompt(`Enter Refund Amount in ₹ (Order Total: ₹${order.total}):`, String(order.total));
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0 || amount > order.total) {
      alert(`Invalid amount. Must be between ₹1 and ₹${order.total}`);
      return;
    }
    const reason = window.prompt("Enter Reason for Refund (e.g. Partial Return, Customer Compensation):", "Partial Refund");
    if (!reason) return;

    setStatusLoading(true);
    try {
      await api.post(`/admin/orders/${orderId}/refund`, { amount, reason });
      alert(`Refund of ₹${amount} initiated successfully!`);
      await fetchOrder();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      alert(e.response?.data?.message || "Failed to process refund");
    } finally {
      setStatusLoading(false);
    }
  };
  const getStatusColor = (status: string) => {
    switch(status) {
      case "DELIVERED": return "bg-[#eef0ff] text-[#003ea8] border-[#b4c5ff]";
      case "CANCELLED": return "bg-error-container/20 text-error border-error/20";
      case "PENDING": return "bg-secondary-container/10 text-secondary border-secondary/20";
      case "SHIPPED": return "bg-surface-container-high text-on-surface border-outline-variant/30";
      case "PROCESSING": return "bg-secondary-container/10 text-secondary border-secondary/20";
      case "CONFIRMED": return "bg-surface-container-high text-on-surface border-outline-variant/30";
      default: return "bg-surface-container-high text-on-surface border-outline-variant/30";
    }
  };

  if (loading) return <div className="p-8 text-center text-on-surface-variant">Loading order details...</div>;
  if (error) return <div className="p-8 text-error bg-error-container/20">{error}</div>;
  if (!data) return <div className="p-8 text-on-surface-variant">Order not found</div>;

  const { order, payment } = data;

  // Order Lifecycle Timeline Stage helper
  const getTimelineStages = () => {
    const isPaid = order.paymentStatus === 'PAID';
    const isConfirmed = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status);
    const isShipped = ['SHIPPED', 'DELIVERED'].includes(order.status);
    const isDelivered = order.status === 'DELIVERED';
    const isCancelled = order.status === 'CANCELLED';

    return [
      { id: 'placed', label: 'Order Placed', date: order.createdAt, status: 'complete' },
      { id: 'payment', label: 'Payment Received', date: isPaid ? (payment?.updatedAt || order.updatedAt) : null, status: isPaid ? 'complete' : isCancelled ? 'failed' : 'pending' },
      { id: 'confirmed', label: 'Order Confirmed', date: isConfirmed ? order.updatedAt : null, status: isConfirmed ? 'complete' : isCancelled ? 'failed' : 'pending' },
      { id: 'shipped', label: 'Order Shipped', date: isShipped ? (shipment?.shippedAt || order.updatedAt) : null, status: isShipped ? 'complete' : isCancelled ? 'failed' : 'pending' },
      { id: 'delivered', label: 'Order Delivered', date: isDelivered ? (shipment?.deliveredAt || order.updatedAt) : null, status: isDelivered ? 'complete' : isCancelled ? 'failed' : 'pending' },
    ];
  };

  const timelineStages = getTimelineStages();

  const shipmentProviderIsIntegrated = Boolean(shipment && shipment.provider !== "manual");
  const canSchedulePickup = Boolean(
    shipmentProviderIsIntegrated &&
      shipment &&
      !["PICKED_UP", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "NDR", "RTO", "CANCELLED"].includes(
        shipment.status
      )
  );
  const canCancelShipment = Boolean(
    shipment && !["DELIVERED", "CANCELLED", "RTO"].includes(shipment.status)
  );
  const trackingHistory = Array.isArray(shipment?.trackingHistory)
    ? shipment.trackingHistory
    : [];

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back Button */}
      <div>
        <Link href="/admin/orders" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px]">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO ORDERS
        </Link>
      </div>

      {/* Order Header & Actions */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-surface-container-lowest p-4 sm:p-6 rounded-xl border border-outline-variant/20 shadow-xs">
        <div className="w-full sm:w-auto">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
            <h2 className="font-headline-lg text-xl sm:text-2xl font-black text-on-surface">Order #{order.orderNumber}</h2>
            {order.partiallyCancelled && (
              <span className="px-2.5 py-0.5 rounded-full font-label-caps text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                Partially Cancelled
              </span>
            )}
            <span className={`px-2.5 py-0.5 border rounded-full font-label-caps text-[10px] flex items-center gap-1 ${getStatusColor(order.status)}`}>
              {order.status}
            </span>
          </div>
          <p className="font-body-sm text-xs sm:text-sm text-on-surface-variant flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">calendar_today</span>
            {new Date(order.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
          <button
            type="button"
            onClick={() => downloadOrViewInvoicePdf(order._id, `Invoice-${order.orderNumber}.pdf`)}
            className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-mono text-xs uppercase font-bold hover:bg-surface-container transition-colors flex items-center gap-1.5 min-h-[40px] cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Tax Invoice</span>
          </button>
          {order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && (
            <button
              type="button"
              onClick={handleIssueRefund}
              disabled={statusLoading}
              className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-mono text-xs uppercase font-bold hover:bg-surface-container transition-colors flex items-center gap-1.5 min-h-[40px] cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">currency_rupee</span>
              <span>Issue Refund</span>
            </button>
          )}
          {['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status) && (
            <>
              <button 
                type="button"
                onClick={() => handleOpenCancelItemsModal()}
                disabled={statusLoading}
                className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-error-container/10 text-error border border-error/20 rounded-lg font-mono text-xs uppercase font-bold hover:bg-error-container/20 transition-colors flex items-center gap-1.5 min-h-[40px] disabled:opacity-50 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">remove_shopping_cart</span>
                <span>Cancel Items</span>
              </button>
              <button 
                onClick={handleCancelOrder}
                disabled={statusLoading}
                className="flex-1 sm:flex-none justify-center px-3.5 py-2.5 bg-error-container/20 text-error border border-error/20 rounded-lg font-mono text-xs uppercase font-bold hover:bg-error-container/30 transition-colors flex items-center gap-1.5 min-h-[40px] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">cancel</span>
                <span>Cancel Order</span>
              </button>
            </>
          )}
          {order.status === 'CONFIRMED' && (
            <button 
              onClick={() => handleStatusChange('PROCESSING')}
              disabled={statusLoading}
              className="w-full sm:w-auto justify-center px-5 py-2.5 bg-primary text-on-primary rounded-lg font-mono text-xs uppercase font-bold hover:opacity-90 transition-opacity flex items-center gap-2 min-h-[40px] disabled:opacity-50"
            >
              <span>Move to Processing</span>
            </button>
          )}
          {order.status === 'PROCESSING' && (
            <button 
              onClick={() => {
                setDispatchMode("MANUAL");
                setIsShipmentModalOpen(true);
                setShipmentModalError("");
              }}
              disabled={statusLoading}
              className="flex-1 sm:flex-none justify-center px-4 py-2.5 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-mono text-xs uppercase font-bold hover:bg-surface-container transition-colors flex items-center gap-1.5 min-h-[40px] cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">local_shipping</span>
              <span>Manual Dispatch (Offline)</span>
            </button>
          )}
          {order.status === 'SHIPPED' && (
            <button 
              onClick={async () => {
                if (!confirm("Confirm delivery?")) return;
                setStatusLoading(true);
                try {
                  await api.patch(`/admin/orders/${orderId}/shipment`, { status: 'DELIVERED' });
                  await fetchOrder();
                } catch(err: any) {
                  alert(err.response?.data?.message || 'Failed to update delivery');
                } finally {
                  setStatusLoading(false);
                }
              }}
              disabled={statusLoading}
              className="w-full sm:w-auto justify-center px-5 py-2.5 bg-primary text-on-primary rounded-lg font-mono text-xs uppercase font-bold hover:opacity-90 transition-opacity flex items-center gap-2 min-h-[40px] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>Mark Delivered</span>
            </button>
          )}
        </div>
      </div>
      {/* Order Lifecycle Step Timeline Card */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-label-caps text-xs font-bold text-on-surface uppercase tracking-wider mb-4 sm:mb-6">Order Lifecycle Timeline</h3>
        {/* Desktop / Tablet view */}
        <div className="hidden md:flex justify-between items-center gap-2 relative">
          <div className="absolute top-5 left-8 right-8 h-0.5 bg-outline-variant/30 -translate-y-1/2 z-0" />
          {timelineStages.map((stage, idx) => {
            const isComplete = stage.status === 'complete';
            const isFailed = stage.status === 'failed';
            return (
              <div key={stage.id} className="flex-1 flex flex-col items-center text-center gap-2 relative z-10">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                    isComplete
                      ? 'bg-primary text-on-primary shadow-md'
                      : isFailed
                      ? 'bg-error-container text-error border border-error/30'
                      : 'bg-surface-container-high text-on-surface-variant/40 border border-outline-variant/40'
                  }`}
                >
                  {isComplete ? (
                    <span className="material-symbols-outlined text-[20px]">check</span>
                  ) : isFailed ? (
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className={`font-label-caps text-xs font-bold ${isComplete ? 'text-on-surface' : isFailed ? 'text-error' : 'text-on-surface-variant/60'}`}>
                    {stage.label}
                  </span>
                  {stage.date && (
                    <span className="text-[11px] text-on-surface-variant/70 font-mono mt-0.5">
                      {new Date(stage.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile View: Vertical Step Flow */}
        <div className="flex md:hidden flex-col gap-3.5 relative pl-2">
          <div className="absolute top-4 bottom-4 left-6 w-0.5 bg-outline-variant/30 z-0" />
          {timelineStages.map((stage, idx) => {
            const isComplete = stage.status === 'complete';
            const isFailed = stage.status === 'failed';
            return (
              <div key={stage.id} className="flex items-center gap-3 relative z-10">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                    isComplete
                      ? 'bg-primary text-on-primary shadow-sm'
                      : isFailed
                      ? 'bg-error-container text-error border border-error/30'
                      : 'bg-surface-container-high text-on-surface-variant/40 border border-outline-variant/40'
                  }`}
                >
                  {isComplete ? (
                    <span className="material-symbols-outlined text-[16px]">check</span>
                  ) : isFailed ? (
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-between min-w-0 bg-surface-container-low/40 p-2.5 rounded-lg border border-outline-variant/20">
                  <span className={`font-label-caps text-xs font-bold truncate ${isComplete ? 'text-on-surface' : isFailed ? 'text-error' : 'text-on-surface-variant/60'}`}>
                    {stage.label}
                  </span>
                  {stage.date && (
                    <span className="text-[10px] text-on-surface-variant font-mono shrink-0 ml-2">
                      {new Date(stage.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* Main Content Grid */}
      {/* Main Content Grid: Responsive 12-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Primary Operational Column (Left) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-6">
      {/* Warehouse Fulfillment Pipeline Card */}
      {fulfillment && (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-outline-variant/20">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">warehouse</span>
                <h3 className="font-label-caps text-xs font-bold text-on-surface uppercase tracking-wider">Warehouse Operations (Phase 10C)</h3>
              </div>
              <p className="text-xs text-on-surface-variant mt-1">Pick → Pack → Quality Check (QC) → Ready to Ship</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-full font-label-caps text-[11px] font-bold">
                {fulfillment.status}
              </span>
              <button
                type="button"
                onClick={handleDownloadPackingSlip}
                className="px-3 py-1.5 bg-surface-bright border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-[11px] hover:bg-surface-container transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">description</span>
                Packing Slip PDF
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {['UNALLOCATED', 'ALLOCATED'].includes(fulfillment.status) && (
              <button
                onClick={handlePickFulfillment}
                disabled={statusLoading}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                1. Pick Items
              </button>
            )}

            {['PICKED'].includes(fulfillment.status) && (
              <button
                onClick={handlePackFulfillment}
                disabled={statusLoading}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">package_2</span>
                2. Confirm Packing
              </button>
            )}

            {['PACKED'].includes(fulfillment.status) && (
              <>
                <button
                  onClick={() => handleQCFulfillment("PASSED")}
                  disabled={statusLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-label-caps text-xs hover:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">verified</span>
                  3. QC Pass
                </button>
                <button
                  onClick={() => handleQCFulfillment("FAILED")}
                  disabled={statusLoading}
                  className="px-4 py-2 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-xs hover:bg-error-container/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">dangerous</span>
                  3. QC Fail
                </button>
              </>
            )}

            {['QC_PASSED'].includes(fulfillment.status) && (
              <button
                onClick={handleReadyToShipFulfillment}
                disabled={statusLoading}
                className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                4. Mark Ready to Ship
              </button>
            )}

            {['READY_TO_SHIP', 'HANDED_OVER'].includes(fulfillment.status) && (
              <span className="text-xs text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-green-600 text-[18px]">check_circle</span>
                Fulfillment Complete ({fulfillment.status})
              </span>
            )}
          </div>
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-error-container/20 text-error rounded-md flex items-center gap-2 border border-error/20 font-body-sm">
          <span className="material-symbols-outlined">error</span>
          {actionError}
        </div>
      )}

      {/* NimbusPost Multi-Courier Rate Comparison (Available only when Fulfillment is READY_TO_SHIP and no shipment exists) */}
      {fulfillment && fulfillment.status === 'READY_TO_SHIP' && !shipment && (
        <NimbusPostCourierComparison
          orderId={orderId}
          destinationPostalCode={order.shippingAddress?.postalCode}
          fulfillment={fulfillment}
          onPackageConfirmed={fetchOrder}
        />
      )}

      {/* Guidance banner when fulfillment has not yet reached READY_TO_SHIP */}
      {fulfillment && fulfillment.status !== 'READY_TO_SHIP' && !shipment && ['CONFIRMED', 'PROCESSING'].includes(order.status) && (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[22px]">compare_arrows</span>
            <div>
              <p className="font-bold text-on-surface uppercase tracking-wide">
                NimbusPost Multi-Courier Comparison (Locked)
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Rate comparison activates automatically once warehouse fulfillment reaches <strong className="text-primary">READY_TO_SHIP</strong>. Current stage: <span className="font-bold uppercase text-on-surface">{fulfillment.status}</span>.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-surface-container-high rounded text-[10px] font-bold uppercase text-neutral-600 self-start sm:self-center shrink-0">
            Step 4: Ready to Ship Required
          </span>
        </div>
      )}

          {/* Order Items */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20 bg-surface-bright flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Order Items</h3>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{order.items.length} {order.items.length === 1 ? 'Item' : 'Items'}</span>
            </div>
            <div className="p-4 space-y-4">
              {order.items.map((item: any, i: number) => (
                <div key={i} className="flex flex-col sm:flex-row items-start gap-4 pb-4 border-b border-outline-variant/20 last:border-0 last:pb-0">
                  <div
                    onClick={() => handleOpenInspect(item)}
                    className="w-20 h-24 bg-surface-container-low rounded border border-outline-variant/20 overflow-hidden shrink-0 relative cursor-pointer group/img hover:border-primary transition-all"
                    title="Click to cross-confirm product details"
                  >
                    {item.productImage ? (
                      <Image src={item.productImage} alt={item.productName} fill className="object-cover group-hover/img:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-outline">
                        <span className="material-symbols-outlined">image</span>
                      </div>
                    )}
                    <span className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white transition-opacity">
                      <span className="material-symbols-outlined text-[20px]">zoom_in</span>
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4
                          onClick={() => handleOpenInspect(item)}
                          className="font-headline-sm text-[16px] text-on-surface truncate pr-2 hover:text-primary cursor-pointer transition-colors"
                          title="Click to cross-confirm product details"
                        >
                          {item.productName}
                        </h4>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-label-caps text-on-surface">Size: {item.selectedSize}</span>
                          <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-label-caps text-on-surface">Color: {item.selectedColor}</span>
                          {item.cancelledQuantity && item.cancelledQuantity > 0 ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              item.cancelledQuantity >= item.quantity
                                ? 'bg-error-container/20 text-error border border-error/20'
                                : 'bg-amber-100 text-amber-800 border border-amber-300'
                            }`}>
                              {item.cancelledQuantity >= item.quantity
                                ? 'CANCELLED'
                                : `CANCELLED: ${item.cancelledQuantity}/${item.quantity}`}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleOpenInspect(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-primary/10 hover:bg-primary hover:text-white text-primary rounded font-label-caps text-[10px] font-bold transition-colors cursor-pointer"
                            title="Cross-confirm product and view live inventory"
                          >
                            <span className="material-symbols-outlined text-[13px]">search_check</span>
                            <span>Cross-Confirm</span>
                          </button>
                          {['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status) && (item.quantity - (item.cancelledQuantity || 0) > 0) && (
                            <button
                              type="button"
                              onClick={() => handleOpenCancelItemsModal(item._id)}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-error-container/10 hover:bg-error-container/20 text-error rounded font-label-caps text-[10px] font-bold transition-colors cursor-pointer"
                              title="Cancel remaining quantity of this item"
                            >
                              <span className="material-symbols-outlined text-[13px]">cancel</span>
                              <span>Cancel Item</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-price-lg text-[18px] ${(item.cancelledQuantity || 0) >= item.quantity ? 'line-through text-outline' : 'text-on-surface'}`}>
                          ₹{item.unitPrice.toLocaleString()}
                        </div>
                        {item.cancelledValue ? (
                          <span className="text-[11px] font-mono text-error block">Refunded: ₹{item.cancelledValue}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-4">
                      <div className="font-body-sm text-body-sm text-on-surface-variant">
                        Qty: {item.quantity}
                        {item.cancelledQuantity && item.cancelledQuantity > 0 ? (
                          <span className="text-error font-medium ml-1.5">
                            ({item.quantity - item.cancelledQuantity} active, {item.cancelledQuantity} cancelled)
                          </span>
                        ) : null}
                      </div>
                      <div className={`text-right font-price-lg text-[18px] pt-1 ${(item.cancelledQuantity || 0) >= item.quantity ? 'line-through text-outline' : 'text-on-surface'}`}>
                        Total: ₹{item.lineTotal.toLocaleString()}
                      </div>
                    </div>

                    {(item.isCustomized || item.customDesignId || item.designFiles?.length || item.customizationNotes) && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/20">
                        <StaffMockupManager orderId={order._id} item={item} onRefresh={fetchOrder} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Secondary Context & Financials Column (Right / Sticky) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6 lg:sticky lg:top-6">
          {/* Customer Card */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => router.push(`/admin/customers/${order.userId?._id}`)}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-headline-sm text-[16px] text-on-surface">Customer</h3>
              <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors text-[20px]">arrow_outward</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface font-headline-sm font-bold uppercase">
                {order.userId?.name?.substring(0, 2) || "U"}
              </div>
              <div>
                <p className="font-headline-sm text-[15px] text-on-surface">{order.userId?.name || "Unknown Customer"}</p>
              </div>
            </div>
            <div className="space-y-2 font-body-sm text-[13px] text-on-surface-variant break-all">
              <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">mail</span> {order.userId?.email}</p>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4">Shipping Address</h3>
            <div className="font-body-sm text-[13px] text-on-surface space-y-1">
              <p className="font-medium text-foreground">{order.shippingAddress.fullName}</p>
              <p className="text-on-surface-variant">{order.shippingAddress.addressLine1}</p>
              {order.shippingAddress.addressLine2 && <p className="text-on-surface-variant">{order.shippingAddress.addressLine2}</p>}
              <p className="text-on-surface-variant">{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
              <p className="text-on-surface-variant">{order.shippingAddress.country}</p>
              {order.shippingAddress.phone && (
                <p className="text-on-surface-variant font-mono pt-1">Phone: {order.shippingAddress.phone}</p>
              )}
              {order.shippingAddress.alternatePhone && (
                <p className="text-on-surface-variant font-mono text-xs">Alt Phone: {order.shippingAddress.alternatePhone}</p>
              )}
            </div>
          </div>

          {/* Logistics */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4">Logistics</h3>
            
            {shipment ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">Shipping Courier</p>
                    <p className="font-body-sm text-[14px] text-on-surface truncate">{shipment.carrier}</p>
                    <p className="font-label-caps text-[11px] text-primary mt-1 font-medium break-all">
                      AWB: {shipment.awbNumber || shipment.trackingNumber}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded border font-label-caps text-[10px] font-bold ${getShipmentStatusClass(shipment.status)}`}>
                    {shipment.status}
                  </span>
                </div>

                {shipment.pickupRequestedAt && (
                  <p className="font-mono text-[10px] text-on-surface-variant leading-relaxed">
                    Pickup requested: {formatIstDateTime(shipment.pickupRequestedAt)} IST
                    {shipment.pickupId ? ` · ID ${shipment.pickupId}` : ""}
                  </p>
                )}

                {shipmentNotice && (
                  <div className="p-2.5 bg-green-50 text-green-800 border border-green-200 rounded-lg text-[11px] font-mono flex items-start gap-1.5">
                    <span className="material-symbols-outlined text-[16px] shrink-0">check_circle</span>
                    <span>{shipmentNotice}</span>
                  </div>
                )}

                {shipmentActionError && (
                  <div className="p-2.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-[11px] font-mono flex items-start gap-1.5">
                    <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
                    <span>{shipmentActionError}</span>
                  </div>
                )}

                {canSchedulePickup && (
                  <div className="p-3 bg-surface-container-low/60 border border-outline-variant/30 rounded-lg space-y-2">
                    <label htmlFor="pickup-date" className="block font-label-caps text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                      Courier pickup date
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="pickup-date"
                        type="date"
                        value={pickupDate}
                        min={istDateInputValue(0)}
                        onChange={(e) => setPickupDate(e.target.value)}
                        disabled={shipmentAction !== null}
                        className="flex-1 min-w-0 min-h-[38px] px-3 py-2 bg-surface-bright border border-outline-variant/30 rounded-lg font-mono text-xs text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={handleRequestPickup}
                        disabled={shipmentAction !== null || !pickupDate}
                        className="min-h-[38px] px-4 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-[11px] uppercase font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span className={`material-symbols-outlined text-[16px] ${shipmentAction === "pickup" ? "animate-spin" : ""}`}>
                          {shipmentAction === "pickup" ? "sync" : "event_available"}
                        </span>
                        {shipmentAction === "pickup"
                          ? "Requesting..."
                          : shipment.status === "PICKUP_REQUESTED"
                          ? "Re-schedule Pickup"
                          : "Schedule Pickup"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadShippingLabel}
                    className="min-h-[38px] py-2 bg-surface-bright border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-[11px] hover:bg-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">label</span>
                    Print Shipping Label (4x6)
                  </button>

                  {shipmentProviderIsIntegrated && shipment.status !== "CANCELLED" && (
                    <button
                      type="button"
                      onClick={handleRefreshTracking}
                      disabled={shipmentAction !== null}
                      className="min-h-[38px] py-2 bg-surface-bright border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-[11px] hover:bg-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${shipmentAction === "tracking" ? "animate-spin" : ""}`}>
                        {shipmentAction === "tracking" ? "sync" : "tracking"}
                      </span>
                      {shipmentAction === "tracking" ? "Refreshing..." : "Refresh Tracking"}
                    </button>
                  )}

                  {canCancelShipment && (
                    <button
                      type="button"
                      onClick={handleCancelShipment}
                      disabled={shipmentAction !== null}
                      className="sm:col-span-2 min-h-[38px] py-2 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-[11px] hover:bg-error-container/30 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${shipmentAction === "cancel" ? "animate-spin" : ""}`}>
                        {shipmentAction === "cancel" ? "sync" : "cancel"}
                      </span>
                      {shipmentAction === "cancel" ? "Cancelling..." : "Cancel Shipment"}
                    </button>
                  )}
                </div>

                {trackingHistory.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowTrackingHistory((current) => !current)}
                      aria-expanded={showTrackingHistory}
                      className="w-full flex items-center justify-between gap-2 text-left font-label-caps text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface cursor-pointer"
                    >
                      <span>Tracking History ({trackingHistory.length})</span>
                      <span className="material-symbols-outlined text-[18px]">
                        {showTrackingHistory ? "expand_less" : "expand_more"}
                      </span>
                    </button>

                    {showTrackingHistory && (
                      <ol className="mt-2 space-y-3 border-l-2 border-outline-variant/30 pl-3 max-h-64 overflow-y-auto">
                        {trackingHistory.slice(-10).reverse().map((event: any, index: number) => (
                          <li key={event.providerEventId || `${event.status}-${index}`} className="relative font-mono text-[11px]">
                            <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-primary" />
                            <p className="font-bold text-on-surface">{event.status}</p>
                            <p className="text-on-surface-variant">{event.description}</p>
                            <p className="text-[10px] text-outline mt-0.5">
                              {formatIstDateTime(event.timestamp)} IST
                              {event.location ? ` · ${event.location}` : ""}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="font-body-sm text-[13px] text-on-surface-variant italic">No shipment tracking data created yet.</p>
            )}
          </div>

          {/* Financials & Payment */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20 bg-surface-bright flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Financial Summary</h3>
              <span className={`px-2 py-1 rounded font-label-caps text-[10px] border ${
                order.paymentStatus === 'PAID' ? 'bg-primary-container/20 text-primary border-primary/20' : 
                'bg-surface-container-high text-on-surface border-outline-variant/30'
              }`}>
                {order.paymentStatus}
              </span>
            </div>
            <div className="p-6">
              <div className="space-y-3 font-body-sm text-body-sm text-on-surface">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Subtotal</span>
                  <span>₹{order.subtotal.toLocaleString()}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-secondary">
                    <span>Discount</span>
                    <span>-₹{order.discount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Shipping</span>
                  <span>₹{order.shipping.toLocaleString()}</span>
                </div>
                <div className="h-px bg-outline-variant/20 my-2"></div>
                <div className="flex justify-between items-center pt-2">
                  <span className="font-headline-sm text-[16px]">Grand Total</span>
                  <span className="font-price-lg text-[24px]">₹{order.total.toLocaleString()}</span>
                </div>
                {refunds && refunds.length > 0 && (
                  <div className="pt-4 border-t border-outline-variant/20 space-y-2">
                    <span className="font-label-caps text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block">
                      Refunds Issued ({refunds.length})
                    </span>
                    {refunds.map((ref: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs bg-surface-container/50 p-2.5 rounded-lg border border-outline-variant/10">
                        <div>
                          <span className="font-semibold text-error">₹{ref.amount} refunded</span>
                          <span className="text-on-surface-variant block text-[11px]">{ref.reason || 'Partial / Full Refund'}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ref.status === 'PROCESSED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {ref.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="h-8"></div>
      {/* Product Cross-Confirmation Modal */}
      {inspectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest w-full max-w-2xl rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-outline-variant/20 bg-surface flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">fact_check</span>
                </span>
                <div>
                  <h3 className="font-headline-sm text-base font-bold text-on-surface">Product Cross-Confirmation</h3>
                  <p className="text-xs text-on-surface-variant font-mono">Verify ordered variant against live catalog &amp; warehouse inventory</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setInspectItem(null); setInspectProductData(null); }}
                className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Top Summary Card */}
              <div className="flex flex-col sm:flex-row gap-5 p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
                <div className="w-24 h-32 bg-surface-container rounded-lg overflow-hidden relative shrink-0 border border-outline-variant/40">
                  {inspectItem.productImage ? (
                    <Image src={inspectItem.productImage} alt={inspectItem.productName} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-outline">
                      <span className="material-symbols-outlined text-3xl">image</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-headline-sm text-lg font-bold text-on-surface leading-snug">
                        {inspectItem.productName}
                      </h4>
                      {inspectProductData?.slug && (
                        <p className="text-xs text-on-surface-variant font-mono">Slug: /{inspectProductData.slug}</p>
                      )}
                    </div>
                    {inspectProductData?.status && (
                      <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${
                        inspectProductData.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-800"
                      }`}>
                        {inspectProductData.status}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-outline-variant/20 font-mono text-xs">
                    <div>
                      <span className="text-on-surface-variant text-[11px] block">ORDERED PRICE</span>
                      <strong className="text-on-surface text-sm">₹{Number(inspectItem.unitPrice || 0).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span className="text-on-surface-variant text-[11px] block">QUANTITY</span>
                      <strong className="text-on-surface text-sm">{inspectItem.quantity} unit{inspectItem.quantity > 1 ? "s" : ""}</strong>
                    </div>
                    <div>
                      <span className="text-on-surface-variant text-[11px] block">LINE TOTAL</span>
                      <strong className="text-primary text-sm font-bold">₹{Number(inspectItem.lineTotal || (inspectItem.unitPrice * inspectItem.quantity) || 0).toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cross-Check Table: Ordered Variant vs In-Stock Catalog Variant */}
              <div className="border border-outline-variant/30 rounded-xl overflow-hidden bg-surface">
                <div className="p-3.5 bg-surface-bright border-b border-outline-variant/30 flex justify-between items-center">
                  <span className="font-mono text-xs font-bold uppercase text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">verified</span>
                    Variant Cross-Check
                  </span>
                  {inspectLoading && (
                    <span className="text-xs text-primary font-mono animate-pulse">Syncing live warehouse stock...</span>
                  )}
                </div>

                <div className="p-4 space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20">
                      <span className="text-[10px] text-on-surface-variant uppercase font-bold block mb-1">CUSTOMER SELECTION</span>
                      <p className="text-sm font-bold text-on-surface">Size: <span className="text-primary">{inspectItem.selectedSize || "N/A"}</span></p>
                      <p className="text-sm font-bold text-on-surface mt-1">Color: <span className="text-primary">{inspectItem.selectedColor || "N/A"}</span></p>
                    </div>

                    <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20">
                      <span className="text-[10px] text-on-surface-variant uppercase font-bold block mb-1">CATALOG STOCK STATUS</span>
                      {(() => {
                        const variants = inspectProductData?.variants || (typeof inspectItem.productId === "object" ? inspectItem.productId?.variants : []) || [];
                        const matched = variants.find((v: any) =>
                          (v.size || "").toUpperCase() === (inspectItem.selectedSize || "").toUpperCase() &&
                          (v.color || "").toLowerCase() === (inspectItem.selectedColor || "").toLowerCase()
                        );

                        if (!matched) {
                          return (
                            <p className="text-xs text-on-surface-variant italic mt-1">
                              Variant not explicitly tracked or custom specification.
                            </p>
                          );
                        }

                        const stock = Number(matched.stock || 0);
                        return (
                          <div>
                            <p className="text-xs font-bold text-on-surface">SKU: <span className="text-on-surface-variant">{matched.sku || "N/A"}</span></p>
                            <p className="text-xs font-bold mt-1">
                              Stock: <span className={stock > 10 ? "text-emerald-700" : stock > 0 ? "text-amber-700" : "text-red-700"}>
                                {stock} units available
                              </span>
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Garment Specifications if available */}
                  {(inspectProductData?.fabric || inspectProductData?.gsm || inspectProductData?.fit) && (
                    <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/20 grid grid-cols-3 gap-2 text-[11px]">
                      {inspectProductData.fabric && <div><span className="text-on-surface-variant block">FABRIC</span><strong>{inspectProductData.fabric}</strong></div>}
                      {inspectProductData.gsm && <div><span className="text-on-surface-variant block">WEIGHT</span><strong>{inspectProductData.gsm} GSM</strong></div>}
                      {inspectProductData.fit && <div><span className="text-on-surface-variant block">FIT</span><strong>{inspectProductData.fit}</strong></div>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 border-t border-outline-variant/20 bg-surface flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {(() => {
                  const pId = typeof inspectItem.productId === "object" ? inspectItem.productId?._id : inspectItem.productId;
                  const pSlug = inspectProductData?.slug || (typeof inspectItem.productId === "object" ? inspectItem.productId?.slug : "");

                  return (
                    <>
                      {pId && (
                        <Link
                          href={`/admin/products/${pId}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-high text-on-surface font-label-caps text-xs font-bold hover:bg-surface-container-highest transition-colors flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                          <span>Edit in Product Catalog</span>
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </Link>
                      )}
                      {pSlug && (
                        <Link
                          href={`/shop/${pSlug}${inspectItem.selectedColor ? `?color=${encodeURIComponent(inspectItem.selectedColor)}` : ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 rounded-lg border border-outline-variant bg-surface-container-high text-on-surface font-label-caps text-xs font-bold hover:bg-surface-container-highest transition-colors flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                          <span>View on Storefront</span>
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </Link>
                      )}
                    </>
                  );
                })()}
              </div>

              <button
                type="button"
                onClick={() => { setInspectItem(null); setInspectProductData(null); }}
                className="px-5 py-2 bg-neutral-900 text-white font-label-caps text-xs font-bold rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Accessible Shipment Dispatch Dialog Modal */}
      {isShipmentModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shipment-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        >
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col p-4 sm:p-6 space-y-4 sm:space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">local_shipping</span>
                <h2 id="shipment-dialog-title" className="font-headline-sm text-base font-bold text-on-surface uppercase">
                  Manual Courier Dispatch (Offline)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsShipmentModalOpen(false)}
                className="p-1 text-on-surface-variant hover:text-on-surface rounded"
                aria-label="Close shipment dialog"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {shipmentModalError && (
              <div className="p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
                {shipmentModalError}
              </div>
            )}

            <form onSubmit={handleDispatchShipment} className="space-y-4">
              <div className="p-3 bg-surface-container-low rounded-lg text-xs font-mono text-neutral-600 border border-outline-variant/30 space-y-1">
                <p className="font-bold text-on-surface">Offline / Manual Carrier Mode</p>
                <p className="text-[11px] text-neutral-500">
                  Use this modal to enter tracking numbers for offline or local couriers. For integrated multi-carrier dispatch (Delhivery, BlueDart, Shadowfax, etc.), use the NimbusPost rate comparison above.
                </p>
              </div>
              <div className="space-y-3 p-3 bg-surface-container-low/50 rounded-lg border border-outline-variant/30">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase font-bold text-on-surface">
                    Carrier Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={manualCarrierInput}
                    onChange={(e) => setManualCarrierInput(e.target.value)}
                    placeholder="e.g. Delhivery, BlueDart, DTDC, Local Transport"
                    required
                    className="w-full px-3 py-2 text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase font-bold text-on-surface">
                    Tracking / AWB Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={manualAwbInput}
                    onChange={(e) => setManualAwbInput(e.target.value)}
                    placeholder="e.g. 143289012345"
                    required
                    className="w-full px-3 py-2 text-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                  />
                </div>
              </div>

              {/* Package Dimensions & Weight */}
              <div className="space-y-1.5">
                <label className="font-mono text-[11px] uppercase font-bold text-on-surface">
                  Package Specifications
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                  <div>
                    <span className="block text-[10px] font-mono text-neutral-400 mb-0.5">WEIGHT (g)</span>
                    <input
                      type="number"
                      min="1"
                      value={weightGramsInput}
                      onChange={(e) => setWeightGramsInput(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-mono text-neutral-400 mb-0.5">L (cm)</span>
                    <input
                      type="number"
                      min="1"
                      value={lengthCmInput}
                      onChange={(e) => setLengthCmInput(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-mono text-neutral-400 mb-0.5">W (cm)</span>
                    <input
                      type="number"
                      min="1"
                      value={widthCmInput}
                      onChange={(e) => setWidthCmInput(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-mono text-neutral-400 mb-0.5">H (cm)</span>
                    <input
                      type="number"
                      min="1"
                      value={heightCmInput}
                      onChange={(e) => setHeightCmInput(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-outline-variant/20 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsShipmentModalOpen(false)}
                  disabled={statusLoading}
                  className="px-4 py-2 font-mono text-xs uppercase font-bold text-neutral-600 hover:text-black rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusLoading}
                  className="px-5 py-2 bg-primary text-on-primary font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {statusLoading ? "Creating..." : "Confirm & Dispatch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Cancel Items Modal */}
      {isCancelItemsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-outline-variant/20 bg-surface flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-error-container/20 text-error rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">remove_shopping_cart</span>
                </span>
                <div>
                  <h3 className="font-headline-sm text-base font-bold text-on-surface">Cancel Order Items</h3>
                  <p className="text-xs text-on-surface-variant font-mono">Order #{order.orderNumber}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCancelItemsModalOpen(false)}
                className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {cancelItemsError && (
                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-mono font-bold">
                  {cancelItemsError}
                </div>
              )}

              <p className="text-xs text-on-surface-variant leading-relaxed">
                Cancelling items restores inventory and calculates prorated refunds for paid orders. If all items become cancelled, the order is automatically marked CANCELLED.
              </p>

              <div className="space-y-3">
                <span className="block text-xs font-label-caps uppercase text-on-surface font-bold">
                  Select Items &amp; Quantity to Cancel
                </span>
                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {order.items
                    .filter((it: any) => (it.quantity - (it.cancelledQuantity || 0)) > 0)
                    .map((item: any) => {
                      const remaining = item.quantity - (itCancelledQty(item) || 0);
                      const selectedQty = adminCancelItemsMap[item._id] || 0;
                      const isSelected = selectedQty > 0;
                      const discountRatio = order.subtotal > 0 ? ((order.discount || 0) / order.subtotal) : 0;
                      const unitPrice = (item.lineTotal / (item.quantity || 1)) * (1 - discountRatio);
                      const lineRefund = Math.round(selectedQty * unitPrice);

                      function itCancelledQty(it: any) {
                        return it.cancelledQuantity || 0;
                      }

                      return (
                        <div
                          key={item._id}
                          className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-red-50/50 border-red-200"
                              : "bg-surface-container-low/50 border-outline-variant/20"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                setAdminCancelItemsMap((prev) => ({
                                  ...prev,
                                  [item._id]: e.target.checked ? remaining : 0,
                                }));
                              }}
                              className="w-4 h-4 rounded text-error focus:ring-error cursor-pointer"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-on-surface truncate">{item.productName}</p>
                              <p className="text-[11px] text-on-surface-variant font-mono">
                                {item.selectedSize} / {item.selectedColor} · Max active: {remaining}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {isSelected && (
                              <select
                                value={selectedQty}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setAdminCancelItemsMap((prev) => ({
                                    ...prev,
                                    [item._id]: val,
                                  }));
                                }}
                                className="text-xs font-mono font-bold bg-surface-bright border border-outline-variant/50 rounded-lg p-1 text-on-surface"
                              >
                                {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>
                                    Qty: {n}
                                  </option>
                                ))}
                              </select>
                            )}
                            <span className="text-xs font-bold font-mono text-on-surface min-w-[55px] text-right">
                              {isSelected ? `₹${lineRefund}` : `₹${item.unitPrice}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {order.paymentStatus === 'PAID' && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs flex justify-between items-center text-green-900">
                  <span className="font-medium">Estimated Prorated Refund:</span>
                  <span className="font-bold text-sm font-mono">
                    ₹{(() => {
                      const discountRatio = order.subtotal > 0 ? ((order.discount || 0) / order.subtotal) : 0;
                      let est = 0;
                      for (const item of order.items) {
                        const q = adminCancelItemsMap[item._id] || 0;
                        if (q > 0) {
                          const unitPrice = (item.lineTotal / (item.quantity || 1)) * (1 - discountRatio);
                          est += Math.round(q * unitPrice);
                        }
                      }
                      return est.toLocaleString();
                    })()}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-mono font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                  Cancellation Reason / Note
                </label>
                <input
                  type="text"
                  value={adminCancelReason}
                  onChange={(e) => setAdminCancelReason(e.target.value)}
                  placeholder="e.g. Customer requested via phone, out of stock, etc."
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/50 rounded-lg text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-outline-variant/20 bg-surface flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCancelItemsModalOpen(false)}
                disabled={cancelItemsLoading}
                className="px-4 py-2 font-mono text-xs uppercase font-bold text-neutral-600 hover:text-black rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleAdminCancelItems}
                disabled={cancelItemsLoading}
                className="px-5 py-2 bg-error-container/20 text-error border border-error/30 hover:bg-error-container/30 font-mono text-xs uppercase font-bold tracking-wider rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {cancelItemsLoading ? "Processing..." : "Confirm Item Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
