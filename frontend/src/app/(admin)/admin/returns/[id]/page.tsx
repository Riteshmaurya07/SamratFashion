"use client";

import { useEffect, useState, use } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const returnId = unwrappedParams.id;
  
  const [ret, setRet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);

  const fetchReturn = async () => {
    try {
      const res = await api.get(`/admin/returns/${returnId}`);
      setRet(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load return details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturn();
  }, [returnId]);

  const handleAction = async (action: string) => {
    const note = window.prompt("Enter admin note (optional):");
    if (note === null) return;

    setStatusLoading(true);
    try {
      await api.post(`/admin/returns/${returnId}/${action}`, { adminNote: note });
      await fetchReturn();
    } catch (err: any) {
      alert(err.response?.data?.message || `Failed to ${action} return`);
    } finally {
      setStatusLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "REQUESTED": 
      case "INSPECTING": return "bg-secondary-container/10 text-secondary border-secondary/20";
      case "APPROVED": return "bg-primary-container/20 text-primary border-primary/20";
      case "RECEIVED": return "bg-primary-container/20 text-primary border-primary/20";
      case "ACCEPTED": 
      case "COMPLETED": return "bg-[#eef0ff] text-[#003ea8] border-[#b4c5ff]";
      case "REJECTED":
      case "REJECTED_AFTER_INSPECTION": return "bg-error-container/20 text-error border-error/20";
      default: return "bg-surface-container-high text-on-surface border-outline-variant/30";
    }
  };

  if (loading) return <div className="p-8 text-center text-on-surface-variant">Loading return details...</div>;
  if (error) return <div className="p-8 text-error bg-error-container/20">{error}</div>;
  if (!ret) return <div className="p-8 text-on-surface-variant">Return not found</div>;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back Button */}
      <div>
        <Link href="/admin/returns" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px]">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO RETURNS
        </Link>
      </div>

      {/* Return Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_4px_20px_rgba(15,23,42,0.02)]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-headline-lg text-headline-lg text-on-surface">Return #{ret._id}</h2>
            <span className={`px-3 py-1 border rounded-full font-label-caps text-[10px] flex items-center gap-1 ${getStatusColor(ret.status)}`}>
              {ret.status}
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">calendar_today</span>
            {new Date(ret.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto mt-4 md:mt-0">
          <Link href={`/admin/orders/${ret.orderId}`} className="px-4 py-2 bg-surface-container-low text-on-surface border border-outline-variant/30 rounded-lg font-label-caps text-[12px] hover:bg-surface-container-high transition-colors flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            View Original Order
          </Link>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column (Wider) */}
        <div className="xl:col-span-2 space-y-6">
          {/* Return Items */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20 bg-surface-bright flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">inventory_2</span> Return Items
              </h3>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{ret.items.length} {ret.items.length === 1 ? 'Item' : 'Items'}</span>
            </div>
            <div className="p-4 space-y-4">
              {ret.items.map((item: any, i: number) => (
                <div key={i} className="flex flex-col sm:flex-row items-start gap-4 pb-4 border-b border-outline-variant/20 last:border-0 last:pb-0">
                  <div className="w-20 h-24 bg-surface-container-low rounded border border-outline-variant/20 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-outline">image</span>
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-headline-sm text-[16px] text-on-surface pr-2">Variant ID: {item.variantId}</h4>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-label-caps text-on-surface">Qty: {item.quantity}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-error/5 border border-error/10 rounded-lg">
                      <p className="font-label-caps text-[10px] text-error mb-1">RETURN REASON</p>
                      <p className="font-body-sm text-body-sm text-on-surface">{item.reason}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
             <div className="p-4 border-b border-outline-variant/20 bg-surface-bright">
              <h3 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">notes</span> Notes & Context
              </h3>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <strong className="block mb-2 font-label-caps text-[10px] text-on-surface-variant">CUSTOMER NOTE</strong>
                <p className="font-body-sm text-[14px] text-on-surface bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  {ret.customerNote || <span className="italic text-on-surface-variant">No notes provided by customer.</span>}
                </p>
              </div>
              {ret.adminNote && (
                <div>
                  <strong className="block mb-2 font-label-caps text-[10px] text-primary">ADMIN NOTE</strong>
                  <p className="font-body-sm text-[14px] text-on-surface bg-primary/5 p-4 rounded-lg border border-primary/10">
                    {ret.adminNote}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Customer Card */}
          {ret.userId && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => router.push(`/admin/customers/${ret.userId._id}`)}>
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-headline-sm text-[16px] text-on-surface">Customer</h3>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors text-[20px]">arrow_outward</span>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface font-headline-sm font-bold uppercase">
                  {ret.userId.name?.substring(0, 2) || "U"}
                </div>
                <div>
                  <p className="font-headline-sm text-[15px] text-on-surface">{ret.userId.name || "Unknown"}</p>
                </div>
              </div>
              <div className="space-y-2 font-body-sm text-[13px] text-on-surface-variant break-all">
                <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">mail</span> {ret.userId.email}</p>
              </div>
            </div>
          )}

          {/* Workflow Actions */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5">
            <h3 className="font-headline-sm text-[16px] text-on-surface mb-4">Workflow Actions</h3>
            
            <div className="space-y-3">
              {ret.status === 'REQUESTED' && (
                <>
                  <button onClick={() => handleAction('approve')} disabled={statusLoading} className="w-full py-2.5 bg-primary text-on-primary rounded-lg font-label-caps text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50">
                    Approve Return
                  </button>
                  <button onClick={() => handleAction('reject')} disabled={statusLoading} className="w-full py-2.5 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-[12px] hover:bg-error-container/30 transition-colors disabled:opacity-50">
                    Reject Return
                  </button>
                </>
              )}
              {ret.status === 'APPROVED' && (
                <button onClick={() => handleAction('receive')} disabled={statusLoading} className="w-full py-2.5 bg-primary text-on-primary rounded-lg font-label-caps text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50">
                  Mark as Received
                </button>
              )}
              {ret.status === 'RECEIVED' && (
                <button onClick={() => handleAction('inspect')} disabled={statusLoading} className="w-full py-2.5 bg-secondary text-on-secondary rounded-lg font-label-caps text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50">
                  Begin Inspection
                </button>
              )}
              {ret.status === 'INSPECTING' && (
                <>
                  <button onClick={async () => {
                    if (confirm('Accepting will AUTOMATICALLY trigger a Razorpay refund and restore inventory. Proceed?')) {
                      handleAction('accept');
                    }
                  }} disabled={statusLoading} className="w-full py-2.5 bg-primary text-on-primary rounded-lg font-label-caps text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50 flex flex-col items-center leading-tight">
                    <span>Accept & Auto-Refund</span>
                    <span className="text-[9px] opacity-80 normal-case font-body-sm font-normal mt-0.5">(Refunds via Razorpay & restores inventory)</span>
                  </button>
                  <button onClick={() => handleAction('reject-after-inspection')} disabled={statusLoading} className="w-full py-2.5 bg-error-container/20 text-error border border-error/20 rounded-lg font-label-caps text-[12px] hover:bg-error-container/30 transition-colors disabled:opacity-50">
                    Reject (Failed Inspection)
                  </button>
                </>
              )}
              {['ACCEPTED', 'COMPLETED', 'REJECTED', 'REJECTED_AFTER_INSPECTION', 'CANCELLED'].includes(ret.status) && (
                <div className="p-4 bg-surface-container-low rounded-lg text-center">
                  <span className="material-symbols-outlined text-[24px] text-on-surface-variant mb-2">lock</span>
                  <p className="font-body-sm text-[13px] text-on-surface-variant">This return workflow is locked. No further actions can be taken.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="h-8"></div>
    </div>
  );
}
