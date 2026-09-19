"use client";

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Search, Eye } from 'lucide-react';
import Link from 'next/link';

export default function AdminCustomOrdersPage() {
  const [designs, setDesigns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [queueTab, setQueueTab] = useState<'all' | 'awaiting_mockup'>('all');

  const fetchDesigns = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/admin/custom-orders', {
        params: { q: search, productionStatus: statusFilter }
      });
      if (res.data.success) {
        const orders = res.data.data.items || res.data.data;
        const rows = orders.flatMap((order: any) =>
          (order.customItems || []).map((customItem: any) => ({
            ...customItem.item,
            _id: customItem.item?._id,
            orderId: order._id,
            orderNumber: order.orderNumber,
            customer: order.user,
            orderStatus: order.status,
            paymentStatus: order.paymentStatus,
            printJob: customItem.printJob,
          }))
        );
        let items = rows;
        if (queueTab === 'awaiting_mockup') {
          items = items.filter((item: any) => item.approvalStatus === 'pending_design' || item.approvalStatus === 'revision_requested');
          items.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        }
        setDesigns(items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDesigns();
  }, [statusFilter, queueTab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDesigns();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom POD Orders & Mockup Queue</h1>
          <p className="text-xs text-gray-500 mt-1">Manage custom design requests and staff mockup upload workflow.</p>
        </div>

        {/* Queue Filter Tabs */}
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
          <button
            onClick={() => setQueueTab('all')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              queueTab === 'all' ? 'bg-white text-black shadow-sm' : 'text-gray-600 hover:text-black'
            }`}
          >
            All Custom Orders
          </button>
          <button
            onClick={() => setQueueTab('awaiting_mockup')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              queueTab === 'awaiting_mockup' ? 'bg-red-600 text-white shadow-sm' : 'text-red-600 hover:bg-red-50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-current animate-pulse"></span>
            Orders Awaiting Mockup (Oldest First)
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search designs..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 text-sm font-medium">
            Search
          </button>
        </form>

        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black bg-white text-sm"
        >
          <option value="">All Statuses</option>
          <option value="pending_design">Awaiting Mockup (pending_design)</option>
          <option value="mockup_sent">Mockup Sent</option>
          <option value="approved">Approved by Customer</option>
          <option value="revision_requested">Revision Requested</option>
          <option value="in_production">In Production</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-gray-400 w-10 h-10" />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-sm font-semibold uppercase tracking-wider">
                <th className="p-4">Design Name</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Product</th>
                <th className="p-4">Order Link</th>
                <th className="p-4">Design Status</th>
                <th className="p-4">Updated At</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {designs.map((design) => (
                <tr key={`${design.orderId}-${design._id}`} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-medium text-gray-900">{design.name || design.productName || 'Custom order item'}</td>
                  <td className="p-4 text-gray-600">
                    {design.customer?.name || 'Customer'}<br />
                    <span className="text-xs text-gray-400">{design.customer?.email || ''}</span>
                  </td>
                  <td className="p-4 text-gray-600">
                    {design.productName || 'Custom product'}<br />
                    <span className="text-xs text-gray-400">Color: {design.selectedColor || '-'}</span>
                  </td>
                  <td className="p-4">
                    <Link href={`/admin/orders/${design.orderId}`} className="font-medium text-blue-600 hover:underline">
                      #{design.orderNumber}
                    </Link>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">{design.orderStatus}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">{design.paymentStatus}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      design.approvalStatus === 'approved' ? 'bg-blue-100 text-blue-800' :
                      design.approvalStatus === 'in_production' ? 'bg-purple-100 text-purple-800' :
                      design.approvalStatus === 'revision_requested' ? 'bg-amber-100 text-amber-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {design.approvalStatus || 'pending_design'}
                    </span>
                  </td>
                  <td className="p-4 text-gray-500 text-sm">
                    {design.updatedAt ? new Date(design.updatedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="p-4 text-center">
                    <Link href={`/admin/orders/${design.orderId}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 hover:bg-black hover:text-white transition-colors text-gray-600">
                      <Eye size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
              {designs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">No custom designs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
