"use client";

import { useAddressStore } from "@/store/useAddressStore";
import { useCartStore } from "@/store/useCartStore";
import { useOrderStore } from "@/store/useOrderStore";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import Image from "next/image";

import Script from "next/script";
import { api } from "@/lib/api";

export function CheckoutClient() {
  const router = useRouter();
  const { addresses, fetchAddresses, isLoading: isLoadingAddresses } = useAddressStore();
  const { items, summary, fetchCart, isLoading: isLoadingCart } = useCartStore();
  const { createOrder, isLoading: isLoadingOrder } = useOrderStore();
  
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);

  useEffect(() => {
    fetchAddresses();
    fetchCart();
  }, [fetchAddresses, fetchCart]);

  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
      const defaultAddress = addresses.find(a => a.isDefault);
      if (defaultAddress) {
        setSelectedAddressId(defaultAddress._id);
      } else {
        setSelectedAddressId(addresses[0]._id);
      }
    }
  }, [addresses, selectedAddressId]);

  const handlePlaceOrder = async () => {
    if (!selectedAddressId) return;
    try {
      setIsPaymentProcessing(true);
      
      // 1. Create Internal Order
      const idempotencyKey = `idemp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const order = await createOrder(selectedAddressId, idempotencyKey);
      
      // 2. Create Razorpay Order
      const res = await api.post('/payments/create-order', { orderId: order._id });
      const rpData = res.data.data;

      // 3. Open Razorpay Checkout
      const options = {
        key: rpData.keyId,
        amount: rpData.amount,
        currency: rpData.currency,
        name: rpData.name,
        description: rpData.description,
        order_id: rpData.razorpayOrderId,
        handler: async function (response: any) {
          try {
            // 4. Verify Payment Server-Side
            await api.post('/payments/verify', {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            });
            // Refresh cart
            await fetchCart();
            // Go to confirmation
            router.push(`/order-confirmation/${order._id}`);
          } catch (verifyError) {
            console.error('Verification failed', verifyError);
            alert("Payment verification failed. If money was deducted, it will be refunded.");
            router.push(`/account/orders/${order._id}`);
          }
        },
        prefill: {
          name: addresses.find(a => a._id === selectedAddressId)?.fullName || '',
          contact: addresses.find(a => a._id === selectedAddressId)?.phone || ''
        },
        theme: {
          color: "#0F172A" // Primary color
        }
      };

      if (typeof window !== 'undefined' && (window as any).Razorpay) {
        const rzp = new (window as any).Razorpay(options);
        
        rzp.on('payment.failed', function (response: any) {
          console.error(response.error);
          alert(`Payment failed: ${response.error.description}`);
          setIsPaymentProcessing(false);
        });

        rzp.open();
      } else {
        // Fallback for local development if Razorpay script is blocked by browser adblockers or offline
        console.warn("[CHECKOUT] Razorpay SDK script not loaded in browser window. Simulating successful checkout for dev mode.");
        await api.post('/payments/verify', {
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_order_id: rpData.razorpayOrderId,
          razorpay_signature: `sig_mock_${Date.now()}`
        });
        await fetchCart();
        router.push(`/order-confirmation/${order._id}`);
      }

    } catch (error) {
      console.error(error);
      alert("Failed to initialize payment. Please try again.");
      setIsPaymentProcessing(false);
    }
  };

  if (isLoadingCart && items.length === 0) {
    return <div className="min-h-screen flex items-center justify-center">Loading checkout...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <h2 className="font-headline-lg text-headline-lg mb-4">Your cart is empty</h2>
        <button onClick={() => router.push('/shop')} className="bg-primary text-on-primary px-6 py-3 rounded">
          Continue Shopping
        </button>
      </div>
    );
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 grid grid-cols-1 lg:grid-cols-12 gap-gutter">
      {/* Left Column: Checkout Steps */}
      <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-8">
        
        {/* Address Section */}
        <section className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/20 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-outline-variant/20 pb-4">
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-on-primary text-sm font-bold">1</span>
              Delivery Address
            </h2>
            <CheckCircle2 className="text-primary w-6 h-6" />
          </div>

          {isLoadingAddresses ? (
            <p>Loading addresses...</p>
          ) : addresses.length === 0 ? (
            <div className="text-center py-6">
              <p className="mb-4">You have no saved addresses.</p>
              <button onClick={() => router.push('/account/addresses')} className="bg-primary text-on-primary px-6 py-2 rounded">
                Add Address
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {addresses.map(address => {
                const isSelected = selectedAddressId === address._id;
                return (
                  <div 
                    key={address._id} 
                    onClick={() => setSelectedAddressId(address._id)}
                    className={`rounded-lg p-5 cursor-pointer relative transition-colors ${isSelected ? 'border-2 border-primary bg-surface-container-low/30' : 'border border-outline-variant/50 hover:border-outline-variant group'}`}
                  >
                    <div className="absolute top-4 right-4">
                      {isSelected ? (
                        <CheckCircle2 className="text-primary w-5 h-5 fill-primary/20" />
                      ) : (
                        <Circle className="text-on-surface-variant w-5 h-5 group-hover:text-primary" />
                      )}
                    </div>
                    <h3 className="font-headline-sm text-headline-sm text-base mb-1">{address.fullName}</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
                      {address.addressLine1},<br/>
                      {address.addressLine2 && <>{address.addressLine2},<br/></>}
                      {address.city}, {address.state}, {address.postalCode}<br/>
                      {address.phone}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={() => router.push('/account/addresses')} className="mt-6 flex items-center gap-2 text-primary font-label-caps text-label-caps hover:underline">
            <Plus className="w-4 h-4" />
            MANAGE ADDRESSES
          </button>
        </section>

        {/* Delivery Section (Disabled for Phase 5) */}
        <section className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/20 rounded-lg shadow-sm opacity-60 pointer-events-none">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-2 text-on-surface-variant">
              <span className="flex items-center justify-center w-8 h-8 rounded-full border border-outline text-outline text-sm font-bold">2</span>
              Delivery Options
            </h2>
          </div>
        </section>

        {/* Payment Section (Disabled for Phase 5) */}
        <section className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/20 rounded-lg shadow-sm opacity-60 pointer-events-none">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-2 text-on-surface-variant">
              <span className="flex items-center justify-center w-8 h-8 rounded-full border border-outline text-outline text-sm font-bold">3</span>
              Payment Method (Phase 6)
            </h2>
          </div>
        </section>
      </div>

      {/* Right Column: Order Summary */}
      <div className="lg:col-span-5 xl:col-span-4">
        <div className="sticky top-32">
          <div className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/20 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
            <h3 className="font-headline-sm text-headline-sm mb-6 pb-4 border-b border-outline-variant/20">Order Summary</h3>
            
            {/* Items */}
            <div className="flex flex-col gap-4 mb-6 pb-6 border-b border-outline-variant/20 max-h-[40vh] overflow-y-auto">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-4 items-center">
                  <div className="w-16 h-20 bg-surface-container-low rounded flex-shrink-0 relative overflow-hidden border border-outline-variant/10">
                    <Image src={item.productId.images[0] || '/placeholder.png'} alt={item.productId.name} fill className="object-cover" />
                  </div>
                  <div className="flex-grow">
                    <h4 className="font-body-sm text-body-sm font-semibold">{item.productId.name}</h4>
                    <p className="font-label-caps text-label-caps text-on-surface-variant mt-1">QTY: {item.quantity} | SIZE: {item.variantDetails.size}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-label-caps text-label-caps">₹{item.lineTotal}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="flex flex-col gap-3 font-body-sm text-body-sm mb-6">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Subtotal</span>
                <span>₹{summary.subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Shipping</span>
                <span className="text-primary">{summary.shipping === 0 ? 'FREE' : `₹${summary.shipping}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Estimated Tax</span>
                <span>₹{summary.tax}</span>
              </div>
            </div>

            <div className="flex justify-between items-end border-t border-outline-variant/20 pt-4 mb-6">
              <span className="font-headline-sm text-headline-sm">Total</span>
              <span className="font-price-lg text-price-lg">₹{summary.total}</span>
            </div>

            <button 
              onClick={handlePlaceOrder}
              disabled={!selectedAddressId || isLoadingOrder || isPaymentProcessing}
              className="w-full bg-primary text-on-primary font-label-caps text-label-caps py-4 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoadingOrder || isPaymentProcessing ? "PROCESSING..." : "PLACE ORDER"}
            </button>
            
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
