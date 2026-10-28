"use client";

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Upload, CheckCircle2, AlertTriangle, FileText, Image as ImageIcon, History, Send } from 'lucide-react';

interface StaffMockupManagerProps {
  orderId: string;
  item: any;
  product?: any;
  onRefresh?: () => void;
}

export function StaffMockupManager({ orderId, item, product, onRefresh }: StaffMockupManagerProps) {
  const [mockupUrl, setMockupUrl] = useState('');
  const [note, setNote] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const approvalStatus = item?.approvalStatus || 'pending_design';
  const designFiles = item?.designFiles || [];
  const customizationNotes = item?.customizationNotes || '';
  const mockupImages = item?.mockupImages || [];
  const approvalHistory = item?.approvalHistory || [];

  // Handle staff file upload to backend
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setIsUploadingFile(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', 'custom-artwork');

    try {
      const res = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      if (res.data?.success && res.data.data?.url) {
        setMockupUrl(res.data.data.url);
        setMessage({ text: 'Mockup image uploaded successfully!', type: 'success' });
      }
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
      if (errorObj?.code === 'ECONNABORTED' || errorObj?.message?.includes('timeout')) {
        setMessage({ text: 'Mockup upload timed out. Please try again or compress the image.', type: 'error' });
      } else {
        setMessage({ text: errorObj?.response?.data?.message || 'Failed to upload mockup image', type: 'error' });
      }
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Submit staff mockup to order
  const handleSendMockup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mockupUrl.trim()) {
      setMessage({ text: 'Please upload or enter a mockup image URL', type: 'error' });
      return;
    }

    setIsUploading(true);
    setMessage(null);

    try {
      const res = await api.post(`/admin/orders/${orderId}/items/${item._id}/mockup`, {
        mockupImages: [mockupUrl.trim()],
        note: note.trim() || 'Mockup uploaded by staff',
      });

      if (res.data?.success) {
        setMessage({ text: 'Mockup sent to customer for review!', type: 'success' });
        setMockupUrl('');
        setNote('');
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || 'Failed to send mockup', type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 flex items-center gap-1"><CheckCircle2 size={14} /> Approved by Customer</span>;
      case 'mockup_sent':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 flex items-center gap-1"><Send size={14} /> Mockup Sent — Awaiting Review</span>;
      case 'revision_requested':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 flex items-center gap-1"><AlertTriangle size={14} /> Revision Requested</span>;
      case 'in_production':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800">In Production</span>;
      case 'pending_design':
      default:
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">Awaiting Staff Mockup</span>;
    }
  };

  const printableZones = product?.printableZones || {
    front: { x: 200, y: 150, width: 400, height: 500 },
    back: { x: 200, y: 150, width: 400, height: 500 }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6 space-y-6">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <ImageIcon className="text-blue-600" size={20} />
            POD Custom Design & Mockup Workflow
          </h3>
          <p className="text-xs text-gray-500 mt-1">Review raw customer uploads, refer to printable zone bounds, and upload staff mockup for approval.</p>
        </div>
        <div>{getStatusBadge(approvalStatus)}</div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Customer Uploads & Instructions */}
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <FileText size={16} className="text-gray-600" /> Customer Uploaded Artwork & Files
            </h4>
            {designFiles.length > 0 ? (
              <div className="space-y-2">
                {designFiles.map((file: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200 text-xs">
                    <div className="flex items-center gap-2 truncate pr-2">
                      <FileText size={16} className="text-blue-600 shrink-0" />
                      <span className="font-medium text-gray-800 truncate">{file.filename || `Design_File_${idx + 1}`}</span>
                      <span className="text-[10px] text-gray-400">({file.fileType})</span>
                    </div>
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-bold shrink-0 transition-colors"
                    >
                      View / Download
                    </a>
                  </div>
                ))}
              </div>
            ) : item?.customizationSnapshot?.previewImage ? (
              <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200 text-xs">
                <span className="font-medium text-gray-800">Legacy Customer Artwork Preview</span>
                <a
                  href={item.customizationSnapshot.previewImage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-bold"
                >
                  View Artwork
                </a>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No raw customer file uploaded.</p>
            )}
          </div>

          {/* Customer Instructions */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-2">Customer Customization Notes</h4>
            <p className="text-xs text-gray-700 bg-white p-3 rounded-lg border border-gray-200 leading-relaxed min-h-[60px]">
              {customizationNotes || <span className="text-gray-400 italic">No special instructions provided by customer.</span>}
            </p>
          </div>

          {/* Repurposed printableZones Reference Overlay */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-2">Internal Staff Printable Zone Guidelines</h4>
            <p className="text-xs text-gray-500 mb-3">Bounding box dimensions (in pixels) for staff mockup creation outside app:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(printableZones).map(([zoneKey, zoneData]: [string, any]) => (
                <div key={zoneKey} className="p-2 bg-white rounded border border-gray-200 font-mono">
                  <span className="font-bold text-gray-800 uppercase block mb-1">{zoneKey}</span>
                  <span className="text-gray-500 text-[11px]">X: {zoneData.x}px | Y: {zoneData.y}px</span><br/>
                  <span className="text-gray-500 text-[11px]">W: {zoneData.width}px | H: {zoneData.height}px</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Upload Staff Mockup & Approval History */}
        <div className="space-y-4">
          <form onSubmit={handleSendMockup} className="bg-blue-50/50 p-4 rounded-xl border border-blue-200 space-y-3">
            <h4 className="text-sm font-bold text-blue-950 flex items-center gap-2">
              <Upload size={16} className="text-blue-600" /> Staff Mockup Upload
            </h4>
            <p className="text-xs text-blue-800">
              Upload your staff-built mockup image to send to the customer for approval.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Select Mockup Image File</label>
              <input
                type="file"
                accept="image/png, image/jpeg, image/webp"
                onChange={handleFileUpload}
                disabled={isUploadingFile}
                className="w-full text-xs p-1.5 border border-gray-300 rounded bg-white"
              />
              {isUploadingFile && <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Uploading image to storage...</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mockup Image URL</label>
              <input
                type="text"
                value={mockupUrl}
                onChange={(e) => setMockupUrl(e.target.value)}
                placeholder="https://storage.../mockup.png"
                className="w-full text-xs p-2 border border-gray-300 rounded bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Staff Note to Customer (Optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Here is your requested design mockup..."
                rows={2}
                className="w-full text-xs p-2 border border-gray-300 rounded bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={isUploading || !mockupUrl.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Send Mockup to Customer for Approval
            </button>
          </form>

          {/* Current Uploaded Staff Mockup Previews */}
          {mockupImages.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
              <h4 className="text-sm font-bold text-gray-900 mb-2">Uploaded Staff Mockups</h4>
              <div className="grid grid-cols-2 gap-2">
                {mockupImages.map((m: any, idx: number) => (
                  <a key={idx} href={m.url} target="_blank" rel="noopener noreferrer" className="block relative aspect-[4/5] rounded-lg overflow-hidden border border-gray-300 group">
                    <img src={m.url} alt={`Staff Mockup ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Full Approval History Audit Trail */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <History size={16} className="text-gray-600" /> Approval History & Revision Rounds
            </h4>
            {approvalHistory.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {approvalHistory.map((h: any, idx: number) => (
                  <div key={idx} className="p-2.5 bg-white rounded-lg border border-gray-200 text-xs space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-gray-900 uppercase text-[10px] tracking-wider">{h.status}</span>
                      <span className="text-[10px] text-gray-400">{new Date(h.timestamp).toLocaleString('en-IN')}</span>
                    </div>
                    {h.note && <p className="text-gray-700 bg-gray-50 p-1.5 rounded italic">"{h.note}"</p>}
                    <span className="text-[10px] text-gray-400 block">Actor: {h.actor}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No historical log yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
