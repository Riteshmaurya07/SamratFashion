"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ReturnRequestModal } from "./ReturnRequestModal";
import { useOrderStore } from "@/store/useOrderStore";
import { CheckCircle2, Package, Truck, Home, MapPin, ChevronLeft, CreditCard } from "lucide-react";
import Image from "next/image";
import Script from "next/script";
import { api } from "@/lib/api";
import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";
import { CustomerMockupReview } from "./CustomerMockupReview";

export function OrderDetailsClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrder, fetchOrder, isLoading } = useOrderStore();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("CHANGED_MIND");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

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

  const handleCancelOrder = async () => {
    setIsCancelling(true);
    setCancelError("");
    try {
      await api.post(`/orders/${order._id}/cancel`, { reason: cancelReason });
      setIsCancelModalOpen(false);
      fetchOrder(orderId);
    } catch (err: any) {
      setCancelError(err.response?.data?.message || "Failed to cancel order.");
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
          {isCancellable && (
            <button
              onClick={() => setIsCancelModalOpen(true)}
              className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-xl font-label-caps text-xs font-bold hover:bg-red-100 transition-colors"
            >
              Cancel Order
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
                        <span className="font-price-lg text-lg font-bold text-on-surface">₹{item.lineTotal}</span>
                      </div>
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
                <div className="pt-4 mt-auto border-t border-outline-variant/20 flex justify-between items-center">
                  <span className="font-headline-sm text-headline-sm">Total Paid</span>
                  <span className="font-price-lg text-price-lg text-primary text-xl font-bold">₹{order.total}</span>
                </div>
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
                <p className="text-on-surface-variant pt-2">{order.shippingAddress.phone}</p>
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

      {/* Cancel Order Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-lg text-on-surface">Cancel Order #{order.orderNumber}</h3>
              <button onClick={() => setIsCancelModalOpen(false)} className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {cancelError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-bold">{cancelError}</div>
              )}

              <p className="text-xs text-on-surface-variant leading-relaxed">
                Orders can be cancelled before shipment. Custom-printed orders cannot be cancelled once customization has been confirmed by Samrat Fashion.
              </p>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1 font-bold">Reason for Cancellation</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface focus:outline-primary"
                >
                  <option value="CHANGED_MIND">Changed My Mind</option>
                  <option value="ORDERED_BY_MISTAKE">Ordered By Mistake</option>
                  <option value="DELIVERY_DELAY">Delivery Taking Too Long</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
                className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                Keep Order
              </button>
              <button
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="px-6 py-2.5 bg-red-600 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-red-700 transition-colors shadow-md disabled:opacity-50"
              >
                {isCancelling ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
