"use client";

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, Send, Image as ImageIcon } from 'lucide-react';

interface CustomerMockupReviewProps {
  orderId: string;
  item: any;
  onRefresh?: () => void;
}

export function CustomerMockupReview({ orderId, item, onRefresh }: CustomerMockupReviewProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [isRequestingRevision, setIsRequestingRevision] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const approvalStatus = item?.approvalStatus || 'pending_design';
  const mockupImages = item?.mockupImages || [];
  const approvalHistory = item?.approvalHistory || [];
  const customizationNotes = item?.customizationNotes || '';

  // Customer approves mockup
  const handleApprove = async () => {
    setIsApproving(true);
    setMessage(null);

    try {
      const res = await api.post(`/orders/${orderId}/items/${item._id}/approve-mockup`, {
        note: 'Mockup approved by customer'
      });
      if (res.data?.status === 'success') {
        setMessage({ text: 'Mockup approved successfully! Your order will now proceed to production.', type: 'success' });
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to approve mockup', type: 'error' });
    } finally {
      setIsApproving(false);
    }
  };

  // Customer requests revision
  const handleRequestRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionNote.trim()) {
      setMessage({ text: 'Please specify the revision note for our design team.', type: 'error' });
      return;
    }

    setIsRequestingRevision(true);
    setMessage(null);

    try {
      const res = await api.post(`/orders/${orderId}/items/${item._id}/request-revision`, {
        note: revisionNote.trim()
      });
      if (res.data?.status === 'success') {
        setMessage({ text: 'Revision request submitted! Our team will prepare an updated mockup.', type: 'success' });
        setShowRevisionForm(false);
        setRevisionNote('');
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to submit revision request', type: 'error' });
    } finally {
      setIsRequestingRevision(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5 my-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="text-primary w-5 h-5" />
          <h3 className="font-bold text-gray-900 text-base">Custom Mockup Approval Status</h3>
        </div>
        <div>
          {approvalStatus === 'approved' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 flex items-center gap-1">
              <CheckCircle2 size={14} /> Approved
            </span>
          )}
          {approvalStatus === 'mockup_sent' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 flex items-center gap-1 animate-pulse">
              <Send size={14} /> Action Required: Review Mockup
            </span>
          )}
          {approvalStatus === 'revision_requested' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
              <RefreshCw size={14} /> Revision Requested
            </span>
          )}
          {approvalStatus === 'pending_design' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">
              Mockup Pending
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* State-specific views */}
      {approvalStatus === 'pending_design' && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 space-y-1">
          <p className="font-bold text-gray-900 text-sm">Design Team Working On Your Mockup</p>
          <p>Our professional design team is creating your digital mockup based on your uploaded artwork and instructions. You will receive an email & MSG91 alert as soon as it is uploaded for your review.</p>
        </div>
      )}

      {approvalStatus === 'mockup_sent' && mockupImages.length > 0 && (
        <div className="space-y-4 p-5 bg-blue-50/70 border border-blue-200 rounded-xl">
          <div className="flex items-center gap-2 text-blue-950 font-bold text-sm">
            <AlertCircle className="w-5 h-5 text-blue-600" />
            <span>Please Review Your Design Mockup</span>
          </div>

          {/* Mockup Image Display */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mockupImages.map((m: any, idx: number) => (
              <div key={idx} className="relative aspect-[4/5] rounded-xl overflow-hidden border border-blue-200 bg-white shadow-sm">
                <img src={m.url} alt={`Mockup Preview ${idx + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          {!showRevisionForm ? (
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleApprove}
                disabled={isApproving}
                className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isApproving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Approve Mockup & Proceed to Print
              </button>

              <button
                onClick={() => setShowRevisionForm(true)}
                disabled={isApproving}
                className="flex-1 py-3 px-4 bg-white border border-amber-300 text-amber-900 font-bold text-xs rounded-xl hover:bg-amber-50 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} />
                Request Changes / Revision
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequestRevision} className="space-y-3 pt-2 bg-white p-4 rounded-xl border border-amber-200">
              <label className="block font-bold text-xs text-gray-900">Specify Requested Changes (Required)</label>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="e.g. Please make the logo 20% smaller on the chest and move it up 2 inches..."
                rows={3}
                required
                className="w-full text-xs p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isRequestingRevision || !revisionNote.trim()}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isRequestingRevision ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Submit Revision Request
                </button>
                <button
                  type="button"
                  onClick={() => setShowRevisionForm(false)}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {approvalStatus === 'approved' && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-xs text-green-900 space-y-1">
          <p className="font-bold text-sm flex items-center gap-2 text-green-800">
            <CheckCircle2 size={16} /> Mockup Approved!
          </p>
          <p>Thank you! Your custom mockup is approved and cleared for production dispatch.</p>
        </div>
      )}

      {approvalStatus === 'revision_requested' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
          <p className="font-bold text-sm flex items-center gap-2 text-amber-800">
            <RefreshCw size={16} /> Revision Request Submitted
          </p>
          <p>Our design team is preparing an updated mockup based on your feedback.</p>
        </div>
      )}

      {/* History Log */}
      {approvalHistory.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Design Timeline & Feedback</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {approvalHistory.map((h: any, idx: number) => (
              <div key={idx} className="p-2 bg-gray-50 rounded-lg text-xs space-y-0.5 border border-gray-100">
                <div className="flex justify-between items-center text-gray-700">
                  <span className="font-bold uppercase text-[10px]">{h.status.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-gray-400">{new Date(h.timestamp).toLocaleDateString()}</span>
                </div>
                {h.note && <p className="text-gray-600 italic">"{h.note}"</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
