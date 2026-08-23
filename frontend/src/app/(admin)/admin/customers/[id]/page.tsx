"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

export default function AdminCustomerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const customerId = unwrappedParams.id;

  const [customer, setCustomer] = useState<any>(null);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [statistics, setStatistics] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);

  const fetchCustomer = useCallback(async () => {
    try {
      const res = await api.get(`/admin/customers/${customerId}`);
      const data = res.data.data;
      setCustomer(data.customer);
      setAddresses(data.addresses);
      setStatistics(data.statistics);
      setOrders(data.orders);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load customer details");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const toggleStatus = async (newStatus: string) => {
    if (newStatus === "SUSPENDED") {
      const confirmed = window.confirm("WARNING: Suspending this customer will immediately revoke all their active sessions and prevent future logins. Orders will NOT be cancelled. Are you sure you want to suspend this user?");
      if (!confirmed) return;
    }

    setStatusUpdating(true);
    try {
      await api.patch(`/admin/customers/${customerId}/status`, { status: newStatus });
      fetchCustomer();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update status");
    } finally {
      setStatusUpdating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "ACTIVE": return "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20";
      case "SUSPENDED": return "bg-error-container/20 text-error border border-error/20";
      case "DISABLED": return "bg-surface-container-high text-on-surface-variant border border-outline/20";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  if (loading) return <div className="p-8 text-center text-on-surface-variant">Loading customer details...</div>;
  if (error) return <div className="p-8 text-error bg-error-container/20">{error}</div>;
  if (!customer) return <div className="p-8 text-on-surface-variant">Customer not found.</div>;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back Button */}
      <div>
        <Link href="/admin/customers" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px]">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO CUSTOMERS
        </Link>
      </div>

      {/* Customer Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_4px_20px_rgba(15,23,42,0.02)]">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-headline-lg font-bold text-[24px] uppercase border border-primary/20">
            {customer.name?.substring(0, 2) || "U"}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="font-headline-lg text-headline-lg text-on-surface">{customer.name}</h2>
              <span className={`px-3 py-1 border rounded-full font-label-caps text-[10px] flex items-center gap-1 ${getStatusColor(customer.status)}`}>
                {customer.status}
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">mail</span>
              {customer.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0">
          {customer.role === "SUPER_ADMIN" ? (
            <div className="px-4 py-2 bg-secondary-container/10 text-secondary border border-secondary/20 rounded-lg font-label-caps text-[10px]">
              SUPER_ADMIN (IMMUTABLE)
            </div>
          ) : customer.status === "ACTIVE" ? (
            <button 
              disabled={statusUpdating}
              onClick={() => toggleStatus("SUSPENDED")}
              className="px-6 py-2 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-label-caps hover:bg-error-container/30 transition-colors flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">block</span>
              Suspend Account
            </button>
          ) : customer.status === "SUSPENDED" ? (
            <button 
              disabled={statusUpdating}
              onClick={() => toggleStatus("ACTIVE")}
              className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2 flex-1 md:flex-none justify-center disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              Reactivate Account
            </button>
          ) : null}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column (Wider) */}
        <div className="xl:col-span-2 space-y-6">
          {/* Statistics Card */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20 bg-surface-bright">
              <h3 className="font-headline-sm text-[16px] text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">analytics</span> Statistics
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="font-label-caps text-[10px] text-on-surface-variant mb-1">Total Paid</div>
                  <div className="font-price-lg text-[24px] text-on-surface">₹{(statistics?.totalPaidAmount || 0).toLocaleString()}</div>
                </div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="font-label-caps text-[10px] text-on-surface-variant mb-1">Total Orders</div>
                  <div className="font-price-lg text-[24px] text-on-surface">{statistics?.totalOrders || 0}</div>
                </div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="font-label-caps text-[10px] text-on-surface-variant mb-1">Paid Orders</div>
                  <div className="font-price-lg text-[24px] text-on-surface">{statistics?.paidOrders || 0}</div>
                </div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-error/10 bg-error/5">
                  <div className="font-label-caps text-[10px] text-error mb-1">Cancelled</div>
                  <div className="font-price-lg text-[24px] text-error">{statistics?.cancelledOrders || 0}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Order History */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20 bg-surface-bright flex justify-between items-center">
              <h3 className="font-headline-sm text-[16px] text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">shopping_bag</span> Order History
              </h3>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{orders.length} {orders.length === 1 ? 'Order' : 'Orders'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap">Order Number</th>
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap">Date</th>
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap text-center">Items</th>
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap">Total</th>
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap text-center">Status</th>
                    <th className="py-3 px-4 font-label-caps text-[10px] text-outline font-medium tracking-wider whitespace-nowrap text-right">View</th>
                  </tr>
                </thead>
                <tbody className="font-body-sm text-body-sm text-on-surface">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-on-surface-variant">No orders found.</td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o._id} className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 cursor-pointer transition-colors" onClick={() => router.push(`/admin/orders/${o._id}`)}>
                        <td className="py-3 px-4 font-mono text-[11px] text-primary">{o.orderNumber}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-on-surface-variant">
                          {new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-3 px-4 text-center">{o.itemCount}</td>
                        <td className="py-3 px-4 font-medium">₹{o.total.toLocaleString()}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-label-caps border ${
                            o.status === 'DELIVERED' ? 'bg-[#eef0ff] text-[#003ea8] border-[#b4c5ff]' : 
                            o.status === 'CANCELLED' ? 'bg-error-container/20 text-error border-error/20' : 
                            'bg-surface-container-high text-on-surface border-outline-variant/30'
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="material-symbols-outlined text-[18px] text-outline hover:text-primary transition-colors">chevron_right</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column (Narrower) */}
        <div className="space-y-6">
          {/* Profile Card */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">person</span> Profile Details
            </h3>
            <div className="space-y-3 font-body-sm text-[13px]">
              <div className="flex justify-between border-b border-outline-variant/10 pb-2">
                <span className="text-on-surface-variant">Customer ID</span>
                <span className="font-mono text-[11px] text-on-surface">{customer._id}</span>
              </div>
              <div className="flex justify-between border-b border-outline-variant/10 pb-2">
                <span className="text-on-surface-variant">Phone</span>
                <span className="text-on-surface">{customer.phone || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-outline-variant/10 pb-2">
                <span className="text-on-surface-variant">Role</span>
                <span className="text-on-surface">{customer.role}</span>
              </div>
              <div className="flex justify-between pb-1">
                <span className="text-on-surface-variant">Joined Date</span>
                <span className="text-on-surface">{new Date(customer.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">location_on</span> Addresses
              </span>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{addresses.length}</span>
            </h3>
            
            <div className="space-y-4">
              {addresses.length === 0 ? (
                <p className="text-on-surface-variant text-[13px] italic">No addresses saved.</p>
              ) : (
                addresses.map((addr) => (
                  <div key={addr._id} className="border border-outline-variant/20 p-4 rounded-lg relative text-[13px] bg-surface-container-low">
                    {addr.isDefault && <span className="absolute top-3 right-3 bg-primary-container/20 text-primary border border-primary/20 text-[9px] font-label-caps px-2 py-0.5 rounded">DEFAULT</span>}
                    <div className="font-medium text-on-surface mb-1 flex items-center gap-2">
                      {addr.fullName}
                      <span className="text-[9px] bg-outline-variant/20 px-1.5 py-0.5 rounded text-on-surface-variant font-label-caps">{addr.addressType}</span>
                    </div>
                    <div className="text-on-surface-variant flex items-center gap-1 mb-2">
                      <span className="material-symbols-outlined text-[14px]">call</span> {addr.phone}
                    </div>
                    <div className="text-on-surface-variant leading-relaxed">
                      {addr.addressLine1}<br/>
                      {addr.addressLine2 && <>{addr.addressLine2}<br/></>}
                      {addr.city}, {addr.state} {addr.postalCode}<br/>
                      {addr.country}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="h-8"></div>
    </div>
  );
}
