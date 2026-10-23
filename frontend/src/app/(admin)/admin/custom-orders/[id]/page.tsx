"use client";

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { Loader2, ArrowLeft, Save, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { ReadOnlyDesignCanvas } from '@/components/custom-printing/ReadOnlyDesignCanvas';

export default function AdminCustomOrderDetail({ params }: { params: { id: string } }) {
  const [design, setDesign] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');

  const fetchDesign = useCallback(async () => {
    try {
      const res = await api.get(`/admin/custom-orders/${params.id}`);
      if (res.data.success) {
        setDesign(res.data.data);
        setStatus(res.data.data.status);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchDesign();
  }, [fetchDesign]);
  const handleStatusUpdate = async () => {
    setIsUpdating(true);
    try {
      await api.patch(`/admin/custom-orders/${params.id}/status`, { status });
      alert("Status updated successfully.");
      fetchDesign();
    } catch (e: any) {
      alert(e.response?.data?.message || "Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleGenerateAssets = async () => {
    setIsGenerating(true);
    try {
      await api.post(`/admin/custom-orders/${params.id}/generate-assets`);
      alert("Production assets generated successfully.");
      fetchDesign();
    } catch (e: any) {
      alert(e.response?.data?.message || "Failed to generate assets (Mock service returned UNAVAILABLE).");
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Loader2 className="animate-spin text-gray-400 w-12 h-12" />
      </div>
    );
  }

  if (!design) {
    return <div className="p-6 text-red-500">Design not found.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/custom-orders" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Custom Order: {design.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-black outline-none"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="PREVIEW_GENERATED">PREVIEW_GENERATED</option>
            <option value="CUSTOMER_REVIEW">CUSTOMER_REVIEW</option>
            <option value="CUSTOMER_APPROVED">CUSTOMER_APPROVED</option>
            <option value="PRODUCTION_VALIDATION">PRODUCTION_VALIDATION</option>
            <option value="PRODUCTION_READY">PRODUCTION_READY</option>
            <option value="REVISION_REQUESTED">REVISION_REQUESTED</option>
            <option value="IN_PRODUCTION">IN_PRODUCTION</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
          <button
            onClick={handleStatusUpdate}
            disabled={isUpdating || status === design.status}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Update Status
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer & Order Information */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h2 className="font-bold text-gray-900 mb-4 uppercase tracking-wider text-sm border-b pb-2">Customer Details</h2>
            <div className="space-y-2 text-sm text-gray-600">
              <p><span className="font-medium text-gray-900">Name:</span> {design.userId?.name}</p>
              <p><span className="font-medium text-gray-900">Email:</span> {design.userId?.email}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h2 className="font-bold text-gray-900 mb-4 uppercase tracking-wider text-sm border-b pb-2">Order Link</h2>
            {design.orderId ? (
              <div className="space-y-3 text-sm">
                <p><span className="font-medium text-gray-900">Order #:</span> <Link href={`/admin/orders/${design.orderId._id}`} className="text-blue-600 hover:underline">{design.orderId.orderNumber}</Link></p>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">Fulfillment:</span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-700">{design.orderId.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">Payment:</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${design.orderId.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {design.orderId.paymentStatus}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 text-sm p-3 bg-amber-50 rounded-lg">
                <AlertCircle size={16} />
                <span>Not linked to a checkout order yet.</span>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h2 className="font-bold text-gray-900 mb-4 uppercase tracking-wider text-sm border-b pb-2">Product Configurations</h2>
            <div className="space-y-2 text-sm text-gray-600">
              <p><span className="font-medium text-gray-900">Product:</span> {design.productId?.name}</p>
              <p><span className="font-medium text-gray-900">Color:</span> {design.selectedColor}</p>
              <p><span className="font-medium text-gray-900">Base Price:</span> ₹{design.productId?.basePrice}</p>
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <h3 className="font-medium text-gray-900 text-sm mb-2">Version History</h3>
              <p className="text-sm text-gray-600">Current Version: <span className="font-bold">{design.currentVersion}</span></p>
              {design.approvedVersion && (
                <p className="text-sm text-green-600 font-medium">Approved Version: {design.approvedVersion}</p>
              )}
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h2 className="font-bold text-gray-900 mb-4 uppercase tracking-wider text-sm border-b pb-2">Asset Pipeline</h2>
            <div className="space-y-4 text-sm">
              <p className="text-gray-600">Generate high-resolution production assets from the approved layout. Only available if design is approved.</p>
              
              {design.approvedVersion ? (
                <button
                  onClick={handleGenerateAssets}
                  disabled={isGenerating || !['CUSTOMER_APPROVED', 'PRODUCTION_VALIDATION'].includes(design.status)}
                  className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : null}
                  {isGenerating ? 'Generating...' : 'Generate Production Assets'}
                </button>
              ) : (
                <p className="text-amber-600 font-medium text-xs bg-amber-50 p-2 rounded border border-amber-200">
                  Awaiting Customer Approval before assets can be generated.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Visual Design Rendering */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h2 className="font-bold text-gray-900 mb-4 uppercase tracking-wider text-sm border-b pb-2">Design Layout</h2>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase text-center">Front</h3>
              <div className="flex justify-center bg-gray-50 p-4 rounded-lg">
                <ReadOnlyDesignCanvas design={design.design} zone="front" width={250} height={300} />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase text-center">Back</h3>
              <div className="flex justify-center bg-gray-50 p-4 rounded-lg">
                <ReadOnlyDesignCanvas design={design.design} zone="back" width={250} height={300} />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase text-center">Left Sleeve</h3>
              <div className="flex justify-center bg-gray-50 p-4 rounded-lg">
                <ReadOnlyDesignCanvas design={design.design} zone="leftSleeve" width={200} height={200} />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase text-center">Right Sleeve</h3>
              <div className="flex justify-center bg-gray-50 p-4 rounded-lg">
                <ReadOnlyDesignCanvas design={design.design} zone="rightSleeve" width={200} height={200} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
