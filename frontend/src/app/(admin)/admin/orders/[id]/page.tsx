"use client";

import { useEffect, useState, use } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

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

  const fetchOrder = async () => {
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
  };

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

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

  const handleRefund = async (amount: number, reason: string) => {
    setStatusLoading(true);
    setActionError("");
    try {
      await api.post(`/admin/orders/${orderId}/refund`, { amount, reason });
      await fetchOrder();
      alert("Refund initiated successfully!");
    } catch (err: any) {
      setActionError(err.response?.data?.message || "Failed to initiate refund");
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

  const { order, payment, paymentAttempts } = data;

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
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/admin/orders/${order._id}/fulfillment/packing-slip`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-surface-bright border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-[11px] hover:bg-surface-container transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">description</span>
                Packing Slip PDF
              </a>
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
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/orders/${order._id}/invoice/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-label-caps hover:bg-surface-container transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Tax Invoice
          </a>
          {order.status === 'PENDING' && (
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
              onClick={async () => {
                const carrier = window.prompt("Enter Carrier Name (e.g. Delhivery Express):", "Delhivery Express");
                if (!carrier) return;
                const trackingNumber = window.prompt("Enter Tracking / AWB Number:");
                if (!trackingNumber) return;
                
                setStatusLoading(true);
                try {
                  await api.post(`/admin/orders/${orderId}/shipment`, { 
                    carrier, trackingNumber
                  });
                  await fetchOrder();
                } catch(err: any) {
                  alert(err.response?.data?.message || 'Failed to create shipment');
                } finally {
                  setStatusLoading(false);
                }
              }}
              disabled={statusLoading}
              className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50"
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
                  <div className="w-20 h-24 bg-surface-container-low rounded border border-outline-variant/20 overflow-hidden shrink-0 relative">
                    {item.productImage ? (
                      <Image src={item.productImage} alt={item.productName} fill className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-outline">
                        <span className="material-symbols-outlined">image</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-headline-sm text-[16px] text-on-surface truncate pr-2">{item.productName}</h4>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-label-caps text-on-surface">Size: {item.selectedSize}</span>
                          <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-label-caps text-on-surface">Color: {item.selectedColor}</span>
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
              </>
            ) : (
              <p className="font-body-sm text-[13px] text-on-surface-variant italic">No shipment tracking data created yet.</p>
            )}
          </div>
        </div>
      </div>
      
      <div className="h-8"></div>
    </div>
  );
}
