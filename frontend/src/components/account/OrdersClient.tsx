"use client";

import { useOrderStore } from "@/store/useOrderStore";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Package, ChevronRight } from "lucide-react";
import Image from "next/image";

export function OrdersClient() {
  const router = useRouter();
  const { orders, fetchOrders, isLoading } = useOrderStore();

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return (
    <div className="flex-grow flex flex-col w-full max-w-4xl">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 pb-5 border-b border-outline-variant/30">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight mb-1.5">ORDER HISTORY</h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant">Track shipments, view detailed specs, and download GST tax invoices.</p>
        </div>
      </div>

      {isLoading && orders.length === 0 ? (
        <p>Loading orders...</p>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 bg-surface-container-lowest border border-outline-variant/30 rounded-xl">
          <Package className="w-12 h-12 text-outline-variant mx-auto mb-4" />
          <h3 className="font-headline-sm font-semibold mb-2">No orders found</h3>
          <p className="text-on-surface-variant mb-6">You haven't placed any orders yet.</p>
          <button 
            onClick={() => router.push('/shop')}
            className="px-6 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-md hover:bg-neutral-800 transition-colors shadow-sm"
          >
            EXPLORE CATALOG DROPS
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <div key={order._id} className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden hover:shadow-[0_12px_40px_rgba(15,23,42,0.06)] transition-all">
              <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/20 flex flex-wrap justify-between items-center gap-4">
                <div>
                  <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">Order Placed</p>
                  <p className="font-headline-sm font-semibold text-[15px]">{new Date(order.createdAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">Total</p>
                  <p className="font-headline-sm font-semibold text-[15px]">₹{order.total}</p>
                </div>
                <div>
                  <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">Order #</p>
                  <p className="font-headline-sm font-semibold text-[15px]">{order.orderNumber}</p>
                </div>
                <button 
                  onClick={() => router.push(`/account/orders/${order._id}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded hover:bg-neutral-800 transition-colors"
                >
                  DETAILS &amp; INVOICE
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    order.status === 'DELIVERED' ? 'bg-green-100 text-green-800' : 
                    order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 
                    'bg-primary/10 text-primary'
                  }`}>
                    {order.status}
                  </span>
                </div>

                <div className="flex flex-col gap-4">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex gap-4 items-center">
                      <div className="w-16 h-20 bg-surface-container shrink-0 rounded border border-outline-variant/10 relative">
                        <Image src={item.productImage || '/placeholder.png'} alt={item.productName} fill className="object-cover" />
                      </div>
                      <div>
                        <h4 className="font-body-sm font-semibold">{item.productName}</h4>
                        <p className="text-on-surface-variant text-sm mt-1">Size: {item.selectedSize} | Color: {item.selectedColor}</p>
                        <p className="text-on-surface-variant text-sm mt-1">Qty: {item.quantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
