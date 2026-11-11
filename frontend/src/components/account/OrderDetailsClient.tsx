"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ReturnRequestModal } from "./ReturnRequestModal";
import { useOrderStore, OrderItemSnapshot } from "@/store/useOrderStore";
import { CheckCircle2, Package, Truck, Home, MapPin, ChevronLeft, CreditCard, Share2 } from "lucide-react";
import { ShareTrackingModal } from "@/components/orders/ShareTrackingModal";
import Image from "next/image";
import Script from "next/script";
import { api } from "@/lib/api";
import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";
import { CustomerMockupReview } from "./CustomerMockupReview";
import { useStoreSettings } from "@/lib/useStoreSettings";

export function OrderDetailsClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrder, fetchOrder, isLoading } = useOrderStore();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("CHANGED_MIND");
  const [cancelMode, setCancelMode] = useState<"ENTIRE" | "ITEMS">("ITEMS");
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({});
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const { freeShippingThreshold } = useStoreSettings();

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  useEffect(() => {
    if (orderId && orderId !== "undefined") {
      fetchOrder(orderId);
    }
  }, [fetchOrder, orderId]);

  if (isLoading || !currentOrder) {
    return <div className="min-h-[60vh] flex items-center justify-center">Loading order details...</div>;
  }

  const order = currentOrder;

  const handleRetryPayment = async () => {
    try {
      setIsRetrying(true);
      
      const res = await api.post('/payments/create-order', { orderId: order._id });
      const rpData = res.data.data;

      const options = {
        key: rpData.keyId,
        amount: rpData.amount,
        currency: rpData.currency,
        name: rpData.name,
        description: rpData.description,
        order_id: rpData.razorpayOrderId,
        handler: async function (response: any) {
          try {
            const verifyRes = await api.post('/payments/verify', {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            });
            const verifyBody = verifyRes.data;
            fetchOrder(orderId);
            if (verifyBody?.data?.orderCancelled) {
              alert("We couldn't confirm your order because an item is no longer in stock. Your payment will be refunded automatically.");
            }
          } catch (verifyError) {
            console.error('Verification failed', verifyError);
            alert("Payment verification failed.");
            fetchOrder(orderId);
          }
        },
        theme: { color: "#0F172A" }
      };

      const rzp = new (window as any).Razorpay(options);
      
      rzp.on('payment.failed', function (response: any) {
        console.error(response.error);
        alert(`Payment failed: ${response.error.description}`);
        setIsRetrying(false);
        fetchOrder(orderId);
      });

      rzp.open();
    } catch (error) {
      console.error(error);
      alert("Failed to initialize payment.");
      setIsRetrying(false);
    }
  };

  const handleOpenCancelModal = (preselectedItemId?: string) => {
    setCancelError("");
    const initialMap: Record<string, number> = {};
    order.items.forEach((it: any) => {
      const remaining = it.quantity - (it.cancelledQuantity || 0);
      if (remaining > 0) {
        if (preselectedItemId && it._id === preselectedItemId) {
          initialMap[it._id] = remaining;
        } else {
          initialMap[it._id] = 0;
        }
      }
    });

    setCancelMode("ITEMS");
    setSelectedItemQuantities(initialMap);
    setIsCancelModalOpen(true);
  };

  const calculateEstimatedRefund = () => {
    if (cancelMode === "ENTIRE") {
      return order.total;
    }
    const discountRatio = order.subtotal > 0 ? ((order.discount || 0) / order.subtotal) : 0;
    let est = 0;
    for (const item of order.items) {
      if (!item._id) continue;
      const q = selectedItemQuantities[item._id] || 0;
      if (q > 0) {
        const unitPrice = (item.lineTotal / (item.quantity || 1)) * (1 - discountRatio);
        est += Math.round(q * unitPrice);
      }
    }
    return est;
  };

  const isAllItemsSelected = () => {
    return order.items.every((item: OrderItemSnapshot) => {
      const remaining = item.quantity - (item.cancelledQuantity || 0);
      if (remaining <= 0) return true;
      const selected = (item._id && selectedItemQuantities[item._id]) || 0;
      return selected >= remaining;
    });
  };

  const calculateRemainingEligibleSubtotal = () => {
    let remainingSubtotal = 0;
    for (const item of order.items) {
      const willCancel = (item._id && selectedItemQuantities[item._id]) || 0;
      const remaining = Math.max(0, item.quantity - (item.cancelledQuantity || 0) - willCancel);
      const unitPrice = (item.lineTotal || 0) / (item.quantity || 1);
      remainingSubtotal += remaining * unitPrice;
    }
    const initialSubtotal = order.initialSubtotal || order.subtotal || 0;
    const initialDiscount = order.initialDiscount || order.discount || 0;
    const discountRatio = initialSubtotal > 0 ? (initialDiscount / initialSubtotal) : 0;
    return Math.max(0, remainingSubtotal * (1 - discountRatio));
  };

  const isBelowThresholdBlocked = () => {
    if (cancelMode === "ENTIRE" || isAllItemsSelected()) {
      return false;
    }
    const hadFreeShipping = order.shipping === 0 || !order.shipping;
    const initialEligible = (order.initialSubtotal || order.subtotal || 0) - (order.initialDiscount || order.discount || 0);
    if (!hadFreeShipping || initialEligible < freeShippingThreshold) {
      return false;
    }
    const hasStandaloneFreeDelivery = order.items.some((item: OrderItemSnapshot) => {
      const remaining = Math.max(0, item.quantity - (item.cancelledQuantity || 0) - ((item._id && selectedItemQuantities[item._id]) || 0));
      return remaining > 0 && Boolean(item.freeDelivery);
    });
    if (hasStandaloneFreeDelivery) {
      return false;
    }
    const remainingEligible = calculateRemainingEligibleSubtotal();
    return freeShippingThreshold > 0 && remainingEligible > 0 && remainingEligible < freeShippingThreshold;
  };

  const handleSubmitCancellation = async () => {
    setIsCancelling(true);
    setCancelError("");
    try {
      if (cancelMode === "ENTIRE") {
        await api.post(`/orders/${order._id}/cancel`, { reason: cancelReason });
      } else {
        const itemsToCancel = Object.entries(selectedItemQuantities)
          .filter(([_, qty]) => qty > 0)
          .map(([itemId, quantity]) => ({ itemId, quantity }));

        if (itemsToCancel.length === 0) {
          setCancelError("Please select at least one item with a quantity greater than 0 to cancel.");
          setIsCancelling(false);
          return;
        }

        await api.post(`/orders/${order._id}/cancel-items`, {
          items: itemsToCancel,
          reason: cancelReason,
        });
      }
      setIsCancelModalOpen(false);
      await fetchOrder(orderId);
    } catch (err: any) {
      setCancelError(err.response?.data?.message || "Failed to cancel order / items.");
    } finally {
      setIsCancelling(false);
    }
  };

  const isHandedOff = order.shipment && ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.shipment.status);
  const isCancellable = !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status) && !isHandedOff;

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="flex-grow flex flex-col w-full max-w-4xl pb-28 lg:pb-12">
      <div className="mb-6 flex justify-between items-center">
        <button 
          onClick={() => router.push('/account/orders')}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Orders
        </button>

        {/* Support Shortcut */}
        <Link
          href={`/support?orderId=${order._id}`}
          className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-xl font-label-caps text-xs font-bold hover:bg-surface-variant transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">help_outline</span>
          Need Help with Order?
        </Link>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 pb-6 border-b border-outline-variant/20">
        <div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface mb-2">Order Details</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Order #{order.orderNumber} • Placed on {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {order.partiallyCancelled && (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
              Partially Cancelled
            </span>
          )}
          <span className={`px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider ${
            order.status === 'DELIVERED' ? 'bg-green-100 text-green-800' : 
            order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 
            'bg-primary/10 text-primary'
          }`}>
            {order.status}
          </span>
          {/* Download Tax Invoice CTA */}
          {['PAID', 'REFUNDED'].includes(order.paymentStatus) || ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status) ? (
            <button
              type="button"
              onClick={() => downloadOrViewInvoicePdf(order._id, `Invoice-${order.orderNumber}.pdf`)}
              className="px-4 py-2 bg-neutral-900 border border-neutral-800 text-white rounded-md font-mono text-xs font-bold hover:bg-neutral-800 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">download</span>
              <span>TAX INVOICE</span>
            </button>
          ) : null}
          {/* Share Tracking Link CTA */}
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            className="px-4 py-2 bg-surface-container border border-outline-variant/60 text-on-surface rounded-md font-mono text-xs font-bold hover:bg-surface-container-high transition-colors flex items-center gap-1.5 shadow-sm active:scale-95"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>SHARE TRACKING</span>
          </button>
          {isCancellable && (
            <button
              onClick={() => handleOpenCancelModal()}
              className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-xl font-label-caps text-xs font-bold hover:bg-red-100 transition-colors"
            >
              Cancel Items / Order
            </button>
          )}
        </div>
      </div>

      <div className="space-y-12">
        {/* Order Lifecycle Timeline */}
        <section className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 relative">
          <div className="relative flex justify-between items-center px-4 py-8">
            <div className="absolute top-1/2 left-0 w-full h-[2px] bg-outline-variant/30 -translate-y-1/2 z-0"></div>
            
            {/* Very rough progress bar calculation based on status */}
            <div className={`absolute top-1/2 left-0 h-[2px] bg-primary -translate-y-1/2 z-10 ${
              order.status === 'PENDING' || order.status === 'CONFIRMED' ? 'w-1/4' :
              order.status === 'PROCESSING' ? 'w-2/4' :
              order.status === 'SHIPPED' ? 'w-3/4' :
              order.status === 'DELIVERED' ? 'w-full' : 'w-0'
            }`}></div>
            
            <div className="relative z-20 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface text-center">Confirmed</span>
            </div>
            
            <div className={`relative z-20 flex flex-col items-center gap-2 ${['PENDING', 'CONFIRMED'].includes(order.status) ? 'opacity-50' : ''}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status) ? 'bg-primary border-primary text-on-primary' : 'bg-surface-container border-outline-variant text-on-surface-variant'}`}>
                <Package className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-center">Processing</span>
            </div>
            
            <div className={`relative z-20 flex flex-col items-center gap-2 ${['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status) ? 'opacity-50' : ''}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${['SHIPPED', 'DELIVERED'].includes(order.status) ? 'bg-primary border-primary text-on-primary' : 'bg-surface-container border-outline-variant text-on-surface-variant'}`}>
                <Truck className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-center">Shipped</span>
            </div>
            
            <div className={`relative z-20 flex flex-col items-center gap-2 ${order.status !== 'DELIVERED' ? 'opacity-50' : ''}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${order.status === 'DELIVERED' ? 'bg-primary border-primary text-on-primary' : 'bg-surface-container border-outline-variant text-on-surface-variant'}`}>
                <Home className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-center">Delivered</span>
            </div>
          </div>
          
          {order.shipment && (
            <div className="mt-6 pt-6 border-t border-outline-variant/20 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container/50 p-4 rounded-xl">
                <div>
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant font-bold block mb-1">Carrier & AWB</span>
                  <span className="font-semibold text-on-surface">{order.shipment.carrier} — <span className="font-mono text-primary">{order.shipment.awbNumber || order.shipment.trackingNumber}</span></span>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant font-bold block mb-1">Live Status</span>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                    order.shipment.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                    order.shipment.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {order.shipment.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {order.shipment.trackingUrl && (
                  <div>
                    <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-block px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                      Track Package ↗
                    </a>
                  </div>
                )}
              </div>

              {order.shipment.trackingHistory && order.shipment.trackingHistory.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Tracking History</h4>
                  <div className="space-y-2 border-l-2 border-primary/30 pl-4 text-xs">
                    {order.shipment.trackingHistory.map((evt: any, idx: number) => (
                      <div key={idx} className="relative pb-2">
                        <div className="font-bold text-on-surface flex items-center gap-2">
                          <span>{evt.status.replace(/_/g, ' ')}</span>
                          {evt.location && <span className="text-on-surface-variant font-normal">({evt.location})</span>}
                        </div>
                        <p className="text-on-surface-variant mt-0.5">{evt.description}</p>
                        <span className="text-[10px] text-outline">{new Date(evt.timestamp).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {order.refunds && order.refunds.length > 0 && (
          <section className="bg-red-50 p-6 rounded-xl border border-red-200">
            <h2 className="font-title-lg text-title-lg font-bold text-red-900 mb-4 flex items-center gap-2">
              Refund Information
            </h2>
            <div className="space-y-4">
              {order.refunds.map((refund: any) => (
                <div key={refund._id} className="bg-white p-4 rounded-lg shadow-sm border border-red-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-lg">₹{refund.amount.toLocaleString()}</div>
                    <div className="text-sm text-gray-600 mt-1">Status: <span className={`font-semibold ${refund.status === 'PROCESSED' ? 'text-green-600' : refund.status === 'FAILED' ? 'text-red-600' : 'text-orange-600'}`}>{refund.status}</span></div>
                    {refund.reason && <div className="text-sm text-gray-500 mt-1 italic">"{refund.reason}"</div>}
                  </div>
                  <div className="text-sm text-gray-500 text-right">
                    <div>Requested on {new Date(refund.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {order.returns && order.returns.length > 0 && (
          <section className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20">
            <h2 className="font-title-lg text-title-lg font-bold text-on-surface mb-4 flex items-center gap-2">
              Returns
            </h2>
            <div className="space-y-4">
              {order.returns.map((r: any) => (
                <div key={r._id} className="bg-surface p-4 rounded-lg shadow-sm border border-outline-variant/30">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-bold">Return Request</span>
                      <div className="text-xs text-on-surface-variant mt-1">
                        Requested on {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                        ['REQUESTED', 'INSPECTING'].includes(r.status) ? 'bg-orange-100 text-orange-800' :
                        r.status === 'APPROVED' ? 'bg-blue-100 text-blue-800' :
                        r.status === 'RECEIVED' ? 'bg-purple-100 text-purple-800' :
                        ['ACCEPTED', 'COMPLETED'].includes(r.status) ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 text-sm space-y-2">
                    {r.items.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between border-b border-outline-variant/10 pb-1 last:border-0">
                        <span className="text-on-surface-variant">Variant: {item.variantId.substring(0, 8)}... (Qty: {item.quantity})</span>
                        <span>Reason: {item.reason}</span>
                      </div>
                    ))}
                  </div>
                  {r.status === 'REQUESTED' && (
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={async () => {
                          if (!confirm("Cancel this return request?")) return;
                          try {
                            await api.post(`/orders/${orderId}/returns/${r._id}/cancel`);
                            fetchOrder(orderId);
                          } catch (err: any) {
                            alert(err.response?.data?.message || 'Failed to cancel return');
                          }
                        }}
                        className="text-xs text-red-600 hover:underline font-semibold"
                      >
                        Cancel Return
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Order Items */}
          <section className="md:col-span-2 bg-surface-container-lowest border border-outline-variant/20 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-lowest">
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Order Items</h2>
            </div>
            <div className="p-6 space-y-6">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex flex-col gap-4 pb-6 border-b border-outline-variant/20 last:border-0 last:pb-0">
                  <div className="flex gap-6 items-start">
                    <div className="w-24 h-32 bg-surface-container shrink-0 rounded-lg overflow-hidden border border-outline-variant/10 relative">
                      <Image src={item.isCustomized ? (item.customizationSnapshot?.previewImage || '/placeholder.png') : (item.productImage || '/placeholder.png')} alt={item.productName} fill className="object-cover" />
                    </div>
                    <div className="flex-grow flex flex-col justify-between py-1 min-h-[8rem]">
                      <div>
                        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">{item.productName} {item.isCustomized && "(Custom)"}</h3>
                        <div className="flex flex-wrap gap-4 text-on-surface-variant font-body-sm text-body-sm">
                          {item.isCustomized && item.customConfigurations ? (
                            <div className="flex flex-col gap-2 w-full">
                              {item.customConfigurations.map((config: any, cidx: number) => (
                                <div key={cidx} className="flex flex-col text-xs bg-surface-container-low p-2 rounded">
                                  <span className="font-bold">Color: {config.color}</span>
                                  <span>Sizes: {config.sizeDistribution?.map((d: any) => `${d.size}(${d.quantity})`).join(', ')}</span>
                                  <div className="mt-1 flex gap-2 font-mono text-[10px]">
                                    <span className="bg-gray-200 px-1 py-0.5 rounded text-gray-700">Purchased: v{config.purchasedDesignVersion || 1}</span>
                                    {config.approvedDesignVersion && (
                                      <span className="bg-green-100 px-1 py-0.5 rounded text-green-700 font-bold">Approved: v{config.approvedDesignVersion}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              <span>Size: <strong className="text-on-surface">{item.selectedSize}</strong></span>
                              <span>Color: <strong className="text-on-surface">{item.selectedColor}</strong></span>
                              <span>Qty: <strong className="text-on-surface">{item.quantity}</strong></span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="font-label-caps text-label-caps text-on-surface-variant">Unit: <span className="font-label-caps">₹{item.unitPrice}</span></span>
                        <div className="text-right">
                          <span className={`font-price-lg text-lg font-bold ${(item.cancelledQuantity || 0) >= item.quantity ? 'line-through text-outline' : 'text-on-surface'}`}>
                            ₹{item.lineTotal}
                          </span>
                          {item.cancelledQuantity && item.cancelledQuantity > 0 ? (
                            <div className="mt-1 flex flex-col items-end gap-0.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                item.cancelledQuantity >= item.quantity
                                  ? 'bg-red-100 text-red-700 border border-red-200'
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                              }`}>
                                {item.cancelledQuantity >= item.quantity ? 'Cancelled' : `Cancelled: ${item.cancelledQuantity} of ${item.quantity}`}
                              </span>
                              {item.cancelledValue ? (
                                <span className="text-[11px] text-red-600 font-mono">Refunded: ₹{item.cancelledValue}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isCancellable && (item.quantity - (item.cancelledQuantity || 0) > 0) && (
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleOpenCancelModal(item._id)}
                            className="text-xs text-red-600 hover:text-red-800 font-semibold hover:underline inline-flex items-center gap-1 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">cancel</span>
                            Cancel this item
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {(item.isCustomized || item.customDesignId || item.designFiles?.length || item.customizationNotes) && (
                    <CustomerMockupReview orderId={order._id} item={item} onRefresh={() => fetchOrder(orderId)} />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Right Column details */}
          <div className="flex flex-col gap-6">
            <section className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-lowest">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">Order Summary</h2>
              </div>
              <div className="p-6 flex-grow flex flex-col space-y-4 font-body-md text-body-md text-on-surface">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Subtotal</span>
                  <span className="font-label-caps">₹{order.subtotal}</span>
                </div>
                <div className="flex justify-between text-secondary">
                  <span>Discount</span>
                  <span className="font-label-caps">- ₹{order.discount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Shipping</span>
                  <span className="font-label-caps">{order.shipping === 0 ? 'Free' : `₹${order.shipping}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Tax</span>
                  <span className="font-label-caps">₹{order.tax}</span>
                </div>
                {order.partiallyCancelled ? (
                  <div className="pt-3 mt-auto border-t border-outline-variant/20 space-y-2">
                    <div className="flex justify-between text-xs text-on-surface-variant">
                      <span>Original Total Paid</span>
                      <span className="font-mono">₹{order.initialTotal ?? order.total}</span>
                    </div>
                    <div className="flex justify-between text-xs text-red-600 font-semibold">
                      <span>Cancelled / Refund</span>
                      <span className="font-mono">- ₹{Math.max(0, (order.initialTotal ?? order.total) - order.total)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-outline-variant/10">
                      <span className="font-headline-sm text-headline-sm">Active Order Total</span>
                      <span className="font-price-lg text-price-lg text-primary text-xl font-bold">₹{order.total}</span>
                    </div>
                  </div>
                ) : (
                  <div className="pt-4 mt-auto border-t border-outline-variant/20 flex justify-between items-center">
                    <span className="font-headline-sm text-headline-sm">Total Paid</span>
                    <span className="font-price-lg text-price-lg text-primary text-xl font-bold">₹{order.total}</span>
                  </div>
                )}
                {(order.paymentStatus === 'FAILED' || order.paymentStatus === 'PENDING') && (
                  <button 
                    onClick={handleRetryPayment}
                    disabled={isRetrying}
                    className="w-full mt-4 bg-primary text-on-primary py-3 rounded-lg flex items-center justify-center gap-2 font-bold disabled:opacity-50"
                  >
                    <CreditCard className="w-5 h-5" />
                    {isRetrying ? "Processing..." : "Retry Payment"}
                  </button>
                )}
                {order.status === 'DELIVERED' && (
                  <button 
                    onClick={() => setIsReturnModalOpen(true)}
                    className="w-full mt-4 bg-surface-container border border-outline-variant/30 text-on-surface py-3 rounded-lg flex items-center justify-center gap-2 font-bold hover:bg-surface-container-high transition-colors"
                  >
                    <Package className="w-5 h-5" />
                    Return Items
                  </button>
                )}
              </div>
            </section>

            <section className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl overflow-hidden p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-on-surface mb-2">
                <MapPin className="text-outline w-5 h-5" />
                <h2 className="font-headline-sm text-headline-sm">Delivering To</h2>
              </div>
              <div className="font-body-md text-body-md text-on-surface space-y-1">
                <p className="font-semibold">{order.shippingAddress.fullName}</p>
                <p className="text-on-surface-variant">{order.shippingAddress.addressLine1}</p>
                {order.shippingAddress.addressLine2 && <p className="text-on-surface-variant">{order.shippingAddress.addressLine2}</p>}
                <p className="text-on-surface-variant">{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
                <p className="text-on-surface-variant pt-2">Phone: {order.shippingAddress.phone}</p>
                {order.shippingAddress.alternatePhone && (
                  <p className="text-on-surface-variant text-xs font-mono">Alt Phone: {order.shippingAddress.alternatePhone}</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      
      {isReturnModalOpen && (
        <ReturnRequestModal 
          order={order}
          onClose={() => setIsReturnModalOpen(false)}
          onSuccess={() => {
            setIsReturnModalOpen(false);
            fetchOrder(orderId);
            alert("Return request submitted successfully");
          }}
        />
      )}

      {/* Cancel Items / Order Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <div>
                <h3 className="font-bold text-lg text-on-surface">Order Cancellation</h3>
                <p className="text-xs text-on-surface-variant font-mono">Order #{order.orderNumber}</p>
              </div>
              <button onClick={() => setIsCancelModalOpen(false)} className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {cancelError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-bold border border-red-200">{cancelError}</div>
              )}

              {/* Threshold Warning Banner */}
              {cancelMode === "ITEMS" && isBelowThresholdBlocked() && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    Free Delivery Threshold Notice
                  </div>
                  <p className="leading-relaxed">
                    Cancelling these items reduces your active order value to{" "}
                    <strong className="font-mono">₹{Math.round(calculateRemainingEligibleSubtotal()).toLocaleString()}</strong>, which is below the{" "}
                    <strong className="font-mono">₹{freeShippingThreshold.toLocaleString()}</strong> free delivery threshold.
                  </p>
                  <p className="leading-relaxed">
                    Partial cancellation is not permitted when the remaining order falls below the free delivery threshold. Please cancel the entire order instead.
                  </p>
                  <button
                    type="button"
                    onClick={() => setCancelMode("ENTIRE")}
                    className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 underline hover:text-amber-950 pt-1"
                  >
                    Switch to Cancel Entire Order →
                  </button>
                </div>
              )}
              {/* Cancellation Type Selector */}
              <div className="flex rounded-xl bg-surface-container-low p-1 border border-outline-variant/30 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setCancelMode("ITEMS")}
                  className={`flex-1 py-2 text-center rounded-lg transition-colors ${
                    cancelMode === "ITEMS"
                      ? "bg-surface-bright text-on-surface shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  Cancel Selected Items
                </button>
                <button
                  type="button"
                  onClick={() => setCancelMode("ENTIRE")}
                  className={`flex-1 py-2 text-center rounded-lg transition-colors ${
                    cancelMode === "ENTIRE"
                      ? "bg-surface-bright text-on-surface shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  Cancel Entire Order
                </button>
              </div>

              {cancelMode === "ITEMS" ? (
                <div className="space-y-3">
                  <span className="block text-xs font-label-caps uppercase text-on-surface-variant font-bold">
                    Select Items &amp; Quantity to Cancel
                  </span>
                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {order.items
                      .filter((it: any) => (it.quantity - (it.cancelledQuantity || 0)) > 0)
                      .map((item: any) => {
                        const remaining = item.quantity - (item.cancelledQuantity || 0);
                        const selectedQty = selectedItemQuantities[item._id] || 0;
                        const isSelected = selectedQty > 0;
                        const discountRatio = order.subtotal > 0 ? ((order.discount || 0) / order.subtotal) : 0;
                        const unitPrice = (item.lineTotal / (item.quantity || 1)) * (1 - discountRatio);
                        const lineRefund = Math.round(selectedQty * unitPrice);

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
                                  setSelectedItemQuantities((prev) => ({
                                    ...prev,
                                    [item._id]: e.target.checked ? remaining : 0,
                                  }));
                                }}
                                className="w-4 h-4 rounded text-red-600 focus:ring-red-500 cursor-pointer"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-on-surface truncate">{item.productName}</p>
                                <p className="text-[11px] text-on-surface-variant">
                                  Size: {item.selectedSize} · Color: {item.selectedColor} · Max: {remaining}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {isSelected && (
                                <select
                                  value={selectedQty}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    setSelectedItemQuantities((prev) => ({
                                      ...prev,
                                      [item._id]: val,
                                    }));
                                  }}
                                  className="text-xs font-bold bg-surface-bright border border-outline-variant/50 rounded-lg p-1 text-on-surface"
                                >
                                  {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                      Qty: {n}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <span className="text-xs font-bold font-mono text-on-surface min-w-[50px] text-right">
                                {isSelected ? `₹${lineRefund}` : `₹${item.unitPrice}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/20 text-xs text-on-surface-variant space-y-1">
                  <p className="font-bold text-on-surface">Cancelling Entire Order</p>
                  <p>All items in this order will be cancelled, stock restored, and the total remaining amount refunded.</p>
                </div>
              )}

              {/* Refund Notice */}
              {order.paymentStatus === 'PAID' && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs flex justify-between items-center text-green-900">
                  <span className="font-medium">Estimated Automatic Refund:</span>
                  <span className="font-bold text-sm font-mono">₹{calculateEstimatedRefund().toLocaleString()}</span>
                </div>
              )}

              {/* Reason Selector */}
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1 font-bold">Reason for Cancellation</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface focus:outline-primary"
                >
                  <option value="CHANGED_MIND">Changed My Mind</option>
                  <option value="ORDERED_BY_MISTAKE">Ordered By Mistake</option>
                  <option value="DELIVERY_DELAY">Delivery Taking Too Long</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
                className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                Keep Order
              </button>
              <button
                onClick={handleSubmitCancellation}
                disabled={isCancelling || (cancelMode === "ITEMS" && isBelowThresholdBlocked())}
                className="px-6 py-2.5 bg-red-600 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-red-700 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling
                  ? "Processing..."
                  : cancelMode === "ENTIRE"
                  ? "Confirm Order Cancellation"
                  : isBelowThresholdBlocked()
                  ? "Cancellation Blocked (Below Threshold)"
                  : "Cancel Selected Items"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Share Tracking Modal */}
      <ShareTrackingModal
        orderId={order._id}
        orderNumber={order.orderNumber}
        initialToken={order.shareableTrackingToken}
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
      />
    </div>
    </>
  );
}
