"use client";

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, ArrowLeft, CheckCircle, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { ReadOnlyDesignCanvas } from '@/components/custom-printing/ReadOnlyDesignCanvas';
import { useRouter } from 'next/navigation';

export default function CustomerDesignReviewPage({ params }: { params: { id: string } }) {
  const [design, setDesign] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionComment, setRevisionComment] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    const fetchDesign = async () => {
      try {
        const res = await api.get(`/designs/${params.id}`);
        if (res.data.success) {
          setDesign(res.data.data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchDesign();
  }, [params.id]);

  const handleApprove = async () => {
    if (!confirm("Are you sure you want to approve this design for production?")) return;
    
    setIsSubmitting(true);
    try {
      await api.post(`/designs/${params.id}/approve`);
      alert("Design approved successfully! It will now proceed to production.");
      router.push("/account"); // or stay here and reload
    } catch (e: any) {
      alert(e.response?.data?.message || "Failed to approve design.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionComment.trim()) {
      alert("Please enter a revision comment.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/designs/${params.id}/revision`, { comment: revisionComment });
      alert("Revision requested successfully! Our team will review your comments.");
      router.push("/account");
    } catch (e: any) {
      alert(e.response?.data?.message || "Failed to request revision.");
    } finally {
      setIsSubmitting(false);
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
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/account" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Review Your Design</h1>
      </div>

      <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b border-gray-100 gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">{design.name}</h2>
            <p className="text-sm text-gray-500">Product: {design.productId?.name} | Color: {design.selectedColor}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">Status:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              design.status === 'CUSTOMER_REVIEW' ? 'bg-amber-100 text-amber-800' :
              design.status === 'CUSTOMER_APPROVED' ? 'bg-green-100 text-green-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {design.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Front View</h3>
            <div className="flex justify-center bg-gray-50 p-6 rounded-xl border border-gray-100">
              <ReadOnlyDesignCanvas design={design.design} zone="front" width={250} height={320} />
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Back View</h3>
            <div className="flex justify-center bg-gray-50 p-6 rounded-xl border border-gray-100">
              <ReadOnlyDesignCanvas design={design.design} zone="back" width={250} height={320} />
            </div>
          </div>
        </div>

        {design.status === 'CUSTOMER_REVIEW' && (
          <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 mt-8">
            {showRevisionForm ? (
              <form onSubmit={handleRequestRevision} className="space-y-4">
                <h3 className="font-bold text-gray-900">Request Revision</h3>
                <p className="text-sm text-gray-600">Please provide detailed instructions on what needs to be changed.</p>
                <textarea
                  value={revisionComment}
                  onChange={(e) => setRevisionComment(e.target.value)}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                  rows={4}
                  placeholder="E.g., Move the logo slightly higher..."
                  required
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowRevisionForm(false)}
                    className="px-4 py-2 font-medium text-gray-600 hover:text-black transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2 bg-black text-white font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-400 transition-colors flex items-center gap-2"
                  >
                    {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                    Submit Request
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">Does this design look good?</h3>
                  <p className="text-sm text-gray-600">Approve it to proceed to production, or request a revision if you need changes.</p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="flex-1 sm:flex-none px-6 py-3 border border-black font-bold text-black rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <MessageSquare size={18} />
                    Request Revision
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={isSubmitting}
                    className="flex-1 sm:flex-none px-6 py-3 bg-black font-bold text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400"
                  >
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                    Approve Design
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
