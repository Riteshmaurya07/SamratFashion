"use client";

import { useAddressStore } from "@/store/useAddressStore";
import { useCartStore } from "@/store/useCartStore";
import { useOrderStore } from "@/store/useOrderStore";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Plus, X } from "lucide-react";
import Image from "next/image";

import Script from "next/script";
import { api } from "@/lib/api";

export function CheckoutClient() {
  const router = useRouter();
  const { addresses, fetchAddresses, createAddress, isLoading: isLoadingAddresses } = useAddressStore();
  const { items, summary, fetchCart, isLoading: isLoadingCart } = useCartStore();
  const { createOrder, isLoading: isLoadingOrder } = useOrderStore();
  
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [serviceability, setServiceability] = useState<{ serviceable: boolean; codAvailable: boolean; estimatedDays?: number; postalCode?: string } | null>(null);
  const [isAddAddressOpen, setIsAddAddressOpen] = useState(false);
  const [newAddrForm, setNewAddrForm] = useState({
    fullName: "",
    phone: "",
    alternatePhone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
    landmark: "",
    addressType: "HOME" as "HOME" | "WORK" | "OTHER",
  });
  const [newAddrErrors, setNewAddrErrors] = useState<Record<string, string>>({});
  const [isSavingAddr, setIsSavingAddr] = useState(false);

  const handleSaveNewAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!newAddrForm.fullName.trim()) errors.fullName = "Name is required";
    const cleanP = newAddrForm.phone.replace(/\D/g, "");
    if (!cleanP || cleanP.length !== 10 || !/^[6-9]\d{9}$/.test(cleanP)) {
      errors.phone = "Enter a valid 10-digit mobile number";
    }
    const cleanAlt = newAddrForm.alternatePhone.replace(/\D/g, "");
    if (cleanAlt) {
      if (cleanAlt.length !== 10 || !/^[6-9]\d{9}$/.test(cleanAlt)) {
        errors.alternatePhone = "Enter a valid 10-digit Indian mobile";
      } else if (cleanAlt === cleanP) {
        errors.alternatePhone = "Alternate number must be different from primary";
      }
    }
    if (!newAddrForm.addressLine1.trim()) errors.addressLine1 = "Address line 1 is required";
    if (!newAddrForm.city.trim()) errors.city = "City is required";
    if (!newAddrForm.state.trim()) errors.state = "State is required";
    const cleanPin = newAddrForm.postalCode.replace(/\D/g, "");
    if (!cleanPin || cleanPin.length !== 6) errors.postalCode = "Enter a 6-digit PIN code";

    if (Object.keys(errors).length > 0) {
      setNewAddrErrors(errors);
      return;
    }

    setIsSavingAddr(true);
    try {
      const saved = await createAddress({
        fullName: newAddrForm.fullName.trim(),
        phone: cleanP,
        alternatePhone: cleanAlt || undefined,
        addressLine1: newAddrForm.addressLine1.trim(),
        addressLine2: newAddrForm.addressLine2.trim() || undefined,
        city: newAddrForm.city.trim(),
        state: newAddrForm.state.trim(),
        postalCode: cleanPin,
        country: "India",
        landmark: newAddrForm.landmark.trim() || undefined,
        addressType: newAddrForm.addressType,
        isDefault: addresses.length === 0,
      });
      if (saved?._id) {
        setSelectedAddressId(saved._id);
      }
      setIsAddAddressOpen(false);
      setNewAddrForm({
        fullName: "",
        phone: "",
        alternatePhone: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
        landmark: "",
        addressType: "HOME",
      });
      setNewAddrErrors({});
    } catch {
      setNewAddrErrors({ general: "Failed to save address. Please check fields." });
    } finally {
      setIsSavingAddr(false);
    }
  };

  useEffect(() => {
    fetchAddresses();
    fetchCart();
  }, [fetchAddresses, fetchCart]);

  // Track begin_checkout event on mount
  useEffect(() => {
    if (items && items.length > 0) {
      import("@/lib/analytics").then(({ trackBeginCheckout }) => {
        trackBeginCheckout(summary.total, items.length);
      });
    }
  }, [items, summary.total]);

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

  useEffect(() => {
    const selected = addresses.find(a => a._id === selectedAddressId);
    if (selected && selected.postalCode) {
      api.get(`/shipping/serviceability?postalCode=${selected.postalCode}`)
        .then(res => {
          if (res.data?.success) {
            setServiceability(res.data.data);
          }
        })
        .catch(() => setServiceability(null));
    }
  }, [addresses, selectedAddressId]);

  const handlePlaceOrder = async () => {
    if (!selectedAddressId || isPaymentProcessing || isLoadingOrder) return;
    try {
      setIsPaymentProcessing(true);
      
      // 1. Create Internal Order
      const idempotencyKey = `idemp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const order = await createOrder(selectedAddressId, idempotencyKey, summary.pricingFingerprint);
      // Track payment_initiated event
      import("@/lib/analytics").then(({ trackEvent }) => {
        trackEvent("payment_initiated", {
          order_id: order.orderNumber,
          value: order.total,
          currency: "INR",
        });
      });
      
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
            const verifyRes = await api.post('/payments/verify', {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            });
            const verifyBody = verifyRes.data;
            // Refresh cart
            await fetchCart();
            // Stock/unavailability on our side: payment captured but order could not be
            // confirmed — an automatic full refund has been initiated.
            if (verifyBody?.data?.orderCancelled) {
              alert("We couldn't confirm your order because an item is no longer in stock. Your payment will be refunded automatically.");
              router.push(`/order-confirmation/${order._id}`);
              return;
            }
            // Go to confirmation
            router.push(`/order-confirmation/${order._id}`);
          } catch (verifyError) {
            console.error('Verification failed', verifyError);
            import("@/lib/analytics").then(({ trackEvent }) => {
              trackEvent("payment_failed", {
                order_id: order.orderNumber,
                value: order.total,
                currency: "INR",
              });
            });
            alert("Payment verification failed. If money was deducted, it will be refunded.");
            router.push(`/account/orders/${order._id}`);
          }
        },
        modal: {
          ondismiss: async function () {
            setIsPaymentProcessing(false);
            import("@/lib/analytics").then(({ trackEvent }) => {
              trackEvent("payment_cancelled", {
                order_id: order.orderNumber,
                value: order.total,
                currency: "INR",
              });
            });
            await fetchCart();
            alert("Payment was cancelled. Your items are still in your cart.");
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
        
        rzp.on('payment.failed', async function (response: any) {
          console.error('[RAZORPAY PAYMENT FAILED]', response.error);
          alert(`Payment failed: ${response.error?.description || 'Transaction declined.'} Your items are still in your cart.`);
          setIsPaymentProcessing(false);
          await fetchCart();
        });

        rzp.open();
      } else {
        console.error("[CHECKOUT ERROR] Razorpay SDK script failed to load or is blocked.");
        alert("Payment gateway checkout SDK could not be loaded. Please disable ad-blockers or check your connection.");
        setIsPaymentProcessing(false);
      }

    } catch (error: any) {
      console.error("[CHECKOUT INITIALIZATION ERROR]", error);
      if (error?.response?.status === 409 || error?.response?.data?.code === "PRICING_CHANGED") {
        await fetchCart();
        alert(
          error.response?.data?.message ||
            "Pricing or shipping settings were updated. Your cart summary has been refreshed. Please review the updated totals before proceeding."
        );
        setIsPaymentProcessing(false);
        return;
      }
      const apiMessage = error?.response?.data?.message || "Failed to initialize payment gateway. Please try again.";
      alert(apiMessage);
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
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-6 sm:py-8 md:py-12 pb-28 lg:pb-12 grid grid-cols-1 lg:grid-cols-12 gap-gutter">
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
              <p className="mb-4 text-sm text-neutral-600">You have no saved delivery addresses.</p>
              <button
                type="button"
                onClick={() => setIsAddAddressOpen(true)}
                className="bg-neutral-950 text-white font-mono text-xs uppercase font-bold px-6 py-2.5 rounded-lg hover:bg-neutral-800 transition-colors"
              >
                + Add Delivery Address
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
                      Phone: +91 {address.phone}
                      {address.alternatePhone && (
                        <>
                          <br />
                          <span className="text-xs text-neutral-500 font-mono">Alt: +91 {address.alternatePhone}</span>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {serviceability && (
            <div className={`mt-4 p-4 rounded-xl text-xs font-medium flex items-center gap-3 border ${
              serviceability.serviceable 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <span className="material-symbols-outlined text-base">
                {serviceability.serviceable ? 'verified' : 'distance'}
              </span>
              <div>
                {serviceability.serviceable ? (
                  <>
                    <strong className="block font-bold">Standard Delivery Available ({serviceability.estimatedDays || 3-5} Business Days)</strong>
                    <span>{serviceability.codAvailable ? 'Cash on Delivery (COD) & Prepaid payments supported.' : 'Prepaid payments supported.'}</span>
                  </>
                ) : (
                  <>
                    <strong className="block font-bold">Unserviceable Pincode</strong>
                    <span>Standard courier delivery is currently unavailable for postal code {serviceability.postalCode}.</span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setIsAddAddressOpen(true)}
              className="inline-flex items-center gap-2 bg-neutral-950 hover:bg-neutral-800 text-white font-mono text-xs uppercase tracking-wider font-bold px-4 py-2.5 rounded-lg transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              ADD NEW ADDRESS
            </button>
            <button
              type="button"
              onClick={() => router.push('/account/addresses?redirect=/checkout')}
              className="flex items-center gap-1.5 text-primary font-mono text-xs font-bold hover:underline"
            >
              MANAGE ADDRESSES
            </button>
          </div>
        </section>

        {/* Delivery Section */}
        <section className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/30 rounded-lg">
          <div className="flex items-center justify-between mb-4 border-b border-outline-variant/20 pb-4">
            <h2 className="font-headline-sm text-base md:text-lg font-bold flex items-center gap-2 text-on-surface">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-neutral-900 text-white text-xs font-bold font-mono">2</span>
              Delivery Method
            </h2>
            <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold uppercase">
              STANDARD EXPRESS
            </span>
          </div>
          <div className="p-4 rounded-md border border-outline-variant/40 bg-surface-container-low flex items-start gap-3 text-xs font-mono">
            <span className="material-symbols-outlined text-primary text-base">local_shipping</span>
            <div className="space-y-1">
              <p className="font-bold text-on-surface">Delhivery Express Courier Delivery</p>
              <p className="text-neutral-500">Orders are processed and dispatched from our primary studio within 24-48 business hours.</p>
            </div>
          </div>
        </section>

        {/* Payment Section */}
        <section className="bg-surface-container-lowest p-6 md:p-8 border border-outline-variant/30 rounded-lg">
          <div className="flex items-center justify-between mb-4 border-b border-outline-variant/20 pb-4">
            <h2 className="font-headline-sm text-base md:text-lg font-bold flex items-center gap-2 text-on-surface">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-neutral-900 text-white text-xs font-bold font-mono">3</span>
              Payment Method
            </h2>
            <span className="font-mono text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded font-bold uppercase">
              RAZORPAY SECURED
            </span>
          </div>
          <div className="p-4 rounded-md border border-outline-variant/40 bg-surface-container-low space-y-2 text-xs font-mono text-neutral-600">
            <p className="font-bold text-on-surface">Supported Payment Channels:</p>
            <p className="text-neutral-500">UPI (Google Pay, PhonePe, Paytm, BHIM), Debit/Credit Cards (Visa, MasterCard, RuPay), NetBanking, and Cash on Delivery where serviceable.</p>
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
              {items.map((item, idx) => {
                const formatPriceInINR = (amount: number): string => {
                  if (!amount) return "0";
                  return Math.round(amount).toLocaleString("en-IN");
                };

                const sizeDistributionText = item.isCustomized && item.customConfigurations
                  ? item.customConfigurations.map((c: any) => c.sizeDistribution?.map((d: any) => `${d.size} (${d.quantity})`).join(', ')).join('; ')
                  : '';

                return (
                  <div key={idx} className="flex gap-4 items-center">
                    <div className="w-16 h-20 bg-surface-container-low rounded flex-shrink-0 relative overflow-hidden border border-outline-variant/10">
                      <Image src={item.isCustomized ? (item.customizationSnapshot?.previewImage || item.variantDetails?.image || item.productId.images[0] || '/placeholder.png') : (item.variantDetails?.image || item.productId.images[0] || '/placeholder.png')} alt={item.productId.name} fill className="object-cover" />
                    </div>
                    <div className="flex-grow">
                      <h4 className="font-body-sm text-body-sm font-semibold">{item.productId.name} {item.isCustomized && "(Custom)"}</h4>
                      <p className="font-label-caps text-xs text-on-surface-variant mt-1">
                        QTY: {item.quantity}
                        {sizeDistributionText ? ` | SIZES: ${sizeDistributionText}` : (
                          <>
                            {item.variantDetails?.color ? ` | COLOR: ${item.variantDetails.color}` : ''}
                            {item.variantDetails?.size ? ` | SIZE: ${item.variantDetails.size}` : ''}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-label-caps text-label-caps font-bold">₹{formatPriceInINR(item.lineTotal)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div className="flex flex-col gap-3 font-body-sm text-body-sm mb-6">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Subtotal</span>
                <span>₹{((): string => {
                  const amt = summary.subtotal;
                  return Math.round(amt).toLocaleString("en-IN");
                })()}</span>
              </div>
              {summary.discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span className="text-on-surface-variant">Discount</span>
                  <span>-₹{((): string => {
                    const amt = summary.discount;
                    return Math.round(amt).toLocaleString("en-IN");
                  })()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Shipping</span>
                <span className="text-primary font-bold">
                  {summary.shipping === 0
                    ? `FREE ${summary.freeShippingSource === "CATEGORY_RULE" ? "(Category Offer)" : ""}`
                    : `₹${Math.round(summary.shipping).toLocaleString("en-IN")}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Estimated Tax</span>
                <span>₹{Math.round(summary.tax).toLocaleString("en-IN")}</span>
              </div>
            </div>

            <div className="flex justify-between items-end border-t border-outline-variant/20 pt-4 mb-6">
              <span className="font-headline-sm text-headline-sm">Total</span>
              <span className="font-price-lg text-price-lg font-black text-2xl text-on-surface">
                ₹{Math.round(summary.total).toLocaleString("en-IN")}
              </span>
            </div>

            <button 
              onClick={handlePlaceOrder}
              disabled={!selectedAddressId || isLoadingOrder || isPaymentProcessing}
              className="w-full bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold py-4 rounded-md hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {isLoadingOrder || isPaymentProcessing ? "PROCESSING ORDER..." : "PLACE ORDER & PAY &rarr;"}
            </button>
            
            <div className="mt-4 flex items-center justify-center gap-1.5 font-mono text-[11px] text-neutral-500">
              <span className="material-symbols-outlined text-emerald-600 text-sm">lock</span>
              <span>100% Encrypted Payment via Razorpay</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Pay Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 p-3 px-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden pb-safe">
        <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
          <div>
            <p className="font-mono text-[10px] text-neutral-500 uppercase">
              {selectedAddressId ? "Total to Pay" : "Select Address"}
            </p>
            <p className="font-price-lg text-lg font-black text-on-surface">
              ₹{Math.round(summary.total).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={!selectedAddressId || isLoadingOrder || isPaymentProcessing}
            className="flex-1 max-w-[220px] h-12 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm hover:bg-neutral-800 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <span>{isPaymentProcessing ? "PROCESSING..." : "PAY & ORDER"}</span>
            <span>&rarr;</span>
          </button>
        </div>
      </div>
    </main>
      {/* In-place Add Address Modal for Checkout */}
      {isAddAddressOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-surface border border-outline-variant/40 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <h3 className="font-headline-sm text-lg font-black uppercase text-on-surface">
                Add Delivery Address
              </h3>
              <button
                type="button"
                onClick={() => setIsAddAddressOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {newAddrErrors.general && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-mono rounded-lg border border-red-200">
                {newAddrErrors.general}
              </div>
            )}

            <form onSubmit={handleSaveNewAddress} className="space-y-4">
              <div>
                <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={newAddrForm.fullName}
                  onChange={(e) => setNewAddrForm({ ...newAddrForm, fullName: e.target.value })}
                  className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-neutral-950"
                  placeholder="e.g. Arun Kumar"
                />
                {newAddrErrors.fullName && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.fullName}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                    Primary Mobile (10 Digits) *
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-2.5 rounded-l-lg border border-r-0 border-outline-variant/60 bg-surface-container-high text-xs font-mono font-bold">+91</span>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={newAddrForm.phone}
                      onChange={(e) => setNewAddrForm({ ...newAddrForm, phone: e.target.value.replace(/\D/g, "") })}
                      className="w-full bg-surface-container-low border border-outline-variant/60 rounded-r-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-950"
                      placeholder="9876543210"
                    />
                  </div>
                  {newAddrErrors.phone && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.phone}</p>}
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                    Alternate Mobile (Optional)
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-2.5 rounded-l-lg border border-r-0 border-outline-variant/60 bg-surface-container-high text-xs font-mono font-bold">+91</span>
                    <input
                      type="tel"
                      maxLength={10}
                      value={newAddrForm.alternatePhone}
                      onChange={(e) => setNewAddrForm({ ...newAddrForm, alternatePhone: e.target.value.replace(/\D/g, "") })}
                      className="w-full bg-surface-container-low border border-outline-variant/60 rounded-r-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-950"
                      placeholder="Optional second number"
                    />
                  </div>
                  {newAddrErrors.alternatePhone && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.alternatePhone}</p>}
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                  House / Flat / Building *
                </label>
                <input
                  type="text"
                  required
                  value={newAddrForm.addressLine1}
                  onChange={(e) => setNewAddrForm({ ...newAddrForm, addressLine1: e.target.value })}
                  className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-neutral-950"
                  placeholder="e.g. Flat 302, Green Valley Apartments"
                />
                {newAddrErrors.addressLine1 && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.addressLine1}</p>}
              </div>

              <div>
                <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                  Street / Area / Locality
                </label>
                <input
                  type="text"
                  value={newAddrForm.addressLine2}
                  onChange={(e) => setNewAddrForm({ ...newAddrForm, addressLine2: e.target.value })}
                  className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-neutral-950"
                  placeholder="e.g. 5th Main, Near City Mall"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={newAddrForm.postalCode}
                    onChange={(e) => setNewAddrForm({ ...newAddrForm, postalCode: e.target.value.replace(/\D/g, "") })}
                    className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-950"
                    placeholder="560001"
                  />
                  {newAddrErrors.postalCode && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.postalCode}</p>}
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddrForm.city}
                    onChange={(e) => setNewAddrForm({ ...newAddrForm, city: e.target.value })}
                    className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-950"
                    placeholder="Bengaluru"
                  />
                  {newAddrErrors.city && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.city}</p>}
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-neutral-600 uppercase font-bold mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddrForm.state}
                    onChange={(e) => setNewAddrForm({ ...newAddrForm, state: e.target.value })}
                    className="w-full bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-950"
                    placeholder="Karnataka"
                  />
                  {newAddrErrors.state && <p className="text-xs text-red-600 mt-1 font-mono">{newAddrErrors.state}</p>}
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setIsAddAddressOpen(false)}
                  className="px-4 py-2 text-xs font-mono font-bold text-neutral-600 hover:text-neutral-950"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingAddr}
                  className="px-6 py-2.5 bg-neutral-950 hover:bg-neutral-800 text-white font-mono text-xs uppercase font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {isSavingAddr ? "Saving..." : "Save & Deliver Here"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
