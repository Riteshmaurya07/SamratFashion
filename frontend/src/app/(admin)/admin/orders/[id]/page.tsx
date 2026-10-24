"use client";

import { useEffect, useState, use, useCallback } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { StaffMockupManager } from "@/components/admin/StaffMockupManager";
import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";

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
  const [carrierInput, setCarrierInput] = useState("Delhivery Express");
  const [awbInput, setAwbInput] = useState("");
  const [parcelWeight, setParcelWeight] = useState("0.5");
  const [shipmentModalError, setShipmentModalError] = useState("");

  const handleDispatchShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!awbInput.trim()) {
      setShipmentModalError("Tracking / AWB Number is required");
      return;
    }
    setStatusLoading(true);
    setShipmentModalError("");
    try {
      await api.post(`/admin/orders/${orderId}/shipment`, {
        carrier: carrierInput.trim(),
        trackingNumber: awbInput.trim()
      });
      setIsShipmentModalOpen(false);
      setAwbInput("");
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

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back Button */}
      <div>
        <Link href="/admin/orders" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px]">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO ORDERS
        </Link>
      </div>

      {/* Order Lifecycle Step Timeline Card */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 shadow-sm">
        <h3 className="font-label-caps text-xs font-bold text-on-surface uppercase tracking-wider mb-6">Order Lifecycle Timeline</h3>
        <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-6 md:gap-2">
          {timelineStages.map((stage, idx) => {
            const isComplete = stage.status === 'complete';
            const isFailed = stage.status === 'failed';

            return (
              <div key={stage.id} className="flex-1 flex md:flex-col items-center md:text-center gap-4 md:gap-2 w-full relative z-10">
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
      </div>

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

      {/* Order Header & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_4px_20px_rgba(15,23,42,0.02)]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-headline-lg text-headline-lg text-on-surface">Order #{order.orderNumber}</h2>
            <span className={`px-3 py-1 border rounded-full font-label-caps text-[10px] flex items-center gap-1 ${getStatusColor(order.status)}`}>
              {order.status}
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">calendar_today</span>
            {new Date(order.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            type="button"
            onClick={() => downloadOrViewInvoicePdf(order._id, `Invoice-${order.orderNumber}.pdf`)}
            className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-label-caps hover:bg-surface-container transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Tax Invoice
          </button>
          {order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && (
            <button
              type="button"
              onClick={handleIssueRefund}
              disabled={statusLoading}
              className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-label-caps hover:bg-surface-container transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">currency_rupee</span>
              Issue Refund
            </button>
          )}
          {['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status) && (
            <button 
              onClick={handleCancelOrder}
              disabled={statusLoading}
              className="px-4 py-2 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-label-caps hover:bg-error-container/30 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
              Cancel Order
            </button>
          )}
          {order.status === 'CONFIRMED' && (
            <button 
              onClick={() => handleStatusChange('PROCESSING')}
              disabled={statusLoading}
              className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50"
            >
              Move to Processing
            </button>
          )}
          {order.status === 'PROCESSING' && (
            <button 
              onClick={() => {
                setIsShipmentModalOpen(true);
                setShipmentModalError("");
              }}
              disabled={statusLoading}
              className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50 cursor-pointer"
            >
              Create Courier Shipment
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
              className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50"
            >
              Mark Delivered
            </button>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="xl:col-span-2 space-y-6">
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
                          <button
                            type="button"
                            onClick={() => handleOpenInspect(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-primary/10 hover:bg-primary hover:text-white text-primary rounded font-label-caps text-[10px] font-bold transition-colors cursor-pointer"
                            title="Cross-confirm product and view live inventory"
                          >
                            <span className="material-symbols-outlined text-[13px]">search_check</span>
                            <span>Cross-Confirm</span>
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-price-lg text-[18px] text-on-surface">₹{item.unitPrice.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-end mt-4">
                      <div className="font-body-sm text-body-sm text-on-surface-variant">
                        Qty: {item.quantity}
                      </div>
                      <div className="text-right font-price-lg text-[18px] text-on-surface pt-1">
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

        {/* Right Column */}
        <div className="space-y-6">
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
            </div>
          </div>

          {/* Logistics */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4">Logistics</h3>
            
            {shipment ? (
              <>
                <div className="mb-4">
                  <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">Shipping Courier</p>
                  <p className="font-body-sm text-[14px] text-on-surface">{shipment.carrier}</p>
                  <p className="font-label-caps text-[11px] text-primary mt-1 font-medium">AWB: {shipment.trackingNumber}</p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadShippingLabel}
                  className="w-full py-2 bg-surface-bright border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-[11px] hover:bg-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer mt-2"
                >
                  <span className="material-symbols-outlined text-[16px]">label</span>
                  Print Shipping Label (4x6)
                </button>
              </>
            ) : (
              <p className="font-body-sm text-[13px] text-on-surface-variant italic">No shipment tracking data created yet.</p>
            )}
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
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">local_shipping</span>
                <h2 id="shipment-dialog-title" className="font-headline-sm text-base font-bold text-on-surface uppercase">
                  Dispatch Courier Shipment
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
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Courier / Carrier Partner
                </label>
                <select
                  value={carrierInput}
                  onChange={(e) => setCarrierInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                >
                  <option value="Delhivery Express">Delhivery Express</option>
                  <option value="BlueDart Air">BlueDart Air</option>
                  <option value="DTDC Surface">DTDC Surface</option>
                  <option value="Speed Post">India Post Speed Post</option>
                  <option value="Manual / Self Pickup">Manual / Self Pickup</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Tracking / AWB Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={awbInput}
                  onChange={(e) => setAwbInput(e.target.value)}
                  placeholder="e.g. 143289012345"
                  required
                  className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface placeholder:text-neutral-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-mono text-[11px] uppercase text-on-surface-variant font-bold">
                    Parcel Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={parcelWeight}
                    onChange={(e) => setParcelWeight(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg font-mono focus:outline-none focus:border-primary text-on-surface"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-mono text-[11px] uppercase text-on-surface-variant font-bold">
                    Package Tier
                  </label>
                  <input
                    type="text"
                    value="Standard Streetwear Box"
                    readOnly
                    className="w-full px-3 py-2 text-xs bg-surface-container-low/50 border border-outline-variant/30 rounded-lg font-mono text-neutral-500"
                  />
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
    </div>
  );
}
