/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useState, useRef } from "react";
import { api } from "@/lib/api";

type PrintPlacementTemplate = {
  _id?: string;
  name: string;
  code: string;
  side: string;
  description: string;
  imageUrl: string;
  previewConfig: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isActive: boolean;
  sortOrder: number;
};

type Props = {
  template: PrintPlacementTemplate | null;
  onCancel: () => void;
  onSave: () => void;
};

export default function PrintPlacementFormClient({ template, onCancel, onSave }: Props) {
  const [formData, setFormData] = useState<PrintPlacementTemplate>(
    template || {
      name: "",
      code: "",
      side: "FRONT",
      description: "",
      imageUrl: "",
      previewConfig: { x: 40, y: 30, width: 20, height: 20 },
      isActive: true,
      sortOrder: 0,
    }
  );
  
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("category", "product");
      const { data } = await api.post("/upload/image", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      
      setFormData({ ...formData, imageUrl: data.data.url });
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      if (formData._id) {
        await api.put(`/admin/print-placements/${formData._id}`, formData);
      } else {
        await api.post("/admin/print-placements", formData);
      }
      onSave();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{formData._id ? "Edit Template" : "New Template"}</h1>
        </div>
        <button onClick={onCancel} className="text-on-surface-variant hover:text-on-surface">
          Back to list
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl bg-surface-container-lowest p-6 shadow-sm border border-outline-variant/30">
          {error && <div className="rounded-xl bg-error-container p-4 text-sm font-medium text-on-error-container">{error}</div>}
          
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold">Name</label>
              <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" placeholder="e.g. Front Chest" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Code</label>
              <input required type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" placeholder="e.g. FRONT_CHEST" />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold">Side</label>
              <input required type="text" value={formData.side} onChange={(e) => setFormData({ ...formData, side: e.target.value })} className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" placeholder="e.g. FRONT, BACK, LEFT, RIGHT" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Sort Order</label>
              <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })} className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" rows={3} />
          </div>

          <div className="rounded-xl border border-outline-variant/40 p-5">
            <h3 className="mb-4 font-bold text-sm">Preview Configuration (%)</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="mb-1 block text-xs">Left (X)</label>
                <input type="number" step="0.1" value={formData.previewConfig.x} onChange={(e) => setFormData({ ...formData, previewConfig: { ...formData.previewConfig, x: parseFloat(e.target.value) || 0 } })} className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs">Top (Y)</label>
                <input type="number" step="0.1" value={formData.previewConfig.y} onChange={(e) => setFormData({ ...formData, previewConfig: { ...formData.previewConfig, y: parseFloat(e.target.value) || 0 } })} className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs">Width</label>
                <input type="number" step="0.1" value={formData.previewConfig.width} onChange={(e) => setFormData({ ...formData, previewConfig: { ...formData.previewConfig, width: parseFloat(e.target.value) || 0 } })} className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs">Height</label>
                <input type="number" step="0.1" value={formData.previewConfig.height} onChange={(e) => setFormData({ ...formData, previewConfig: { ...formData.previewConfig, height: parseFloat(e.target.value) || 0 } })} className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-sm" />
              </div>
            </div>
          </div>
          
          <div>
            <label className="mb-2 block text-sm font-bold">Template Image</label>
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            <div className="flex gap-4 items-center">
              <input required type="text" value={formData.imageUrl} onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })} className="flex-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none" placeholder="Image URL" />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-xl bg-surface-container-high px-4 py-3 text-sm font-bold disabled:opacity-50">
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary" />
            <label htmlFor="isActive" className="font-bold">Active (visible to customers)</label>
          </div>

          <button type="submit" disabled={saving || uploading} className="w-full rounded-xl bg-primary px-5 py-4 font-bold text-on-primary shadow-sm hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving..." : "Save Template"}
          </button>
        </form>

        <div className="sticky top-6">
          <h2 className="mb-4 font-bold">Live Preview Overlay</h2>
          <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-sm">
            {formData.imageUrl ? (
              <div className="aspect-[4/5] bg-surface-container relative rounded-lg overflow-hidden">
                <img src={formData.imageUrl} alt="Preview" className="h-full w-full object-cover" />
                <div 
                  className="absolute border-2 border-dashed border-primary bg-primary/30 flex items-center justify-center text-xs font-bold text-primary shadow-md backdrop-blur-sm transition-all"
                  style={{
                    left: `${formData.previewConfig.x}%`,
                    top: `${formData.previewConfig.y}%`,
                    width: `${formData.previewConfig.width}%`,
                    height: `${formData.previewConfig.height}%`,
                  }}
                >
                  <div className="text-center">
                    <div>Logo</div>
                    <div className="text-[10px] font-mono opacity-80 font-normal">
                      x:{formData.previewConfig.x} y:{formData.previewConfig.y}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-surface-container text-sm text-on-surface-variant">
                Provide an image URL to see preview
              </div>
            )}
            <p className="mt-4 text-xs text-on-surface-variant">
              Adjust the X, Y, Width, and Height values to position the logo overlay exactly where the customer's uploaded artwork should appear on this template.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
