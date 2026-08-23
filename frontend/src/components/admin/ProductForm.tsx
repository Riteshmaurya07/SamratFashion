"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter();
  const isEditing = !!productId;

  const [categories, setCategories] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    categoryId: "",
    themeIds: [] as string[],
    basePrice: 0,
    mrp: 0,
    status: "DRAFT",
    images: [] as string[],
    isFeatured: false,
    isNewArrival: false,
    isBestSeller: false,
    fabric: "",
    gsm: 0,
    fit: "OVERSIZED",
    gender: "UNISEX",
    careInstructions: [] as string[],
    printTypes: [] as string[],
    sizeGuideTable: [] as Array<{ size: string; chest?: number; length?: number; shoulder?: number }>,
    variants: [] as any[]
  });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [catRes, themeRes] = await Promise.all([
          api.get("/admin/categories"),
          api.get("/admin/themes")
        ]);
        setCategories(catRes.data.data);
        setThemes(themeRes.data.data);
      } catch (err) {}
    };
    fetchMetadata();
  }, []);

  useEffect(() => {
    if (productId) {
      const fetchProduct = async () => {
        try {
          const res = await api.get(`/admin/products/${productId}`);
          const p = res.data.data;
          setFormData({
            name: p.name || "",
            slug: p.slug || "",
            description: p.description || "",
            categoryId: p.categoryId?._id || p.categoryId || "",
            themeIds: p.themeIds?.map((t: any) => t._id || t) || [],
            basePrice: p.basePrice || 0,
            mrp: p.mrp || 0,
            status: p.status || "DRAFT",
            images: p.images || [],
            isFeatured: p.isFeatured || false,
            isNewArrival: p.isNewArrival || false,
            isBestSeller: p.isBestSeller || false,
            fabric: p.fabric || "",
            gsm: p.gsm || 0,
            fit: p.fit || "OVERSIZED",
            gender: p.gender || "UNISEX",
            careInstructions: p.careInstructions || [],
            printTypes: p.printTypes || [],
            sizeGuideTable: p.sizeGuideTable || [],
            variants: p.variants || []
          });
        } catch (err) {
          setError("Failed to load product");
        }
      };
      fetchProduct();
    }
  }, [productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    
    // Clean up empty strings in variants
    const cleanedVariants = formData.variants.map(v => ({
      ...v,
      size: v.size || undefined,
      color: v.color || undefined,
      hexCode: v.hexCode || undefined,
      stock: Number(v.stock),
      additionalPrice: Number(v.additionalPrice || 0)
    }));
    
    const payload = {
      ...formData,
      basePrice: Number(formData.basePrice),
      mrp: Number(formData.mrp),
      gsm: Number(formData.gsm || 0),
      fabric: formData.fabric || undefined,
      fit: formData.fit || undefined,
      gender: formData.gender || undefined,
      careInstructions: formData.careInstructions.length > 0 ? formData.careInstructions : undefined,
      printTypes: formData.printTypes.length > 0 ? formData.printTypes : undefined,
      sizeGuideTable: formData.sizeGuideTable.length > 0 ? formData.sizeGuideTable.map(r => ({
        size: r.size,
        chest: r.chest ? Number(r.chest) : undefined,
        length: r.length ? Number(r.length) : undefined,
        shoulder: r.shoulder ? Number(r.shoulder) : undefined,
      })) : undefined,
      variants: cleanedVariants
    };

    try {
      if (isEditing) {
        await api.put(`/admin/products/${productId}`, payload);
      } else {
        await api.post(`/admin/products`, payload);
      }
      router.push("/admin/products");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save product");
      setSaving(false);
    }
  };

  const addVariant = () => {
    setFormData({
      ...formData,
      variants: [...formData.variants, { size: "", color: "", sku: "", stock: 0, additionalPrice: 0, isAvailable: true }]
    });
  };

  const removeVariant = (index: number) => {
    const newVariants = [...formData.variants];
    newVariants.splice(index, 1);
    setFormData({ ...formData, variants: newVariants });
  };

  const updateVariant = (index: number, field: string, value: any) => {
    const newVariants = [...formData.variants];
    newVariants[index] = { ...newVariants[index], [field]: value };
    setFormData({ ...formData, variants: newVariants });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0 relative pb-20">
      
      {/* Page Header */}
      <div className="-mx-6 -mt-6 px-6 lg:-mx-margin-desktop lg:-mt-margin-desktop lg:px-margin-desktop py-8 border-b border-outline-variant bg-surface-container-lowest shrink-0 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-container-max mx-auto">
          <div>
            <div className="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm mb-1">
              <span className="cursor-pointer hover:text-primary" onClick={() => router.push('/admin/products')}>Products</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              <span className="text-on-surface">{isEditing ? "Edit Product" : "New Product"}</span>
            </div>
            <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">{isEditing ? formData.name || "Edit Product" : "Create New Product"}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.back()} className="px-4 py-2 rounded border border-outline text-on-surface font-body-sm text-body-sm font-semibold hover:bg-surface-container-low transition-colors">Discard</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded bg-primary text-on-primary font-body-sm text-body-sm font-bold hover:bg-primary-fixed-variant transition-colors flex items-center gap-2 disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">save</span>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mb-6 p-4 bg-error-container/20 text-error border border-error/20 rounded-lg">{error}</div>}

      {/* Two Column Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-12 flex-1 min-h-0">
        
        {/* Left Column: Main Information (8 cols) */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Product Information Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-6 border-b border-outline-variant pb-4">Product Information</h3>
            <div className="space-y-6">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Product Title</label>
                <input required type="text" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Oversized Graphic Tee" />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Slug (URL)</label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l border border-r-0 border-outline-variant bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm">
                    strt-wr.in/products/
                  </span>
                  <input required type="text" className="flex-1 min-w-0 bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded-r px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.slug} onChange={e => setFormData({...formData, slug: e.target.value})} placeholder="oversized-graphic-tee" />
                </div>
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Description</label>
                <textarea required rows={6} className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Product details..."></textarea>
              </div>
            </div>
          </section>

          {/* Technical Specifications Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-6 border-b border-outline-variant pb-4">Technical Specifications & Garment Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Fabric Composition</label>
                <input type="text" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.fabric} onChange={e => setFormData({...formData, fabric: e.target.value})} placeholder="e.g. 100% Heavyweight French Terry Cotton" />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Fabric Weight (GSM)</label>
                <input type="number" min="0" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.gsm} onChange={e => setFormData({...formData, gsm: Number(e.target.value)})} placeholder="e.g. 240" />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Fit Type</label>
                <select className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.fit} onChange={e => setFormData({...formData, fit: e.target.value})}>
                  <option value="OVERSIZED">Oversized Fit</option>
                  <option value="RELAXED">Relaxed Fit</option>
                  <option value="REGULAR">Regular Fit</option>
                  <option value="BOXER">Boxy Fit</option>
                </select>
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Gender Category</label>
                <select className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})}>
                  <option value="UNISEX">Unisex</option>
                  <option value="MEN">Men</option>
                  <option value="WOMEN">Women</option>
                </select>
              </div>
            </div>

            {/* Print Types Selection */}
            <div className="mt-6 pt-6 border-t border-outline-variant">
              <label className="block font-label-caps text-label-caps text-on-surface-variant mb-3 uppercase">Print & Customisation Methods</label>
              <div className="flex flex-wrap gap-4">
                {[
                  { id: "DTG", label: "DTG (Direct to Garment)" },
                  { id: "PU_PRINT", label: "PU Print" },
                  { id: "EMBROIDERY", label: "Embroidery" },
                  { id: "SCREEN_PRINT", label: "Screen Printing" }
                ].map(p => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer font-body-sm text-on-surface">
                    <input
                      type="checkbox"
                      checked={formData.printTypes.includes(p.id)}
                      onChange={e => {
                        if (e.target.checked) {
                          setFormData({...formData, printTypes: [...formData.printTypes, p.id]});
                        } else {
                          setFormData({...formData, printTypes: formData.printTypes.filter(x => x !== p.id)});
                        }
                      }}
                      className="rounded text-primary focus:ring-primary border-outline-variant w-4 h-4 cursor-pointer"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Care Instructions */}
            <div className="mt-6 pt-6 border-t border-outline-variant">
              <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Care Instructions (Comma Separated)</label>
              <input
                type="text"
                className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                value={formData.careInstructions.join(', ')}
                onChange={e => setFormData({...formData, careInstructions: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                placeholder="e.g. Machine wash cold inside out, Do not iron directly on print, Line dry in shade"
              />
            </div>
          </section>

          {/* Pricing Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-6 border-b border-outline-variant pb-4">Pricing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Base Price (₹)</label>
                <input required type="number" min="0" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: Number(e.target.value)})} />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">MRP (₹) <span className="text-on-surface-variant/50 normal-case">(Optional)</span></label>
                <input type="number" min="0" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.mrp} onChange={e => setFormData({...formData, mrp: Number(e.target.value)})} />
              </div>
            </div>
          </section>

          {/* Media Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex justify-between items-center mb-6 border-b border-outline-variant pb-4">
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Media URLs</h3>
            </div>
            <div className="space-y-4">
              <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Comma separated Image URLs</label>
              <textarea 
                rows={3} 
                className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" 
                value={formData.images.join(', ')} 
                onChange={e => setFormData({...formData, images: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                placeholder="https://example.com/img1.jpg, https://example.com/img2.jpg"
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                {formData.images.map((img, i) => (
                   <div key={i} className="aspect-[3/4] bg-surface-container-low rounded border border-outline-variant overflow-hidden relative group">
                     <img src={img} alt={`Preview ${i}`} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://placehold.co/300x400?text=Error'; }} />
                     <div className="absolute inset-0 bg-on-surface/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-[24px]">visibility</span>
                     </div>
                   </div>
                ))}
              </div>
            </div>
          </section>

          {/* Size Guide Table Builder */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex justify-between items-center mb-6 border-b border-outline-variant pb-4">
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Size Guide Measurement Table</h3>
              <button
                type="button"
                onClick={() => setFormData({
                  ...formData,
                  sizeGuideTable: [...formData.sizeGuideTable, { size: "M", chest: 42, length: 28, shoulder: 19 }]
                })}
                className="text-primary font-body-sm text-body-sm font-semibold hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> Add Measurement Row
              </button>
            </div>
            
            {formData.sizeGuideTable.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant italic text-center py-4 bg-surface-container-low rounded border border-outline-variant/20">
                No size guide measurement rows defined. Click 'Add Measurement Row' to configure garment dimensions.
              </p>
            ) : (
              <div className="space-y-3">
                {formData.sizeGuideTable.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-surface p-3 rounded border border-outline-variant">
                    <input
                      type="text"
                      placeholder="Size (e.g. L)"
                      value={row.size}
                      onChange={e => {
                        const updated = [...formData.sizeGuideTable];
                        updated[idx].size = e.target.value;
                        setFormData({...formData, sizeGuideTable: updated});
                      }}
                      className="w-24 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5"
                    />
                    <input
                      type="number"
                      placeholder="Chest (in)"
                      value={row.chest || ''}
                      onChange={e => {
                        const updated = [...formData.sizeGuideTable];
                        updated[idx].chest = Number(e.target.value);
                        setFormData({...formData, sizeGuideTable: updated});
                      }}
                      className="w-28 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5"
                    />
                    <input
                      type="number"
                      placeholder="Length (in)"
                      value={row.length || ''}
                      onChange={e => {
                        const updated = [...formData.sizeGuideTable];
                        updated[idx].length = Number(e.target.value);
                        setFormData({...formData, sizeGuideTable: updated});
                      }}
                      className="w-28 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5"
                    />
                    <input
                      type="number"
                      placeholder="Shoulder (in)"
                      value={row.shoulder || ''}
                      onChange={e => {
                        const updated = [...formData.sizeGuideTable];
                        updated[idx].shoulder = Number(e.target.value);
                        setFormData({...formData, sizeGuideTable: updated});
                      }}
                      className="w-28 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...formData.sizeGuideTable];
                        updated.splice(idx, 1);
                        setFormData({...formData, sizeGuideTable: updated});
                      }}
                      className="ml-auto text-error hover:text-error-container p-1"
                      title="Remove Row"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Variants Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex justify-between items-center mb-6 border-b border-outline-variant pb-4">
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Variants</h3>
              <button type="button" onClick={addVariant} className="text-primary font-body-sm text-body-sm font-semibold hover:underline flex items-center gap-1">
                <span className="material-symbols-outlined text-[18px]">add</span> Add Variant
              </button>
            </div>
            
            {formData.variants.length === 0 ? (
              <div className="border-2 border-dashed border-outline-variant rounded-lg bg-surface hover:bg-surface-container-low transition-colors p-8 text-center">
                <span className="material-symbols-outlined text-4xl text-outline mb-2">style</span>
                <p className="font-body-md text-body-md text-on-surface font-medium">No variants added yet</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Click 'Add Variant' to create sizes or colors.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {formData.variants.map((v, idx) => (
                  <div key={idx} className="border border-outline-variant p-5 rounded-lg bg-surface relative">
                    <button type="button" onClick={() => removeVariant(idx)} className="absolute top-4 right-4 text-error hover:text-error-container p-1 rounded transition-colors" title="Remove Variant">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-2">
                      <div>
                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Size</label>
                        <input type="text" className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary" value={v.size} onChange={e => updateVariant(idx, 'size', e.target.value)} placeholder="e.g. M" />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Color</label>
                        <input type="text" className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary" value={v.color} onChange={e => updateVariant(idx, 'color', e.target.value)} placeholder="e.g. Black" />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">SKU *</label>
                        <input required type="text" className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary" value={v.sku} onChange={e => updateVariant(idx, 'sku', e.target.value)} />
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Stock</label>
                        {isEditing ? (
                          <div className="w-full bg-surface-container-high text-on-surface-variant font-body-sm border border-outline-variant/50 rounded px-3 py-2 opacity-70 cursor-not-allowed flex items-center justify-between">
                            {v.stock} <span className="material-symbols-outlined text-[14px]">lock</span>
                          </div>
                        ) : (
                          <input required type="number" min="0" className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary" value={v.stock} onChange={e => updateVariant(idx, 'stock', e.target.value)} />
                        )}
                      </div>
                      <div>
                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">+ Price (₹)</label>
                        <input type="number" min="0" className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary" value={v.additionalPrice} onChange={e => updateVariant(idx, 'additionalPrice', e.target.value)} />
                      </div>
                      <div className="col-span-2 md:col-span-5 flex items-center pt-2">
                        <label className="flex items-center text-body-sm cursor-pointer group">
                          <div className="relative flex items-center justify-center w-5 h-5 mr-3 border border-outline-variant rounded group-hover:border-primary transition-colors">
                            <input type="checkbox" className="opacity-0 absolute w-full h-full cursor-pointer" checked={v.isAvailable} onChange={e => updateVariant(idx, 'isAvailable', e.target.checked)} />
                            {v.isAvailable && <span className="material-symbols-outlined text-[16px] text-primary pointer-events-none">check</span>}
                          </div>
                          Available for purchase
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Settings & Details (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Status Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-4">Status</h3>
            <div className="relative">
              <select className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none cursor-pointer" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option value="ACTIVE">Active (Visible)</option>
                <option value="DRAFT">Draft (Hidden)</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
            </div>
          </section>

          {/* Organization Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-4">Organization</h3>
            <div className="space-y-6">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Category</label>
                <div className="relative">
                  <select required className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none cursor-pointer" value={formData.categoryId} onChange={e => setFormData({...formData, categoryId: e.target.value})}>
                    <option value="">Select Category</option>
                    {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
                </div>
              </div>
              
              <div className="pt-6 border-t border-outline-variant space-y-4">
                <label className="flex items-center justify-between text-body-md cursor-pointer group">
                  <span>Featured Product</span>
                  <div className={`w-11 h-6 rounded-full relative transition-colors ${formData.isFeatured ? 'bg-primary' : 'bg-surface-variant'}`}>
                    <input type="checkbox" className="opacity-0 absolute w-full h-full cursor-pointer z-10" checked={formData.isFeatured} onChange={e => setFormData({...formData, isFeatured: e.target.checked})} />
                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${formData.isFeatured ? 'translate-x-5' : ''}`}></div>
                  </div>
                </label>
                
                <label className="flex items-center justify-between text-body-md cursor-pointer group">
                  <span>New Arrival</span>
                  <div className={`w-11 h-6 rounded-full relative transition-colors ${formData.isNewArrival ? 'bg-primary' : 'bg-surface-variant'}`}>
                    <input type="checkbox" className="opacity-0 absolute w-full h-full cursor-pointer z-10" checked={formData.isNewArrival} onChange={e => setFormData({...formData, isNewArrival: e.target.checked})} />
                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${formData.isNewArrival ? 'translate-x-5' : ''}`}></div>
                  </div>
                </label>
                
                <label className="flex items-center justify-between text-body-md cursor-pointer group">
                  <span>Best Seller</span>
                  <div className={`w-11 h-6 rounded-full relative transition-colors ${formData.isBestSeller ? 'bg-primary' : 'bg-surface-variant'}`}>
                    <input type="checkbox" className="opacity-0 absolute w-full h-full cursor-pointer z-10" checked={formData.isBestSeller} onChange={e => setFormData({...formData, isBestSeller: e.target.checked})} />
                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${formData.isBestSeller ? 'translate-x-5' : ''}`}></div>
                  </div>
                </label>
              </div>
            </div>
          </section>

        </div>
      </div>
    </form>
  );
}
