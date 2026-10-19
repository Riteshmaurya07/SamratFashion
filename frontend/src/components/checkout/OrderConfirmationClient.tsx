"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrderStore } from "@/store/useOrderStore";
import { CheckCircle2, Package, Truck, Home, MapPin, AlertCircle, RefreshCw } from "lucide-react";
import Image from "next/image";

import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";

export function OrderConfirmationClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { currentOrder, fetchOrder, isLoading, error } = useOrderStore();
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        setFetchError(null);
        await fetchOrder(orderId);
      } catch (err: any) {
        if (isMounted) {
          setFetchError(err.response?.data?.message || err.message || "Failed to load order details");
        }
      }
    };

    loadData();

    // Poll every 5 seconds if order status is PENDING
    const interval = setInterval(() => {
      const activeOrder = useOrderStore.getState().currentOrder;
      if (activeOrder && activeOrder.paymentStatus === 'PENDING') {
        loadData();
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchOrder, orderId]);

  // Track purchase event idempotently when currentOrder is paid/confirmed
  useEffect(() => {
    if (currentOrder && (currentOrder.paymentStatus === "PAID" || ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(currentOrder.status))) {
      import("@/lib/analytics").then(({ trackPurchase }) => {
        trackPurchase({
          orderNumber: currentOrder.orderNumber,
          total: currentOrder.total,
          subtotal: currentOrder.subtotal,
          tax: currentOrder.tax,
          shipping: currentOrder.shipping,
          discount: currentOrder.discount,
          items: currentOrder.items || [],
        });
      });
    }
  }, [currentOrder]);

  // Loading State
  if (isLoading && !currentOrder) {
    return (
      <main className="flex-grow w-full max-w-container-max mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-10 h-10 text-primary animate-spin mb-4" />
        <h2 className="text-xl font-bold text-on-surface mb-2">Loading your order confirmation...</h2>
        <p className="text-sm text-on-surface-variant">Please wait a moment while we retrieve your order details.</p>
      </main>
    );
  }

  // Error State (Never return null)
  if ((error || fetchError || !currentOrder) && !isLoading) {
    return (
      <main className="flex-grow w-full max-w-container-max mx-auto px-4 py-16 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full bg-surface-container-lowest border border-outline-variant/30 p-8 rounded-2xl shadow-lg text-center space-y-6">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div>
            <h1 className="font-headline-sm text-2xl font-bold text-on-surface mb-2">Unable to Load Confirmation</h1>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {fetchError || error || "We could not locate this order details. If payment was completed, your order is safely registered in your account."}
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-3">
            <button
              onClick={() => router.push('/account/orders')}
              className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/90 transition-colors"
            >
              View My Orders
            </button>
            <button
              onClick={() => router.push('/support')}
              className="w-full py-3 border border-outline-variant text-on-surface font-bold rounded-xl hover:bg-surface-container transition-colors"
            >
              Contact Customer Support
            </button>
          </div>
        </div>
      </main>
    );
  }

  const order = currentOrder!;
  const isCancelled = order.status === 'CANCELLED';
  const isFailed = order.paymentStatus === 'FAILED';
  const isPaid = order.paymentStatus === 'PAID';
  const isEligibleForInvoice = ['PAID', 'REFUNDED'].includes(order.paymentStatus) || ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status);

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12">
      <div className="max-w-4xl mx-auto space-y-12">

        {/* Success Header */}
        <section className="text-center space-y-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${isCancelled ? 'bg-amber-500/10' : isPaid ? 'bg-primary/10' : isFailed ? 'bg-red-500/10' : 'bg-secondary/10'}`}>
            {isCancelled
              ? <AlertCircle className="w-12 h-12 text-amber-500" />
              : <CheckCircle2 className={`w-12 h-12 ${isPaid ? 'text-primary' : isFailed ? 'text-red-500' : 'text-secondary'}`} />}
          </div>
          <h1 className="font-display-lg text-4xl md:text-5xl font-bold text-on-surface">
            {isCancelled ? "Order Cancelled" : isPaid ? "Order Confirmed 🎉" : isFailed ? "Payment Failed ❌" : "Payment Verification in Progress ⏳"}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">
            {isCancelled
              ? "We couldn't confirm your order because one or more items are no longer in stock. Any amount deducted has been (or will be) refunded to your original payment method automatically — no action needed."
              : isPaid ? "Thank you for your order! We've received your payment and will start preparing your shipment shortly."
              : isFailed ? "Unfortunately, your payment was not successful. Please try retrying payment from your Orders page."
              : "We are verifying your payment with Razorpay. This page will update automatically once confirmed."}
          </p>
          <div className="flex justify-center items-center space-x-6 pt-4 text-on-surface-variant">
            <div className="font-label-caps text-label-caps uppercase">Order ID: <span className="font-bold text-on-surface">#{order.orderNumber}</span></div>
            <div className="w-1 h-1 bg-outline-variant rounded-full"></div>
            <div className="font-label-caps text-label-caps uppercase">Order date: <span className="font-bold text-on-surface">{new Date(order.createdAt).toLocaleDateString()}</span></div>
          </div>
        </section>

        {/* Order Lifecycle Timeline (hidden for cancelled orders) */}
        {!isCancelled && (
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
        )}

        {/* Cancelled notice panel */}
        {isCancelled && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-left">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <RefreshCw className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-amber-900">Refund in progress</h2>
              <p className="text-sm text-amber-800/80">
                Your payment is being refunded because the order could not be confirmed due to stock availability. Refunds typically reflect within 5-7 business days.
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push('/account/orders')}
            className="shrink-0 w-full md:w-auto px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-headline-sm text-sm font-bold rounded-lg transition-colors"
          >
            View My Orders
          </button>
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
                  <div className="flex-grow flex flex-col justify-between min-h-32 py-1">
                    <div>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface mb-1">{item.productName}</h3>
                      <div className="flex flex-wrap gap-4 text-on-surface-variant font-body-sm text-body-sm">
                        <span>Size: <strong className="text-on-surface">{item.selectedSize}</strong></span>
                        <span>Color: <strong className="text-on-surface">{item.selectedColor}</strong></span>
                        <span>Qty: <strong className="text-on-surface">{item.quantity}</strong></span>
                      </div>
                      {(item as any).customizationSnapshot && (
                        <div className="mt-2 text-xs bg-primary/5 text-primary p-2 rounded border border-primary/20">
                          <span className="font-bold block">Customized Item</span>
                          {(item as any).customizationSnapshot.printLocations?.length > 0 && (
                            <span className="block text-on-surface-variant text-[11px]">Print Locations: {(item as any).customizationSnapshot.printLocations.join(', ')}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-end mt-4">
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
        <section className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 flex flex-col md:flex-row justify-center items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(`/account/orders/${order._id}`)}
            className="w-full md:w-auto px-8 bg-neutral-900 hover:bg-neutral-800 text-white font-mono text-xs uppercase tracking-wider font-bold py-3.5 rounded-md transition-all active:scale-95 shadow-sm"
          >
            VIEW ORDER DETAILS
          </button>
          {isEligibleForInvoice && (
            <button
              type="button"
              onClick={() => downloadOrViewInvoicePdf(order._id, `Invoice-${order.orderNumber}.pdf`)}
              className="w-full md:w-auto px-8 bg-surface-container border border-outline-variant/60 text-on-surface hover:bg-surface-container-high font-mono text-xs uppercase tracking-wider font-bold py-3.5 rounded-md transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">download</span>
              <span>DOWNLOAD TAX INVOICE</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push('/shop')}
            className="w-full md:w-auto px-8 border border-neutral-900 text-on-surface hover:bg-neutral-900 hover:text-white font-mono text-xs uppercase tracking-wider font-bold py-3.5 rounded-md transition-all active:scale-95"
          >
            CONTINUE SHOPPING
          </button>
        </section>

      </div>
    </main>
  );
}
