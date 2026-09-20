"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import PrintPlacementFormClient from "./PrintPlacementFormClient";

type PrintPlacementTemplate = {
  _id: string;
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

export default function PrintPlacementListClient() {
  const [templates, setTemplates] = useState<PrintPlacementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<PrintPlacementTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/print-placements");
      setTemplates(data.data || []);
    } catch (error) {
      console.error("Failed to load templates", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await api.put(`/admin/print-placements/${id}`, { isActive: !currentStatus });
      fetchTemplates();
    } catch (error) {
      alert("Failed to update status");
    }
  };

  if (isCreating || editingTemplate) {
    return (
      <PrintPlacementFormClient 
        template={editingTemplate} 
        onCancel={() => { setIsCreating(false); setEditingTemplate(null); }}
        onSave={() => { setIsCreating(false); setEditingTemplate(null); fetchTemplates(); }}
      />
    );
  }

  return (
    <div className="p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Print Placement Templates</h1>
          <p className="mt-2 text-on-surface-variant">Manage the visual catalog for custom printing placements.</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-sm hover:opacity-90"
        >
          + Add Template
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl bg-surface-container p-10 text-center">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant p-10 text-center">
          <p className="text-on-surface-variant">No placement templates found.</p>
          <button onClick={() => setIsCreating(true)} className="mt-4 font-bold text-primary">Create the first one</button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((template) => (
            <div key={template._id} className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm">
              <div className="aspect-[4/5] bg-surface-container relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={template.imageUrl} alt={template.name} className="h-full w-full object-cover" />
                <div 
                  className="absolute border border-dashed border-primary bg-primary/20 flex items-center justify-center text-xs font-bold text-primary"
                  style={{
                    left: `${template.previewConfig.x}%`,
                    top: `${template.previewConfig.y}%`,
                    width: `${template.previewConfig.width}%`,
                    height: `${template.previewConfig.height}%`,
                  }}
                >
                  Logo
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold">{template.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${template.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container-high text-on-surface-variant'}`}>
                    {template.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">Code: {template.code} | Sort: {template.sortOrder}</p>
                
                <div className="mt-4 flex gap-2">
                  <button 
                    onClick={() => setEditingTemplate(template)}
                    className="flex-1 rounded-lg border border-outline-variant px-3 py-2 text-sm font-medium hover:bg-surface-container"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleToggleActive(template._id, template.isActive)}
                    className="flex-1 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium hover:bg-surface-container-high"
                  >
                    {template.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
