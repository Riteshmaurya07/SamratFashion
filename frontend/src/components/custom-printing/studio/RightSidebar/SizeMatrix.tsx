"use client";

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCustomDesignStore } from '@/store/useCustomDesignStore';
import { useCartStore } from '@/store/useCartStore';

export const SizeMatrix = () => {
  const { 
    productId, variantId, designId,
    configurations, activeConfigIndex, setActiveConfiguration, addConfiguration,
    updateSizeQuantity, pricing, isCalculatingPrice, fetchPricing 
  } = useCustomDesignStore();
  
  const { addItem, isLoading: isCartLoading } = useCartStore();
  const router = useRouter();

  const [newColor, setNewColor] = useState('#000000');

  // Debounce pricing fetch when sizes change
  useEffect(() => {
    const totalQty = configurations.reduce((sum, c) => sum + c.sizes.reduce((s, size) => s + size.quantity, 0), 0);
    if (totalQty > 0) {
      const timer = setTimeout(() => fetchPricing(), 500);
      return () => clearTimeout(timer);
    }
  }, [configurations, fetchPricing]);

  const activeConfig = configurations[activeConfigIndex];
  const totalQty = configurations.reduce((sum, c) => sum + c.sizes.reduce((s, size) => s + size.quantity, 0), 0);

  const handleAddToCart = async () => {
    if (!productId || !variantId || !designId) {
      alert("Please save your design first.");
      return;
    }

    const customConfigsPayload = configurations
      .filter(c => c.sizes.some(s => s.quantity > 0))
      .map(c => ({
        color: c.color,
        variantId: c.variantId || variantId, // fallback to base variantId
        designId,
        sizeDistribution: c.sizes.filter(s => s.quantity > 0)
      }));

    if (customConfigsPayload.length === 0) return;

    try {
      await addItem(
        productId,
        variantId,
        1, // base quantity (overridden by sizes)
        designId,
        true, // isCustomized
        customConfigsPayload
      );
      router.push("/cart");
    } catch (e) {
      console.error(e);
      alert("Failed to add to cart.");
    }
  };

  return (
    <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex flex-col h-full">
      <h3 className="font-semibold text-gray-800 mb-4 uppercase text-xs tracking-wider flex justify-between items-center">
        <span>Configurations</span>
      </h3>
      
      {/* Configuration Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {configurations.map((config, idx) => (
          <button
            key={idx}
            onClick={() => setActiveConfiguration(idx)}
            className={`w-8 h-8 rounded-full border-2 transition-transform ${activeConfigIndex === idx ? 'border-black scale-110 shadow-md' : 'border-transparent'}`}
            style={{ backgroundColor: config.color }}
            title={`Color ${config.color}`}
          />
        ))}
        <div className="flex items-center space-x-1 ml-2">
          <input 
            type="color" 
            value={newColor} 
            onChange={e => setNewColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-gray-200 p-0 overflow-hidden" 
          />
          <button 
            onClick={() => addConfiguration(newColor)}
            className="p-1 rounded-full bg-gray-200 hover:bg-black hover:text-white transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <h4 className="text-xs text-gray-600 mb-3">Sizes for active color: {activeConfig?.color}</h4>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {activeConfig?.sizes.map((s) => (
          <div key={s.size} className="flex items-center justify-between bg-white p-2 border border-gray-200 rounded shadow-sm">
            <span className="text-sm font-medium w-8 text-center">{s.size}</span>
            <input
              type="number"
              min="0"
              value={s.quantity || ''}
              onChange={(e) => updateSizeQuantity(activeConfigIndex, s.size, parseInt(e.target.value) || 0)}
              className="w-16 text-center text-sm border-b border-gray-200 focus:border-black outline-none bg-transparent"
              placeholder="0"
            />
          </div>
        ))}
      </div>

      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mt-auto">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Price Summary</h4>
        
        {isCalculatingPrice ? (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-gray-400" />
          </div>
        ) : pricing ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Base Garments ({totalQty})</span>
              <span>₹{pricing.subtotal - pricing.printCharges + pricing.bulkDiscount}</span>
            </div>
            {pricing.printCharges > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Print Charges</span>
                <span>₹{pricing.printCharges}</span>
              </div>
            )}
            {pricing.bulkDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Bulk Discount</span>
                <span>-₹{pricing.bulkDiscount}</span>
              </div>
            )}
            <div className="pt-2 border-t border-gray-100 flex justify-between font-bold text-lg mt-2">
              <span>Total</span>
              <span>₹{pricing.total}</span>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400 text-sm py-2">
            Enter quantities to calculate price
          </div>
        )}
        
        <button 
          onClick={handleAddToCart}
          disabled={totalQty === 0 || isCartLoading || !designId}
          className={`w-full mt-4 py-3 rounded-lg font-semibold text-sm transition-colors flex justify-center items-center gap-2 ${
            totalQty > 0 && designId
              ? 'bg-black text-white hover:bg-gray-800' 
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isCartLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isCartLoading ? 'Adding...' : !designId ? 'Save Design First' : 'Add to Cart'}
        </button>
      </div>
    </div>
  );
};
