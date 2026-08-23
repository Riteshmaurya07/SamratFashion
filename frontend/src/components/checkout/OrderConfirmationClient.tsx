"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrderStore } from "@/store/useOrderStore";
import { CheckCircle2, Package, Truck, Home, MapPin } from "lucide-react";
import Image from "next/image";

export function OrderConfirmationClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrder, fetchOrder, isLoading } = useOrderStore();

  useEffect(() => {
    fetchOrder(orderId);
    
    // Poll if order payment is pending
    const interval = setInterval(() => {
      if (currentOrder && currentOrder.paymentStatus === 'PENDING') {
        fetchOrder(orderId);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchOrder, orderId, currentOrder?.paymentStatus]);

  if (isLoading && !currentOrder) {
    return <div className="min-h-[60vh] flex items-center justify-center">Loading order details...</div>;
  }

  const order = currentOrder;
  if (!order) return null;

  const isPending = order.paymentStatus === 'PENDING';
  const isFailed = order.paymentStatus === 'FAILED';
  const isPaid = order.paymentStatus === 'PAID';

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12">
      <div className="max-w-4xl mx-auto space-y-12">
        
        {/* Success Header */}
        <section className="text-center space-y-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${isPaid ? 'bg-primary/10' : isFailed ? 'bg-red-500/10' : 'bg-secondary/10'}`}>
            <CheckCircle2 className={`w-12 h-12 ${isPaid ? 'text-primary' : isFailed ? 'text-red-500' : 'text-secondary'}`} />
          </div>
          <h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface">
            {isPaid ? "Order Confirmed 🎉" : isFailed ? "Payment Failed ❌" : "Payment Verification in Progress ⏳"}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">
            {isPaid ? "Thank you for your order! We've received your order and will start preparing it shortly." 
             : isFailed ? "Unfortunately, your payment was not successful. Please try again from your Orders page."
             : "We are verifying your payment with the provider. This page will update automatically once confirmed."}
          </p>
          <div className="flex justify-center items-center space-x-6 pt-4 text-on-surface-variant">
            <div className="font-label-caps text-label-caps uppercase">Order ID: <span className="font-bold text-on-surface">#{order.orderNumber}</span></div>
            <div className="w-1 h-1 bg-outline-variant rounded-full"></div>
            <div className="font-label-caps text-label-caps uppercase">Order date: <span className="font-bold text-on-surface">{new Date(order.createdAt).toLocaleDateString()}</span></div>
          </div>
        </section>

        {/* Order Lifecycle Timeline */}
        <section className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 relative">
          <div className="relative flex justify-between items-center px-4 py-8">
            <div className="absolute top-1/2 left-0 w-full h-[2px] bg-outline-variant/30 -translate-y-1/2 z-0"></div>
            <div className="absolute top-1/2 left-0 w-1/4 h-[2px] bg-primary -translate-y-1/2 z-10"></div>
            
            <div className="relative z-20 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface text-center">Confirmed</span>
            </div>
            
            <div className="relative z-20 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center border-2 border-surface-container-lowest ring-4 ring-primary/20">
                <Package className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-primary text-center font-bold">Processing</span>
            </div>
            
            <div className="relative z-20 flex flex-col items-center gap-2 opacity-50">
              <div className="w-10 h-10 rounded-full bg-surface-container border-2 border-outline-variant flex items-center justify-center text-on-surface-variant">
                <Package className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant text-center">Packed</span>
            </div>
            
            <div className="relative z-20 flex flex-col items-center gap-2 opacity-50">
              <div className="w-10 h-10 rounded-full bg-surface-container border-2 border-outline-variant flex items-center justify-center text-on-surface-variant">
                <Truck className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant text-center">Shipped</span>
            </div>
            
            <div className="relative z-20 flex flex-col items-center gap-2 opacity-50">
              <div className="w-10 h-10 rounded-full bg-surface-container border-2 border-outline-variant flex items-center justify-center text-on-surface-variant">
                <Home className="w-5 h-5" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant text-center">Delivered</span>
            </div>
          </div>
        </section>

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
                  <span className="font-headline-sm text-headline-sm">Total</span>
                  <span className="font-price-lg text-price-lg text-primary text-xl font-bold">₹{order.total}</span>
                </div>
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
        
        {/* Actions */}
        <section className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-6 flex flex-col md:flex-row justify-center gap-4">
          <button onClick={() => router.push(`/account/orders/${order._id}`)} className="w-full md:w-auto px-8 bg-primary hover:bg-primary/90 text-on-primary font-headline-sm text-[16px] font-bold py-4 rounded-lg transition-transform active:scale-95">View Order Details</button>
          <button onClick={() => router.push('/shop')} className="w-full md:w-auto px-8 border-2 border-primary text-primary hover:bg-primary/5 font-headline-sm text-[16px] font-bold py-4 rounded-lg transition-transform active:scale-95">Continue Shopping</button>
        </section>

      </div>
    </main>
  );
}
