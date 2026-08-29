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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [manualUrlInput, setManualUrlInput] = useState("");
  const [variantUploadState, setVariantUploadState] = useState<
    Record<number, { uploading: boolean; error: string; progress: string; manualUrl: string }>
  >({});

  const handleVariantImageUpload = async (variantIndex: number, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (!validTypes.includes(file.type)) {
        setVariantUploadState((prev) => ({
          ...prev,
          [variantIndex]: {
            ...(prev[variantIndex] || { uploading: false, progress: "", manualUrl: "" }),
            uploading: false,
            error: `Invalid file type "${file.name}". Only JPEG, PNG, and WEBP images are supported.`,
          },
        }));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setVariantUploadState((prev) => ({
          ...prev,
          [variantIndex]: {
            ...(prev[variantIndex] || { uploading: false, progress: "", manualUrl: "" }),
            uploading: false,
            error: `File "${file.name}" exceeds 5MB limit. Please select smaller images.`,
          },
        }));
        return;
      }
    }

    setVariantUploadState((prev) => ({
      ...prev,
      [variantIndex]: {
        ...(prev[variantIndex] || { manualUrl: "" }),
        uploading: true,
        error: "",
        progress: `Uploading 1 of ${fileArray.length}...`,
      },
    }));

    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setVariantUploadState((prev) => ({
          ...prev,
          [variantIndex]: {
            ...(prev[variantIndex] || { manualUrl: "" }),
            uploading: true,
            error: "",
            progress: `Uploading ${i + 1} of ${fileArray.length}...`,
          },
        }));

        const bodyFormData = new FormData();
        bodyFormData.append("file", file);
        bodyFormData.append("category", "product");
        if (productId) bodyFormData.append("productId", productId);

        const response = await api.post("/upload/image", bodyFormData, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        if (response.data?.success && response.data.data?.url) {
          uploadedUrls.push(response.data.data.url);
        }
      }

      const currentVariantImages = formData.variants[variantIndex]?.images || [];
      const updatedVariantImages = [...currentVariantImages, ...uploadedUrls];
      updateVariant(variantIndex, "images", updatedVariantImages);

      // Auto-sync root product images if empty
      if (!formData.images || formData.images.length === 0) {
        setFormData((prev) => ({
          ...prev,
          images: [...uploadedUrls],
        }));
      }

      setVariantUploadState((prev) => ({
        ...prev,
        [variantIndex]: {
          ...(prev[variantIndex] || { manualUrl: "" }),
          uploading: false,
          error: "",
          progress: "",
        },
      }));
    } catch (err: any) {
      setVariantUploadState((prev) => ({
        ...prev,
        [variantIndex]: {
          ...(prev[variantIndex] || { manualUrl: "" }),
          uploading: false,
          error: err.response?.data?.message || "Failed to upload variant image. Please try again.",
          progress: "",
        },
      }));
    }
  };

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
    const cleanedVariants = formData.variants.map((v) => ({
      ...v,
      size: v.size || undefined,
      color: v.color || undefined,
      hexCode: v.hexCode || undefined,
      stock: Number(v.stock),
      additionalPrice: Number(v.additionalPrice || 0),
      images: Array.isArray(v.images) ? v.images : [],
    }));

    // Collect all variant images across all variants
    const allVariantImages = cleanedVariants.flatMap((v) => v.images || []).filter(Boolean);
    const finalProductImages =
      formData.images && formData.images.length > 0
        ? formData.images
        : allVariantImages.length > 0
        ? allVariantImages
        : [];
    
    const payload = {
      ...formData,
      images: finalProductImages,
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
      variants: [
        ...formData.variants,
        { size: "", color: "", hexCode: "#000000", sku: "", stock: 0, additionalPrice: 0, images: [], isAvailable: true }
      ]
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

          {/* Media & Product Images Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 border-b border-outline-variant pb-4">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Product Images</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Upload garment photos (JPEG, PNG, WEBP up to 5MB). The first image will be set as Primary.
                </p>
              </div>
              <label
                htmlFor="product-file-upload"
                className={`px-4 py-2 bg-primary text-on-primary font-body-sm text-body-sm font-bold rounded-lg hover:bg-primary-fixed-variant transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  uploading ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {uploading ? "progress_activity" : "cloud_upload"}
                </span>
                {uploading ? uploadProgress || "Uploading..." : "Upload Images"}
              </label>
              <input
                id="product-file-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading}
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;

                  setUploading(true);
                  setUploadError("");
                  setUploadProgress(`Uploading 1 of ${files.length}...`);

                  const newUploadedUrls: string[] = [];
                  const fileList = Array.from(files);

                  for (let i = 0; i < fileList.length; i++) {
                    const file = fileList[i];
                    setUploadProgress(`Uploading ${i + 1} of ${fileList.length}...`);

                    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
                    if (!validTypes.includes(file.type)) {
                      setUploadError(`Skipped ${file.name}: Invalid format. Allowed: JPEG, PNG, WEBP.`);
                      continue;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      setUploadError(`Skipped ${file.name}: Exceeds 5MB size limit.`);
                      continue;
                    }

                    try {
                      const bodyFormData = new FormData();
                      bodyFormData.append("file", file);
                      bodyFormData.append("category", "product");
                      if (productId) {
                        bodyFormData.append("productId", productId);
                      }

                      const res = await api.post("/upload/image", bodyFormData, {
                        headers: { "Content-Type": "multipart/form-data" },
                      });

                      if (res.data?.success && res.data?.data?.url) {
                        newUploadedUrls.push(res.data.data.url);
                      } else {
                        setUploadError(`Upload failed for ${file.name}`);
                      }
                    } catch (err: any) {
                      setUploadError(
                        err.response?.data?.message || `Image upload failed for ${file.name}. Please try again.`
                      );
                    }
                  }

                  if (newUploadedUrls.length > 0) {
                    setFormData((prev) => ({
                      ...prev,
                      images: [...prev.images, ...newUploadedUrls],
                    }));
                  }

                  setUploading(false);
                  setUploadProgress("");
                  e.target.value = "";
                }}
                className="hidden"
              />
            </div>

            {uploadError && (
              <div className="mb-4 p-3 bg-error-container/20 text-error border border-error/20 rounded-lg font-body-sm flex items-center justify-between">
                <span>{uploadError}</span>
                <button
                  type="button"
                  onClick={() => setUploadError("")}
                  className="text-error hover:opacity-80 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Dropzone Container */}
            {formData.images.length === 0 ? (
              <label
                htmlFor="product-file-upload"
                className="border-2 border-dashed border-outline-variant hover:border-primary rounded-xl p-8 flex flex-col items-center justify-center gap-2 cursor-pointer bg-surface hover:bg-surface-container-low transition-all text-center"
              >
                <div className="w-12 h-12 rounded-full bg-primary-container/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[28px]">add_a_photo</span>
                </div>
                <span className="font-body-md text-body-md font-bold text-on-surface">
                  No images uploaded yet
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Click here or press "Upload Images" above to choose product photos
                </span>
              </label>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {formData.images.map((imgUrl, idx) => (
                  <div
                    key={`${imgUrl}-${idx}`}
                    className={`group relative aspect-[3/4] bg-surface-container-low rounded-xl border overflow-hidden transition-all shadow-sm ${
                      idx === 0 ? "border-primary ring-2 ring-primary/20" : "border-outline-variant"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgUrl}
                      alt={`Product Image ${idx + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "https://placehold.co/300x400?text=Image+Error";
                      }}
                    />

                    {/* Primary Badge */}
                    {idx === 0 && (
                      <span className="absolute top-2 left-2 bg-primary text-on-primary font-label-caps text-[10px] font-bold px-2 py-0.5 rounded shadow">
                        PRIMARY
                      </span>
                    )}

                    {/* Image Action Overlay Bar */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              images: prev.images.filter((_, i) => i !== idx),
                            }));
                          }}
                          className="w-7 h-7 bg-red-600/90 text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors"
                          title="Remove Image"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>

                      {/* Reorder Controls */}
                      <div className="flex justify-between items-center bg-surface-container-lowest/90 backdrop-blur-xs rounded-lg px-2 py-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            if (idx === 0) return;
                            const updated = [...formData.images];
                            const [moved] = updated.splice(idx, 1);
                            updated.splice(idx - 1, 0, moved);
                            setFormData((prev) => ({ ...prev, images: updated }));
                          }}
                          className="p-1 text-on-surface hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface"
                          title="Move Left / Earlier"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                        </button>
                        <span className="font-label-caps text-[10px] text-on-surface-variant font-bold">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          disabled={idx === formData.images.length - 1}
                          onClick={() => {
                            if (idx === formData.images.length - 1) return;
                            const updated = [...formData.images];
                            const [moved] = updated.splice(idx, 1);
                            updated.splice(idx + 1, 0, moved);
                            setFormData((prev) => ({ ...prev, images: updated }));
                          }}
                          className="p-1 text-on-surface hover:text-primary disabled:opacity-30 disabled:hover:text-on-surface"
                          title="Move Right / Later"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Collapsible Manual URL Fallback Input */}
            <div className="mt-6 pt-4 border-t border-outline-variant/40">
              <details className="group">
                <summary className="font-label-caps text-xs font-bold text-on-surface-variant cursor-pointer hover:text-primary transition-colors flex items-center gap-1 select-none">
                  <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">
                    chevron_right
                  </span>
                  Paste Direct Image URL (Manual Input Fallback)
                </summary>
                <div className="flex gap-2 mt-3">
                  <input
                    type="url"
                    placeholder="https://example.com/product-image.jpg"
                    value={manualUrlInput}
                    onChange={(e) => setManualUrlInput(e.target.value)}
                    className="flex-1 bg-surface text-on-surface font-body-sm text-sm border border-outline-variant rounded px-3 py-2 focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!manualUrlInput || !manualUrlInput.trim()) return;
                      const url = manualUrlInput.trim();
                      if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        setUploadError("Please enter a valid HTTP or HTTPS image URL.");
                        return;
                      }
                      setFormData((prev) => ({ ...prev, images: [...prev.images, url] }));
                      setManualUrlInput("");
                      setUploadError("");
                    }}
                    className="px-4 py-2 border border-outline-variant bg-surface-container-low text-on-surface font-body-sm font-bold rounded hover:bg-surface-container-high transition-colors whitespace-nowrap"
                  >
                    Add URL
                  </button>
                </div>
              </details>
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
                {formData.variants.map((v, idx) => {
                  const vState = variantUploadState[idx] || { uploading: false, error: "", progress: "", manualUrl: "" };
                  const vImages = Array.isArray(v.images) ? v.images : [];

                  return (
                    <div key={idx} className="border border-outline-variant p-5 rounded-lg bg-surface relative space-y-4">
                      <button
                        type="button"
                        onClick={() => removeVariant(idx)}
                        className="absolute top-4 right-4 text-error hover:text-error-container p-1 rounded transition-colors"
                        title="Remove Variant"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>

                      {/* Header Badge */}
                      <div className="flex items-center gap-2">
                        <span className="font-label-caps text-[11px] font-bold text-on-surface-variant uppercase bg-surface-container-high px-2 py-0.5 rounded">
                          Variant #{idx + 1}
                        </span>
                        {v.color && (
                          <span className="font-label-caps text-[11px] text-on-surface font-semibold flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full border border-outline-variant shrink-0" style={{ backgroundColor: v.hexCode || '#000000' }} />
                            {v.color}
                          </span>
                        )}
                      </div>

                      {/* Top Row: Size, Color Name, Color HEX & Picker, SKU, Stock, Price */}
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                        <div>
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Size</label>
                          <input
                            type="text"
                            className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                            value={v.size || ""}
                            onChange={(e) => updateVariant(idx, "size", e.target.value)}
                            placeholder="e.g. M"
                          />
                        </div>

                        <div>
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Color Name</label>
                          <input
                            type="text"
                            className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                            value={v.color || ""}
                            onChange={(e) => updateVariant(idx, "color", e.target.value)}
                            placeholder="e.g. Black"
                          />
                        </div>

                        <div className="col-span-2 md:col-span-2">
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Color HEX & Picker</label>
                          <div className="flex items-center gap-2">
                            {/* Visual Color Swatch */}
                            <div
                              className="w-9 h-9 rounded border border-outline-variant shadow-xs shrink-0"
                              style={{ backgroundColor: v.hexCode || "#000000" }}
                              title={`Color Swatch: ${v.hexCode || "#000000"}`}
                            />
                            {/* Native Color Picker */}
                            <input
                              type="color"
                              aria-label="Color picker"
                              className="w-9 h-9 p-0.5 rounded cursor-pointer border border-outline-variant bg-surface-container-lowest shrink-0"
                              value={v.hexCode && /^#[0-9A-F]{6}$/i.test(v.hexCode) ? v.hexCode : "#000000"}
                              onChange={(e) => updateVariant(idx, "hexCode", e.target.value.toUpperCase())}
                              title="Choose Color"
                            />
                            {/* HEX Input Field */}
                            <input
                              type="text"
                              aria-label="Color HEX code"
                              className="flex-1 bg-surface-container-lowest font-mono uppercase text-on-surface font-body-sm border border-outline-variant rounded px-2.5 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                              value={v.hexCode || ""}
                              onChange={(e) => {
                                let val = e.target.value.trim();
                                if (!val.startsWith("#") && val.length > 0) val = "#" + val;
                                updateVariant(idx, "hexCode", val.toUpperCase());
                              }}
                              placeholder="#000000"
                              maxLength={7}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">SKU *</label>
                          <input
                            required
                            type="text"
                            className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                            value={v.sku || ""}
                            onChange={(e) => updateVariant(idx, "sku", e.target.value)}
                          />
                        </div>

                        <div>
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Stock</label>
                          {isEditing ? (
                            <div className="w-full bg-surface-container-high text-on-surface-variant font-body-sm border border-outline-variant/50 rounded px-3 py-2 opacity-70 cursor-not-allowed flex items-center justify-between">
                              {v.stock} <span className="material-symbols-outlined text-[14px]">lock</span>
                            </div>
                          ) : (
                            <input
                              required
                              type="number"
                              min="0"
                              className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                              value={v.stock}
                              onChange={(e) => updateVariant(idx, "stock", e.target.value)}
                            />
                          )}
                        </div>
                      </div>

                      {/* Middle Row: Price & Availability */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center pt-1 border-t border-outline-variant/30">
                        <div>
                          <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">+ Additional Price (₹)</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full md:w-48 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary"
                            value={v.additionalPrice || 0}
                            onChange={(e) => updateVariant(idx, "additionalPrice", e.target.value)}
                          />
                        </div>
                        <div className="flex items-center pt-4 md:pt-0">
                          <label className="flex items-center text-body-sm cursor-pointer group">
                            <div className="relative flex items-center justify-center w-5 h-5 mr-3 border border-outline-variant rounded group-hover:border-primary transition-colors">
                              <input
                                type="checkbox"
                                className="opacity-0 absolute w-full h-full cursor-pointer"
                                checked={v.isAvailable !== false}
                                onChange={(e) => updateVariant(idx, "isAvailable", e.target.checked)}
                              />
                              {v.isAvailable !== false && (
                                <span className="material-symbols-outlined text-[16px] text-primary pointer-events-none">check</span>
                              )}
                            </div>
                            Available for purchase
                          </label>
                        </div>
                      </div>

                      {/* Bottom Section: Variant Images Control */}
                      <div className="pt-3 border-t border-outline-variant/40 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="block font-label-caps text-[10px] text-on-surface-variant uppercase font-bold">
                            Variant / Color Specific Images
                          </label>
                          <span className="font-body-xs text-[11px] text-on-surface-variant">
                            Images specific to this color appear on PDP when customer selects {v.color || "this color"}.
                          </span>
                        </div>

                        {/* Upload Controls & URL Fallback Row */}
                        <div className="flex flex-wrap items-center gap-3">
                          {/* Styled Upload Button */}
                          <label
                            className={`px-4 py-2 bg-primary text-on-primary font-label-caps text-xs rounded-lg hover:opacity-90 transition-all cursor-pointer flex items-center gap-2 shadow-sm ${
                              vState.uploading ? "opacity-50 pointer-events-none" : ""
                            }`}
                          >
                            <span className="material-symbols-outlined text-[18px]">upload_file</span>
                            {vState.uploading ? vState.progress || "Uploading..." : "Upload Variant Images"}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              multiple
                              className="hidden"
                              onChange={(e) => handleVariantImageUpload(idx, e.target.files)}
                              disabled={vState.uploading}
                            />
                          </label>

                          {/* Manual URL Input Fallback */}
                          <div className="flex flex-1 min-w-[280px] gap-2">
                            <input
                              type="text"
                              className="flex-1 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary"
                              value={vState.manualUrl || ""}
                              onChange={(e) =>
                                setVariantUploadState((prev) => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] || { uploading: false, error: "", progress: "" }), manualUrl: e.target.value },
                                }))
                              }
                              placeholder="Paste Direct Image URL fallback..."
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const url = vState.manualUrl?.trim();
                                if (!url) return;
                                updateVariant(idx, "images", [...vImages, url]);
                                setVariantUploadState((prev) => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] || { uploading: false, error: "", progress: "" }), manualUrl: "" },
                                }));
                              }}
                              className="px-3 py-1.5 bg-surface-container-high border border-outline-variant hover:border-primary text-on-surface font-label-caps text-xs rounded transition-colors"
                            >
                              Add URL
                            </button>
                          </div>
                        </div>

                        {/* Error Banner */}
                        {vState.error && (
                          <div className="p-3 bg-error-container/20 text-error border border-error/20 rounded text-xs">
                            {vState.error}
                          </div>
                        )}

                        {/* Variant Image Thumbnails Cards Grid */}
                        {vImages.length > 0 && (
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 pt-2">
                            {vImages.map((imgUrl: string, imgIdx: number) => (
                              <div
                                key={imgIdx}
                                className="relative aspect-[3/4] rounded-lg overflow-hidden border border-outline-variant group bg-surface-container-low"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imgUrl}
                                  alt={`Variant ${idx + 1} Image ${imgIdx + 1}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.src = "https://placehold.co/300x400?text=Image+Error";
                                  }}
                                />

                                {/* Primary Badge */}
                                {imgIdx === 0 && (
                                  <span className="absolute top-1 left-1 bg-primary text-on-primary font-label-caps text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                    PRIMARY
                                  </span>
                                )}

                                {/* Overlay Action Bar */}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5">
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = vImages.filter((_: string, i: number) => i !== imgIdx);
                                        updateVariant(idx, "images", updated);
                                      }}
                                      className="w-6 h-6 bg-red-600/90 text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors"
                                      title="Remove Image"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">delete</span>
                                    </button>
                                  </div>

                                  {/* Reorder Buttons */}
                                  <div className="flex justify-between items-center bg-surface-container-lowest/90 backdrop-blur-xs rounded px-1.5 py-0.5">
                                    <button
                                      type="button"
                                      disabled={imgIdx === 0}
                                      onClick={() => {
                                        if (imgIdx === 0) return;
                                        const updated = [...vImages];
                                        const [moved] = updated.splice(imgIdx, 1);
                                        updated.splice(imgIdx - 1, 0, moved);
                                        updateVariant(idx, "images", updated);
                                      }}
                                      className="text-on-surface disabled:opacity-30 hover:text-primary transition-colors"
                                      title="Move Left"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                                    </button>
                                    <span className="font-label-caps text-[9px] text-on-surface-variant font-bold">
                                      {imgIdx + 1} / {vImages.length}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={imgIdx === vImages.length - 1}
                                      onClick={() => {
                                        if (imgIdx === vImages.length - 1) return;
                                        const updated = [...vImages];
                                        const [moved] = updated.splice(imgIdx, 1);
                                        updated.splice(imgIdx + 1, 0, moved);
                                        updateVariant(idx, "images", updated);
                                      }}
                                      className="text-on-surface disabled:opacity-30 hover:text-primary transition-colors"
                                      title="Move Right"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
