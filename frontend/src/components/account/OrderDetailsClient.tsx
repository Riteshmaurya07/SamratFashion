"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ReturnRequestModal } from "./ReturnRequestModal";
import { useOrderStore } from "@/store/useOrderStore";
import { CheckCircle2, Package, Truck, Home, MapPin, ChevronLeft, CreditCard } from "lucide-react";
import Image from "next/image";
import Script from "next/script";
import { api } from "@/lib/api";
import { useState } from "react";

export function OrderDetailsClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrder, fetchOrder, isLoading } = useOrderStore();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);

  useEffect(() => {
    fetchOrder(orderId);
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
            await api.post('/payments/verify', {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            });
            fetchOrder(orderId);
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

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="flex-grow flex flex-col w-full max-w-4xl">
      <div className="mb-6">
        <button 
          onClick={() => router.push('/account/orders')}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Orders
        </button>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 pb-6 border-b border-outline-variant/20">
        <div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface mb-2">Order Details</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Order #{order.orderNumber} • Placed on {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <span className={`px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider ${
            order.status === 'DELIVERED' ? 'bg-green-100 text-green-800' : 
            order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 
            'bg-primary/10 text-primary'
          }`}>
            {order.status}
          </span>
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
            <div className="mt-6 pt-6 border-t border-outline-variant/20 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-on-surface-variant block mb-1">Carrier</span>
                <span className="font-semibold text-on-surface">{order.shipment.carrier}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block mb-1">Tracking Number</span>
                <span className="font-mono text-on-surface">{order.shipment.trackingNumber}</span>
              </div>
              {order.shipment.trackingUrl && (
                <div className="col-span-2 mt-2">
                  <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-block px-4 py-2 bg-primary/10 text-primary rounded-md font-medium hover:bg-primary/20 transition-colors">
                    Track Package ↗
                  </a>
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
                <div key={idx} className="flex gap-6 items-start">
                  <div className="w-24 h-32 bg-surface-container shrink-0 rounded-lg overflow-hidden border border-outline-variant/10 relative">
                    <Image src={item.productImage || '/placeholder.png'} alt={item.productName} fill className="object-cover" />
                  </div>
                  <div className="flex-grow flex flex-col justify-between h-32 py-1">
                    <div>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">{item.productName}</h3>
                      <div className="flex flex-wrap gap-4 text-on-surface-variant font-body-sm text-body-sm">
                        <span>Size: <strong className="text-on-surface">{item.selectedSize}</strong></span>
                        <span>Color: <strong className="text-on-surface">{item.selectedColor}</strong></span>
                        <span>Qty: <strong className="text-on-surface">{item.quantity}</strong></span>
                      </div>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="font-label-caps text-label-caps text-on-surface-variant">Unit: <span className="font-label-caps">₹{item.unitPrice}</span></span>
                      <span className="font-price-lg text-lg font-bold text-on-surface">₹{item.lineTotal}</span>
                    </div>
                  </div>
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
    </div>
    </>
  );
}
