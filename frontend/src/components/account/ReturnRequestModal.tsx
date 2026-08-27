"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { X, AlertCircle } from "lucide-react";
import Image from "next/image";

export function ReturnRequestModal({ order, onClose, onSuccess }: { order: any, onClose: () => void, onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  
  // Calculate returnable items
  const returnedQuantities: Record<string, number> = {};
  if (order.returns) {
    order.returns.forEach((r: any) => {
      if (!['CANCELLED', 'REJECTED', 'REJECTED_AFTER_INSPECTION'].includes(r.status)) {
        r.items.forEach((item: any) => {
          returnedQuantities[item.variantId] = (returnedQuantities[item.variantId] || 0) + item.quantity;
        });
      }
    });
  }

  const returnableItems = order.items.map((item: any) => ({
    ...item,
    returnableQty: item.quantity - (returnedQuantities[item.variantId] || 0),
    selectedQty: 0,
    reason: 'OTHER'
  })).filter((item: any) => item.returnableQty > 0);

  const [items, setItems] = useState(returnableItems);

  const handleSubmit = async () => {
    const selectedItems = items.filter((i: any) => i.selectedQty > 0).map((i: any) => ({
      variantId: i.variantId,
      quantity: i.selectedQty,
      reason: i.reason
    }));

    if (selectedItems.length === 0) {
      setError("Please select at least one item to return");
      return;
    }

    setLoading(true);
    setError("");
    
    try {
      await api.post(`/orders/${order._id}/returns`, {
        items: selectedItems,
        customerNote
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to submit return request");
    } finally {
      setLoading(false);
    }
  };

  if (returnableItems.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-surface-container-lowest p-6 rounded-xl w-full max-w-md relative">
          <button onClick={onClose} className="absolute right-4 top-4 text-on-surface-variant hover:text-on-surface"><X className="w-5 h-5"/></button>
          <h2 className="font-headline-sm text-headline-sm mb-4">Request Return</h2>
          <p className="text-on-surface-variant">There are no items eligible for return in this order.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-container-lowest rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative border border-outline-variant/20 shadow-xl">
        <div className="sticky top-0 bg-surface-container-lowest z-10 px-6 py-4 border-b border-outline-variant/20 flex justify-between items-center">
          <h2 className="font-headline-sm text-headline-sm">Request Return</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface"><X className="w-6 h-6"/></button>
        </div>
        
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <h3 className="font-title-md text-title-md font-semibold">Select items to return</h3>
            {items.map((item: any, idx: number) => (
              <div key={idx} className="flex gap-4 p-4 border border-outline-variant/20 rounded-lg bg-surface">
                <div className="w-16 h-20 bg-surface-container rounded shrink-0 relative overflow-hidden">
                  <Image src={item.productImage || '/placeholder.png'} alt={item.productName} fill className="object-cover" />
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="font-label-lg font-bold">{item.productName}</h4>
                    <p className="text-sm text-on-surface-variant">Size: {item.selectedSize} | Color: {item.selectedColor}</p>
                  </div>
                  <div className="flex gap-4 items-center mt-2">
                    <div className="flex-1">
                      <label className="text-xs text-on-surface-variant block mb-1">Return Qty (Max {item.returnableQty})</label>
                      <select 
                        value={item.selectedQty}
                        onChange={(e) => {
                          const newItems = [...items];
                          newItems[idx].selectedQty = parseInt(e.target.value);
                          setItems(newItems);
                        }}
                        className="w-full bg-surface-container border border-outline-variant/30 rounded p-1 text-sm focus:outline-primary"
                      >
                        <option value={0}>0</option>
                        {Array.from({length: item.returnableQty}, (_, i) => i + 1).map(num => (
                          <option key={num} value={num}>{num}</option>
                        ))}
                      </select>
                    </div>
                    {item.selectedQty > 0 && (
                      <div className="flex-[2]">
                        <label className="text-xs text-on-surface-variant block mb-1">Reason</label>
                        {!!item.customDesignId || (item.customizationSnapshot && !!item.customizationSnapshot.previewImage) ? (
                          <>
                            <select
                              value={['DAMAGED', 'WRONG_PRODUCT'].includes(item.reason) ? item.reason : 'DAMAGED'}
                              onChange={(e) => {
                                const newItems = [...items];
                                newItems[idx].reason = e.target.value;
                                setItems(newItems);
                              }}
                              className="w-full bg-surface-container border border-outline-variant/30 rounded p-1 text-sm focus:outline-primary font-bold text-red-700"
                            >
                              <option value="DAMAGED">Damaged Item</option>
                              <option value="WRONG_PRODUCT">Wrong Product / Wrong Package</option>
                            </select>
                            <span className="text-[10px] text-amber-700 font-bold block mt-1">
                              Custom-printed items are non-returnable except for damaged or incorrect products.
                            </span>
                          </>
                        ) : (
                          <select
                            value={item.reason}
                            onChange={(e) => {
                              const newItems = [...items];
                              newItems[idx].reason = e.target.value;
                              setItems(newItems);
                            }}
                            className="w-full bg-surface-container border border-outline-variant/30 rounded p-1 text-sm focus:outline-primary"
                          >
                            <option value="WRONG_SIZE">Wrong Size</option>
                            <option value="WRONG_PRODUCT">Wrong Product</option>
                            <option value="DAMAGED">Damaged</option>
                            <option value="DEFECTIVE">Defective</option>
                            <option value="NOT_AS_DESCRIBED">Not as Described</option>
                            <option value="OTHER">Other</option>
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="font-title-md text-title-md font-semibold block mb-2">Additional Notes (Optional)</label>
            <textarea
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant/30 rounded-lg p-3 min-h-[100px] focus:outline-primary"
              placeholder="Tell us more about why you are returning these items..."
            ></textarea>
          </div>
        </div>

        <div className="sticky bottom-0 bg-surface-container-lowest z-10 px-6 py-4 border-t border-outline-variant/20 flex justify-end gap-4">
          <button onClick={onClose} disabled={loading} className="px-6 py-2 rounded-lg font-label-lg font-bold hover:bg-surface-container disabled:opacity-50">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-lg font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {loading ? "Submitting..." : "Submit Return"}
          </button>
        </div>
      </div>
    </div>
  );
}
