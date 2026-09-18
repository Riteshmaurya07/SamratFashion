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

  const fetchDesigns = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/admin/custom-orders', {
        params: { search, status: statusFilter }
      });
      if (res.data.success) {
        setDesigns(res.data.data.items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDesigns();
  }, [statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDesigns();
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Custom Orders (Designs)</h1>
      </div>

      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm mb-6 border border-gray-100">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search designs..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800">
            Search
          </button>
        </form>

        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black bg-white"
        >
          <option value="">All Statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="SUBMITTED">SUBMITTED</option>
          <option value="PREVIEW_GENERATED">PREVIEW_GENERATED</option>
          <option value="CUSTOMER_REVIEW">CUSTOMER_REVIEW</option>
          <option value="CUSTOMER_APPROVED">CUSTOMER_APPROVED</option>
          <option value="REVISION_REQUESTED">REVISION_REQUESTED</option>
          <option value="IN_PRODUCTION">IN_PRODUCTION</option>
          <option value="COMPLETED">COMPLETED</option>
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
              {designs.map(design => (
                <tr key={design._id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-medium text-gray-900">{design.name}</td>
                  <td className="p-4 text-gray-600">
                    {design.userId?.name}<br/>
                    <span className="text-xs text-gray-400">{design.userId?.email}</span>
                  </td>
                  <td className="p-4 text-gray-600">
                    {design.productId?.name}<br/>
                    <span className="text-xs text-gray-400">Color: {design.selectedColor}</span>
                  </td>
                  <td className="p-4">
                    {design.orderId ? (
                      <div className="text-sm">
                        <Link href={`/admin/orders/${design.orderId._id}`} className="font-medium text-blue-600 hover:underline">
                          #{design.orderId.orderNumber}
                        </Link>
                        <div className="flex items-center gap-1 mt-1">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            design.orderId.status === 'DELIVERED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {design.orderId.status}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            design.orderId.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {design.orderId.paymentStatus}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic">No Order</span>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      design.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      design.status === 'CUSTOMER_APPROVED' ? 'bg-blue-100 text-blue-800' :
                      design.status === 'IN_PRODUCTION' ? 'bg-purple-100 text-purple-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {design.status}
                    </span>
                  </td>
                  <td className="p-4 text-gray-500 text-sm">
                    {new Date(design.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-center">
                    <Link href={`/admin/custom-orders/${design._id}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 hover:bg-black hover:text-white transition-colors text-gray-600">
                      <Eye size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
              {designs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    No custom designs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
