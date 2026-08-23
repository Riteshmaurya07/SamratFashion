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

  const validTransitions: Record<string, string[]> = {
    'PENDING': ['CONFIRMED'],
    'CONFIRMED': ['PROCESSING'],
    'PROCESSING': ['SHIPPED'],
    'SHIPPED': ['DELIVERED'],
    'DELIVERED': [],
    'CANCELLED': []
  };
  const availableTransitions = validTransitions[order.status] || [];

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back Button */}
      <div>
        <Link href="/admin/orders" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px]">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO ORDERS
        </Link>
      </div>

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
                const carrier = window.prompt("Enter Carrier Name (e.g. BlueDart):");
                if (!carrier) return;
                const trackingNumber = window.prompt("Enter Tracking Number:");
                if (!trackingNumber) return;
                const trackingUrl = window.prompt("Enter Tracking URL (Optional):");
                
                setStatusLoading(true);
                try {
                  await api.post(`/admin/orders/${orderId}/shipment`, { 
                    carrier, trackingNumber, trackingUrl: trackingUrl || undefined 
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
              Create Shipment
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
        {/* Left Column (Wider) */}
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

              {payment && (
                <div className="mt-6 pt-4 border-t border-outline-variant/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface-container-low rounded flex items-center justify-center">
                        <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
                      </div>
                      <div>
                        <p className="font-headline-sm text-[14px] text-on-surface">Paid via {payment.provider}</p>
                        <p className="font-label-caps text-[10px] text-on-surface-variant">ID: {payment._id}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs mt-4 bg-surface-container-low p-4 rounded-lg">
                    <div>
                      <span className="text-on-surface-variant block mb-1">Captured Amount</span>
                      <span className="font-medium text-on-surface text-sm">₹{payment.amount.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block mb-1">Refunded Amount</span>
                      <span className="font-medium text-error text-sm">₹{(payment.refundedAmount || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  {refunds.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <h4 className="font-label-caps text-[10px] text-on-surface-variant mb-2">REFUND HISTORY</h4>
                      {refunds.map((r: any) => (
                        <div key={r._id} className="p-3 border border-outline-variant/20 rounded-md text-xs bg-surface-bright">
                          <div className="flex justify-between font-semibold mb-1">
                            <span className={r.status === 'PROCESSED' ? 'text-green-600' : r.status === 'FAILED' ? 'text-error' : 'text-secondary'}>{r.status}</span>
                            <span>₹{r.amount.toLocaleString()}</span>
                          </div>
                          <div className="text-on-surface-variant">{new Date(r.createdAt).toLocaleString()}</div>
                          {r.razorpayRefundId && <div className="text-on-surface-variant mt-1">ID: {r.razorpayRefundId}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {payment.status === 'CAPTURED' && payment.amount > (payment.refundedAmount || 0) && (
                    <div className="mt-6 border-t border-outline-variant/20 pt-4">
                      <button
                        onClick={() => {
                          const maxRefund = payment.amount - (payment.refundedAmount || 0);
                          const amtStr = window.prompt(`Enter refund amount (Max: ₹${maxRefund}):`, maxRefund.toString());
                          if (!amtStr) return;
                          const amount = parseFloat(amtStr);
                          if (isNaN(amount) || amount <= 0 || amount > maxRefund) {
                            alert("Invalid amount");
                            return;
                          }
                          const reason = window.prompt("Enter reason for refund:", "Admin initiated refund");
                          if (reason === null) return;
                          
                          if (window.confirm(`WARNING: This initiates a REAL payment refund of ₹${amount} via Razorpay. Are you sure?`)) {
                            handleRefund(amount, reason);
                          }
                        }}
                        disabled={statusLoading}
                        className="w-full py-2.5 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-label-caps hover:bg-error-container/30 transition-colors disabled:opacity-50"
                      >
                        Issue Partial / Full Refund
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Narrower Contextual Info) */}
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
              <p className="mt-3 text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">call</span> {order.shippingAddress.phone}
              </p>
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
                  {shipment.trackingUrl && (
                    <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-body-sm text-[12px] mt-1 inline-block">Track Package ↗</a>
                  )}
                </div>
                <div className="h-px bg-outline-variant/20 my-4"></div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="font-label-caps text-[10px] text-on-surface-variant">Shipped At</span>
                    <span className="font-body-sm text-[12px]">{shipment.shippedAt ? new Date(shipment.shippedAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-label-caps text-[10px] text-on-surface-variant">Delivered At</span>
                    <span className="font-body-sm text-[12px]">{shipment.deliveredAt ? new Date(shipment.deliveredAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
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
