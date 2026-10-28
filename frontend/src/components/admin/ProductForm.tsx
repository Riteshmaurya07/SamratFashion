"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const STREETWEAR_COLOR_PALETTE = [
  { name: "Onyx Black", hex: "#18181B" },
  { name: "Off-White", hex: "#F4F4F5" },
  { name: "Washed Grey", hex: "#3F3F46" },
  { name: "Charcoal", hex: "#27272A" },
  { name: "Olive Drab", hex: "#556B2F" },
  { name: "Vintage Navy", hex: "#1E293B" },
  { name: "Mocha Brown", hex: "#4A2E1B" },
  { name: "Sage Green", hex: "#8A9A86" },
  { name: "Sand Beige", hex: "#D4C5B9" },
  { name: "Crimson Red", hex: "#991B1B" },
  { name: "Royal Purple", hex: "#581C87" },
  { name: "Dusty Rose", hex: "#C084FC" },
];


const STREETWEAR_TAG_PRESETS = [
  "240 GSM",
  "OVERSIZED",
  "HEAVYWEIGHT",
  "ACID WASH",
  "100% COTTON",
  "DROP SHOULDER",
  "VINTAGE WASH",
  "BOX FIT",
  "GRAPHIC TEE",
  "LIMITED DROP",
];

const FABRIC_GSM_PRESETS = [
  { label: "240 GSM Terry Cotton", fabric: "100% Combed Heavyweight French Terry Cotton", gsm: 240 },
  { label: "180 GSM Bio-Washed Cotton", fabric: "100% Bio-Washed Combed Cotton Single Jersey", gsm: 180 },
  { label: "280 GSM Heavy Terry", fabric: "100% Cotton Heavyweight Loopback Terry", gsm: 280 },
  { label: "320 GSM Winter Fleece", fabric: "80% Cotton / 20% Polyester Heavyweight Fleece", gsm: 320 },
  { label: "210 GSM Compact Cotton", fabric: "100% Compact Cotton Single Jersey", gsm: 210 },
  { label: "220 GSM Cotton Spandex", fabric: "95% Cotton / 5% Spandex Ribbed Knit", gsm: 220 },
];

export default function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter();
  const isEditing = !!productId;

  const [categories, setCategories] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [tagInput, setTagInput] = useState("");
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
    variants: [] as any[],
    isCustomizable: false,
    tags: [] as string[],
    seo: {
      title: "",
      description: ""
    }
  });
  const handleAddTag = (tagToAdd?: string) => {
    const t = (tagToAdd || tagInput).trim().toUpperCase();
    if (t && !formData.tags.includes(t)) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, t] }));
    }
    if (!tagToAdd) setTagInput("");
  };
  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tagToRemove) }));
  };

  const currentCategoryId = formData.categoryId;
  // Hierarchical category options for dropdown
  const hierarchicalCategories = useMemo(() => {
    const rootCats = categories.filter((c) => !c.parentCategory).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    const childMap = new Map<string, any[]>();
    for (const c of categories) {
      if (c.parentCategory) {
        const pId = typeof c.parentCategory === "object" ? c.parentCategory._id : c.parentCategory;
        const arr = childMap.get(pId) || [];
        arr.push(c);
        childMap.set(pId, arr);
      }
    }

    const options: Array<{ _id: string; label: string; disabled: boolean }> = [];

    for (const root of rootCats) {
      const isRootInactive = root.status !== "ACTIVE";
      const isCurrentCategory = currentCategoryId === root._id;
      if (!isRootInactive || isCurrentCategory) {
        options.push({
          _id: root._id,
          label: isRootInactive ? `${root.name} (Inactive)` : root.name,
          disabled: isRootInactive && !isCurrentCategory,
        });
      }

      const children = childMap.get(root._id) || [];
      children.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      for (const child of children) {
        const isChildInactive = child.status !== "ACTIVE" || isRootInactive;
        const isChildCurrent = currentCategoryId === child._id;
        if (!isChildInactive || isChildCurrent) {
          options.push({
            _id: child._id,
            label: `${root.name} > ${child.name}${isChildInactive ? " (Inactive)" : ""}`,
            disabled: isChildInactive && !isChildCurrent,
          });
        }
      }
    }

    if (currentCategoryId && !options.some((o) => o._id === currentCategoryId)) {
      const match = categories.find((c) => c._id === currentCategoryId);
      if (match) {
        options.push({
          _id: match._id,
          label: `${match.name} (Archived / Inactive)`,
          disabled: false,
        });
      }
    }

    return options;
  }, [categories, currentCategoryId]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [manualUrlInput, setManualUrlInput] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEditing);
  const [careInput, setCareInput] = useState(formData.careInstructions.join(", "));
  const [variantUploadState, setVariantUploadState] = useState<
    Record<number, { uploading: boolean; error: string; progress: string; manualUrl: string }>
  >({});

  // Quick Multi-Size Batch Generator State
  const [showBatchGenerator, setShowBatchGenerator] = useState(false);
  const [batchColor, setBatchColor] = useState("Black");
  const [batchHex, setBatchHex] = useState("#18181B");
  const [selectedSizes, setSelectedSizes] = useState<string[]>(["S", "M", "L", "XL"]);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [defaultBatchStock, setDefaultBatchStock] = useState<number>(50);
  const [defaultBatchAddPrice, setDefaultBatchAddPrice] = useState<number>(0);
  const [sizeConfigurations, setSizeConfigurations] = useState<
    Record<string, { stock: number; additionalPrice: number }>
  >({
    S: { stock: 50, additionalPrice: 0 },
    M: { stock: 50, additionalPrice: 0 },
    L: { stock: 50, additionalPrice: 0 },
    XL: { stock: 50, additionalPrice: 0 },
  });
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  const STANDARD_GARMENT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

  const handleToggleSize = (size: string) => {
    setSelectedSizes((prev) => {
      if (prev.includes(size)) {
        return prev.filter((s) => s !== size);
      } else {
        setSizeConfigurations((configs) => ({
          ...configs,
          [size]: configs[size] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice },
        }));
        return [...prev, size];
      }
    });
  };

  const handleAddCustomSize = () => {
    const trimmed = customSizeInput.trim().toUpperCase();
    if (!trimmed || selectedSizes.includes(trimmed)) return;
    setSelectedSizes((prev) => [...prev, trimmed]);
    setSizeConfigurations((configs) => ({
      ...configs,
      [trimmed]: { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice },
    }));
    setCustomSizeInput("");
  };

  const handleApplyDefaultsToAll = () => {
    setSizeConfigurations((configs) => {
      const updated: Record<string, { stock: number; additionalPrice: number }> = { ...configs };
      selectedSizes.forEach((sz) => {
        updated[sz] = { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice };
      });
      return updated;
    });
  };

  const handleUpdateSizeConfig = (size: string, field: "stock" | "additionalPrice", val: number) => {
    setSizeConfigurations((configs) => ({
      ...configs,
      [size]: {
        ...(configs[size] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice }),
        [field]: val,
      },
    }));
  };

  const handleGenerateBatchVariants = () => {
    if (selectedSizes.length === 0) return;

    const baseSlug = (formData.slug || formData.name || "PROD")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    const colorCode = (batchColor || "CLR")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3);

    const generated = selectedSizes.map((sz) => {
      const cfg = sizeConfigurations[sz] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice };
      const sku = `${baseSlug || "PROD"}-${colorCode || "CLR"}-${sz.toUpperCase()}`;

      return {
        size: sz,
        color: batchColor.trim() || "Standard",
        hexCode: batchHex || "#18181B",
        sku,
        stock: Number(cfg.stock) || 0,
        additionalPrice: Number(cfg.additionalPrice) || 0,
        images: [],
        isAvailable: true,
      };
    });

    // Clean existing: prune unconfigured blank/placeholder variants (e.g. empty color or empty SKU with 0 stock)
    // so that generating batch variants doesn't leave an uncolored orphaned piece behind!
    const existing = formData.variants.filter((v) => {
      const hasColor = Boolean(v.color && v.color.trim());
      const hasSku = Boolean(v.sku && v.sku.trim());
      const hasStock = Number(v.stock || 0) > 0;
      const hasImages = Array.isArray(v.images) && v.images.length > 0;
      return hasColor && (hasSku || hasStock || hasImages);
    });
    let addedCount = 0;
    let replacedCount = 0;

    generated.forEach((gen) => {
      const existIdx = existing.findIndex(
        (v) => (v.size || "").toUpperCase() === gen.size.toUpperCase() && (v.color || "").toLowerCase() === gen.color.toLowerCase()
      );
      if (existIdx !== -1) {
        existing[existIdx] = { ...existing[existIdx], ...gen, images: existing[existIdx].images || [] };
        replacedCount++;
      } else {
        existing.push(gen);
        addedCount++;
      }
    });

    setFormData((prev) => ({ ...prev, variants: existing }));
    setBatchNotice(`Generated ${generated.length} size variants (${addedCount} new, ${replacedCount} updated) for ${batchColor}!`);
    setTimeout(() => setBatchNotice(null), 4000);
    setShowBatchGenerator(false);
  };

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
          timeout: 120000,
        });

        if (response.data?.success && response.data.data?.url) {
          uploadedUrls.push(response.data.data.url);
        }
      }

      const targetColor = (formData.variants[variantIndex]?.color || "").trim().toLowerCase();
      const currentVariantImages = formData.variants[variantIndex]?.images || [];
      const updatedVariantImages = [...currentVariantImages, ...uploadedUrls];
      
      const newVariants = formData.variants.map((v, i) => {
        if (i === variantIndex || (targetColor && (v.color || "").trim().toLowerCase() === targetColor)) {
          return { ...v, images: updatedVariantImages };
        }
        return v;
      });
      setFormData((prev) => ({ ...prev, variants: newVariants }));

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
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
      const msg =
        errObj.code === "ECONNABORTED"
          ? "Upload timed out. Please check your connection and try again."
          : errObj.response?.data?.message || "Failed to upload variant image. Please try again.";
      setVariantUploadState((prev) => ({
        ...prev,
        [variantIndex]: {
          ...(prev[variantIndex] || { manualUrl: "" }),
          uploading: false,
          error: msg,
          progress: "",
        },
      }));
    }
  };

  const handleProductImageFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    setUploadError("");
    setUploadProgress(`Uploading 1 of ${fileList.length}...`);

    const newUploadedUrls: string[] = [];

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
          timeout: 120000,
        });

        if (res.data?.success && res.data?.data?.url) {
          newUploadedUrls.push(res.data.data.url);
        } else {
          setUploadError(`Upload failed for ${file.name}`);
        }
      } catch (err: unknown) {
        const errObj = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
        const msg =
          errObj.code === "ECONNABORTED"
            ? `Upload timed out for ${file.name}. Please check your connection and try again.`
            : errObj.response?.data?.message || `Image upload failed for ${file.name}. Please try again.`;
        setUploadError(msg);
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
            variants: p.variants || [],
            isCustomizable: !!p.isCustomizable,
            tags: Array.isArray(p.tags) ? p.tags : [],
            seo: {
              title: p.seo?.title || p.name || "",
              description: p.seo?.description || p.description || ""
            }
          });
          setCareInput((p.careInstructions || []).join(", "));
          setSlugManuallyEdited(true);
        } catch (err) {
        }
      };
      fetchProduct();
    }
  }, [productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    if (!formData.variants || formData.variants.length === 0) {
      setError("Please add at least one product variant (size & color).");
      setSaving(false);
      return;
    }

    // Validate that every variant has a color, size, and SKU
    for (let i = 0; i < formData.variants.length; i++) {
      const v = formData.variants[i];
      if (!v.color || !v.color.trim()) {
        setError(`Variant #${i + 1} is missing a Color Name. Every variant must have a valid color name.`);
        setSaving(false);
        return;
      }
      if (!v.size || !v.size.trim()) {
        setError(`Variant #${i + 1} (${v.color}) is missing a Size (e.g. S, M, L, XL, Free Size).`);
        setSaving(false);
        return;
      }
      if (!v.sku || !v.sku.trim()) {
        setError(`Variant #${i + 1} (${v.color} / ${v.size}) is missing a SKU.`);
        setSaving(false);
        return;
      }
    }

    // Clean up empty strings in variants
    const cleanedVariants = formData.variants.map((v) => ({
      ...v,
      size: v.size?.trim() || undefined,
      color: v.color?.trim() || undefined,
      hexCode: v.hexCode || undefined,
      stock: Number(v.stock),
      additionalPrice: Number(v.additionalPrice || 0),
      images: Array.isArray(v.images) ? v.images : [],
    }));
    // Ensure all variants of the same color share the color group's images if empty
    const colorImageMap = new Map<string, string[]>();
    cleanedVariants.forEach((v) => {
      const cKey = (v.color || "").trim().toLowerCase();
      if (cKey && v.images.length > 0 && !colorImageMap.has(cKey)) {
        colorImageMap.set(cKey, v.images);
      }
    });
    const syncedVariants = cleanedVariants.map((v) => {
      const cKey = (v.color || "").trim().toLowerCase();
      if (cKey && (!v.images || v.images.length === 0) && colorImageMap.has(cKey)) {
        return { ...v, images: colorImageMap.get(cKey)! };
      }
      return v;
    });

    // Collect all variant images across all variants
    const allVariantImages = syncedVariants.flatMap((v) => v.images || []).filter(Boolean);
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
      variants: syncedVariants
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
    // Select next unused streetwear palette color to avoid collapsing into an existing color group
    const usedColors = new Set(
      formData.variants.map((v) => (v.color || "").trim().toLowerCase()).filter(Boolean)
    );
    const nextPaletteColor =
      STREETWEAR_COLOR_PALETTE.find((c) => !usedColors.has(c.name.toLowerCase())) ||
      STREETWEAR_COLOR_PALETTE[formData.variants.length % STREETWEAR_COLOR_PALETTE.length] ||
      { name: "Onyx Black", hex: "#18181B" };

    const baseSlug = (formData.slug || formData.name || "PROD")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    const colorCode = nextPaletteColor.name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3);
    const defaultSku = `${baseSlug || "PROD"}-${colorCode || "CLR"}-M`;

    setFormData({
      ...formData,
      variants: [
        ...formData.variants,
        {
          size: "M",
          color: nextPaletteColor.name,
          hexCode: nextPaletteColor.hex,
          sku: defaultSku,
          stock: 10,
          additionalPrice: 0,
          images: [],
          isAvailable: true,
        },
      ],
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
  const handleDeleteProduct = async () => {
    if (!productId) return;
    if (
      !window.confirm(
        `Are you sure you want to permanently delete "${formData.name || 'this product'}"? All associated Cloudinary images will also be deleted.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/admin/products/${productId}`);
      router.push("/admin/products");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to delete product");
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0 relative pb-36">
      
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
            {isEditing && (
              <button
                type="button"
                onClick={handleDeleteProduct}
                disabled={deleting || saving}
                className="px-4 py-2 rounded border border-error/40 text-error font-body-sm text-body-sm font-semibold hover:bg-error-container/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
                {deleting ? "Deleting..." : "Delete Product"}
              </button>
            )}
            <button type="button" onClick={() => router.back()} className="px-4 py-2 rounded border border-outline text-on-surface font-body-sm text-body-sm font-semibold hover:bg-surface-container-low transition-colors">Discard</button>
            <button type="submit" disabled={saving || deleting} className="px-4 py-2 rounded bg-primary text-on-primary font-body-sm text-body-sm font-bold hover:bg-primary-fixed-variant transition-colors flex items-center gap-2 disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">save</span>
              {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Product"}
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
                <input
                  required
                  type="text"
                  className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  value={formData.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    const autoSlug = val
                      .toLowerCase()
                      .trim()
                      .replace(/[^\w\s-]/g, "")
                      .replace(/[\s_-]+/g, "-")
                      .replace(/^-+|-+$/g, "");
                    setFormData((prev) => ({
                      ...prev,
                      name: val,
                      slug: slugManuallyEdited ? prev.slug : autoSlug,
                    }));
                  }}
                  placeholder="e.g. Oversized Graphic Tee"
                />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Slug (URL)</label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l border border-r-0 border-outline-variant bg-surface-container-low text-on-surface-variant font-body-sm text-body-sm">
                    samratfashion.com/products/
                  </span>
                  <input
                    required
                    type="text"
                    className="flex-1 min-w-0 bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded-r px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    value={formData.slug}
                    onChange={(e) => {
                      setSlugManuallyEdited(true);
                      setFormData({ ...formData, slug: e.target.value });
                    }}
                    placeholder="oversized-graphic-tee"
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Description</label>
                <textarea required rows={6} className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Product details..."></textarea>
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
                onChange={(e) => {
                  if (e.target.files) handleProductImageFiles(e.target.files);
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
                  âœ•
                </button>
              </div>
            )}

            {/* Dropzone Container */}
            {formData.images.length === 0 ? (
              <label
                htmlFor="product-file-upload"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFiles(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleProductImageFiles(e.dataTransfer.files);
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center ${
                  isDraggingFiles
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-outline-variant hover:border-primary bg-surface hover:bg-surface-container-low"
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-primary-container/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[28px]">
                    {uploading ? "progress_activity" : "add_a_photo"}
                  </span>
                </div>
                <span className="font-body-md text-body-md font-bold text-on-surface">
                  {uploading ? uploadProgress || "Uploading images to cloud..." : "No images uploaded yet"}
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {uploading
                    ? "Please wait while files are being securely optimized and hosted"
                    : 'Drag & drop image files here, or click to choose from computer'}
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
                <label
                  htmlFor="product-file-upload"
                  className="aspect-[3/4] rounded-xl border-2 border-dashed border-outline-variant hover:border-primary flex flex-col items-center justify-center gap-2 cursor-pointer bg-surface hover:bg-surface-container-low transition-colors text-center p-4 group"
                >
                  <span className="material-symbols-outlined text-[28px] text-primary group-hover:scale-110 transition-transform">
                    {uploading ? "progress_activity" : "add_photo_alternate"}
                  </span>
                  <span className="text-xs font-bold text-on-surface">
                    {uploading ? uploadProgress || "Uploading..." : "Add More Photos"}
                  </span>
                </label>
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

          {/* Variants Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 border-b border-outline-variant pb-4">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Variants &amp; Inventory</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Configure sizes (S, M, L, XL), colors, individual quantities, and price adjustments.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchGenerator(!showBatchGenerator)}
                  className="px-3.5 py-2 bg-primary text-on-primary rounded-lg font-mono text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">bolt</span>
                  <span>{showBatchGenerator ? "Close Batch Tool" : "⚡ Multi-Size Generator"}</span>
                </button>
                <button
                  type="button"
                  onClick={addVariant}
                  className="px-3.5 py-2 border border-outline-variant text-on-surface rounded-lg font-mono text-xs font-semibold hover:bg-surface-container-low transition-colors flex items-center gap-1 cursor-pointer"
                  title="Add a single variant piece with color & size"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  <span>Add Single Piece</span>
                </button>
              </div>
            </div>

            {batchNotice && (
              <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span>{batchNotice}</span>
              </div>
            )}

            {/* Quick Multi-Size Generator Panel */}
            {showBatchGenerator && (
              <div className="mb-6 p-5 sm:p-6 bg-surface-container-low border border-primary/30 rounded-xl space-y-5 animate-in slide-in-from-top-2">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-primary/10 text-primary rounded-md">
                      <span className="material-symbols-outlined text-[20px]">dataset</span>
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-on-surface">Quick Multi-Size Batch Generator</h4>
                      <p className="text-xs text-on-surface-variant">
                        Select S, M, L, XL sizes, specify respective quantities &amp; prices, and generate in 1 click.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBatchGenerator(false)}
                    className="p-1 text-on-surface-variant hover:text-on-surface cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>

                {/* Color Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end bg-surface p-4 rounded-lg border border-outline-variant/40">
                  <div className="sm:col-span-5">
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1 uppercase font-bold">
                      Color Name
                    </label>
                    <input
                      type="text"
                      value={batchColor}
                      onChange={(e) => setBatchColor(e.target.value)}
                      placeholder="e.g. Black, Pitch Black, Navy Blue"
                      className="w-full bg-surface-container-lowest text-on-surface font-body-sm text-xs border border-outline-variant rounded px-3 py-2 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1 uppercase font-bold">
                      Color HEX &amp; Swatch
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={batchHex && /^#[0-9A-F]{6}$/i.test(batchHex) ? batchHex : "#18181B"}
                        onChange={(e) => setBatchHex(e.target.value.toUpperCase())}
                        className="w-9 h-9 p-0.5 rounded cursor-pointer border border-outline-variant bg-surface-container-lowest shrink-0"
                      />
                      <input
                        type="text"
                        value={batchHex}
                        onChange={(e) => {
                          let val = e.target.value.trim();
                          if (!val.startsWith("#") && val.length > 0) val = "#" + val;
                          setBatchHex(val.toUpperCase());
                        }}
                        className="flex-1 font-mono uppercase text-xs bg-surface-container-lowest text-on-surface border border-outline-variant rounded px-3 py-2 focus:border-primary focus:outline-none"
                        maxLength={7}
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-3 text-right">
                    <span className="text-[11px] font-mono text-on-surface-variant">
                      Base Product Price: <strong>₹{Number(formData.basePrice || 0)}</strong>
                    </span>
                  </div>
                </div>

                {/* Streetwear Color Palette Quick-Pills */}
                <div className="bg-surface p-3.5 rounded-lg border border-outline-variant/40">
                  <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">
                    ⚡ Streetwear Palette Presets (Click to Auto-fill Color &amp; HEX):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {STREETWEAR_COLOR_PALETTE.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => {
                          setBatchColor(c.name);
                          setBatchHex(c.hex);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
                          batchHex.toUpperCase() === c.hex.toUpperCase()
                            ? "border-primary bg-primary/10 text-primary font-bold shadow-xs scale-105"
                            : "border-outline-variant hover:border-outline bg-surface-container-lowest text-on-surface"
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/20 shrink-0"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Size Selection Pills & Presets */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="font-label-caps text-[11px] text-on-surface-variant uppercase font-bold">
                      Select Sizes to Generate ({selectedSizes.length} selected)
                    </label>
                    <div className="flex items-center gap-1.5 text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSizes(["S", "M", "L", "XL"]);
                          setSizeConfigurations((configs) => {
                            const updated = { ...configs };
                            ["S", "M", "L", "XL"].forEach((s) => {
                              updated[s] = updated[s] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice };
                            });
                            return updated;
                          });
                        }}
                        className="px-2 py-0.5 rounded bg-surface-container-high hover:bg-primary/10 hover:text-primary text-neutral-700 font-bold transition-colors cursor-pointer"
                      >
                        [Preset: S, M, L, XL]
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const allSizes = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];
                          setSelectedSizes(allSizes);
                          setSizeConfigurations((configs) => {
                            const updated = { ...configs };
                            allSizes.forEach((s) => {
                              updated[s] = updated[s] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice };
                            });
                            return updated;
                          });
                        }}
                        className="px-2 py-0.5 rounded bg-surface-container-high hover:bg-primary/10 hover:text-primary text-neutral-700 font-bold transition-colors cursor-pointer"
                      >
                        [Select All]
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSizes([])}
                        className="px-2 py-0.5 rounded bg-surface-container-high hover:text-error text-neutral-600 transition-colors cursor-pointer"
                      >
                        [Clear]
                      </button>
                    </div>
                  </div>

                  {/* Pills Grid */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {STANDARD_GARMENT_SIZES.map((sz) => {
                      const isSelected = selectedSizes.includes(sz);
                      return (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => handleToggleSize(sz)}
                          className={`w-12 h-10 rounded-lg font-mono text-xs font-bold border transition-all flex items-center justify-center cursor-pointer ${
                            isSelected
                              ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
                              : "bg-surface text-on-surface border-outline-variant hover:border-neutral-900"
                          }`}
                        >
                          {sz}
                        </button>
                      );
                    })}

                    {/* Custom Sizes Added by User */}
                    {selectedSizes
                      .filter((s) => !STANDARD_GARMENT_SIZES.includes(s))
                      .map((customSz) => (
                        <button
                          key={customSz}
                          type="button"
                          onClick={() => handleToggleSize(customSz)}
                          className="px-3 h-10 rounded-lg font-mono text-xs font-bold border bg-neutral-900 text-white border-neutral-900 flex items-center gap-1 shadow-xs cursor-pointer"
                        >
                          <span>{customSz}</span>
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      ))}

                    {/* Custom Size Input */}
                    <div className="flex items-center gap-1 h-10">
                      <input
                        type="text"
                        placeholder="Custom (e.g. 38, 40)"
                        value={customSizeInput}
                        onChange={(e) => setCustomSizeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddCustomSize();
                          }
                        }}
                        className="w-32 h-full bg-surface text-on-surface font-mono text-xs border border-outline-variant rounded-lg px-2.5 focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomSize}
                        disabled={!customSizeInput.trim()}
                        className="h-full px-2.5 bg-surface-container-high border border-outline-variant rounded-lg text-xs font-bold text-on-surface hover:bg-primary hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bulk Defaults Bar */}
                {selectedSizes.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                    <span className="text-xs font-bold text-primary font-mono uppercase">
                      Quick Autofill (Set all {selectedSizes.length} sizes at once):
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-on-surface-variant">Qty per size:</span>
                        <input
                          type="number"
                          min="0"
                          value={defaultBatchStock}
                          onChange={(e) => setDefaultBatchStock(Number(e.target.value))}
                          className="w-20 bg-surface text-on-surface font-mono text-xs border border-outline-variant rounded px-2 py-1 text-center font-bold"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-on-surface-variant">Price Adj (+₹):</span>
                        <input
                          type="number"
                          min="0"
                          value={defaultBatchAddPrice}
                          onChange={(e) => setDefaultBatchAddPrice(Number(e.target.value))}
                          className="w-20 bg-surface text-on-surface font-mono text-xs border border-outline-variant rounded px-2 py-1 text-center font-bold"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyDefaultsToAll}
                        className="px-3 py-1 bg-primary text-white rounded font-mono text-xs font-bold hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
                      >
                        Apply to All
                      </button>
                    </div>
                  </div>
                )}

                {/* Interactive Per-Size Table */}
                {selectedSizes.length > 0 ? (
                  <div className="border border-outline-variant/40 rounded-xl overflow-hidden bg-surface">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-surface-container-high border-b border-outline-variant/40 text-on-surface-variant font-mono uppercase text-[11px]">
                            <th className="py-2.5 px-4 font-bold">Size</th>
                            <th className="py-2.5 px-4 font-bold">Stock Quantity</th>
                            <th className="py-2.5 px-4 font-bold">Additional Price (+₹)</th>
                            <th className="py-2.5 px-4 font-bold">Final Unit Price</th>
                            <th className="py-2.5 px-4 font-bold">Generated SKU</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/30 font-mono">
                          {selectedSizes.map((sz) => {
                            const cfg = sizeConfigurations[sz] || { stock: defaultBatchStock, additionalPrice: defaultBatchAddPrice };
                            const basePriceNum = Number(formData.basePrice || 0);
                            const finalPrice = basePriceNum + Number(cfg.additionalPrice || 0);
                            const baseSlug = (formData.slug || formData.name || "PROD").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
                            const colorCode = (batchColor || "CLR").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
                            const skuPreview = `${baseSlug || "PROD"}-${colorCode || "CLR"}-${sz.toUpperCase()}`;

                            return (
                              <tr key={sz} className="hover:bg-surface-container-low/50 transition-colors">
                                <td className="py-2 px-4 font-bold text-on-surface">
                                  <span className="w-8 h-8 rounded-md bg-surface-container-high flex items-center justify-center font-bold">
                                    {sz}
                                  </span>
                                </td>
                                <td className="py-2 px-4">
                                  <input
                                    type="number"
                                    min="0"
                                    value={cfg.stock}
                                    onChange={(e) => handleUpdateSizeConfig(sz, "stock", Number(e.target.value))}
                                    className="w-28 bg-surface-container-lowest text-on-surface border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:outline-none font-bold"
                                  />
                                </td>
                                <td className="py-2 px-4">
                                  <div className="flex items-center gap-1">
                                    <span className="text-on-surface-variant">+₹</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={cfg.additionalPrice}
                                      onChange={(e) => handleUpdateSizeConfig(sz, "additionalPrice", Number(e.target.value))}
                                      className="w-28 bg-surface-container-lowest text-on-surface border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:outline-none font-bold"
                                    />
                                  </div>
                                </td>
                                <td className="py-2 px-4 font-bold text-on-surface">
                                  ₹{finalPrice}
                                </td>
                                <td className="py-2 px-4 text-on-surface-variant/80 text-[11px]">
                                  {skuPreview}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant italic text-center py-4 bg-surface rounded border border-dashed border-outline-variant/40">
                    Select one or more sizes above to configure quantities and prices.
                  </p>
                )}

                {/* Generate Action Button */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowBatchGenerator(false)}
                    className="px-4 py-2 border border-outline-variant rounded-lg text-xs font-mono font-bold text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateBatchVariants}
                    disabled={selectedSizes.length === 0}
                    className="px-6 py-2.5 bg-neutral-900 text-white rounded-lg text-xs font-mono font-bold hover:bg-neutral-800 transition-colors shadow-sm disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_task</span>
                    <span>
                      Add {selectedSizes.length} Size Variants ({batchColor}) &rarr;
                    </span>
                  </button>
                </div>
              </div>
            )}
            
            {formData.variants.length === 0 ? (
              <div className="border-2 border-dashed border-outline-variant rounded-lg bg-surface hover:bg-surface-container-low transition-colors p-8 text-center">
                <span className="material-symbols-outlined text-4xl text-outline mb-2">style</span>
                <p className="font-body-md text-body-md text-on-surface font-medium">No variants added yet</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Click '⚡ Multi-Size Generator' to batch-add sizes, or 'Add Single Piece' for one at a time.
                </p>
                <div className="flex justify-center gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowBatchGenerator(true)}
                    className="px-4 py-2 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold hover:bg-neutral-800 transition-colors shadow-xs"
                  >
                    ⚡ Multi-Size Generator
                  </button>
                  <button
                    type="button"
                    onClick={addVariant}
                    className="px-4 py-2 border border-outline-variant bg-surface-container-lowest text-on-surface rounded-lg font-mono text-xs font-bold hover:bg-surface-container-low transition-colors"
                  >
                    + Add Single Piece
                  </button>
                </div>
              </div>
            ) : (() => {
              // â”€â”€ Group variants by color (hexCode as key) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              type ColorGroup = { key: string; color: string; hexCode: string; indices: number[] };
              const groups: ColorGroup[] = [];
              const seenKeys = new Map<string, number>();

              formData.variants.forEach((v, idx) => {
                // Group key: normalise color name first (main discriminator), then hexCode as tiebreaker
                const colorNorm = (v.color || "").trim().toLowerCase();
                const hexNorm  = (v.hexCode || "").trim().toLowerCase();
                const key = colorNorm || hexNorm || "unknown";
                if (seenKeys.has(key)) {
                  groups[seenKeys.get(key)!].indices.push(idx);
                  // Keep the most complete data for the group header
                  const g = groups[seenKeys.get(key)!];
                  if (!g.hexCode || g.hexCode === "#000000") g.hexCode = v.hexCode || g.hexCode;
                } else {
                  seenKeys.set(key, groups.length);
                  groups.push({ key, color: v.color || "", hexCode: v.hexCode || "#000000", indices: [idx] });
                }
              });

              /** Update color name OR hexCode for every variant in the group */
              const updateGroupColorField = (groupIndices: number[], field: "color" | "hexCode", value: string) => {
                const newVariants = [...formData.variants];
                groupIndices.forEach((i) => {
                  newVariants[i] = { ...newVariants[i], [field]: value };
                });
                setFormData({ ...formData, variants: newVariants });
              };

              /** Update images for all variants in the group */
              const updateGroupImages = (groupIndices: number[], images: string[]) => {
                const newVariants = [...formData.variants];
                groupIndices.forEach((i) => {
                  newVariants[i] = { ...newVariants[i], images };
                });
                setFormData({ ...formData, variants: newVariants });
              };

              /** Add a blank size row pre-filled with this group's color and images */
              const addSizeToGroup = (group: ColorGroup) => {
                const groupImages = Array.isArray(formData.variants[group.indices[0]]?.images)
                  ? formData.variants[group.indices[0]].images
                  : [];
                const baseSlug = (formData.slug || formData.name || "PROD")
                  .trim()
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 8);
                const colorCode = (group.color || "CLR")
                  .trim()
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 3);
                const existingSizes = new Set(
                  group.indices.map((idx) => (formData.variants[idx]?.size || "").toUpperCase())
                );
                const standardSizes = ["S", "M", "L", "XL", "2XL"];
                const nextSize = standardSizes.find((s) => !existingSizes.has(s)) || "";
                const suggestedSku = nextSize
                  ? `${baseSlug || "PROD"}-${colorCode || "CLR"}-${nextSize}`
                  : "";

                setFormData({
                  ...formData,
                  variants: [
                    ...formData.variants,
                    {
                      size: nextSize,
                      color: group.color,
                      hexCode: group.hexCode,
                      sku: suggestedSku,
                      stock: 10,
                      additionalPrice: 0,
                      images: groupImages,
                      isAvailable: true,
                    },
                  ],
                });
              };

              /** Remove every variant belonging to this color group */
              const removeColorGroup = (indices: number[]) => {
                const toRemove = new Set(indices);
                setFormData({ ...formData, variants: formData.variants.filter((_, i) => !toRemove.has(i)) });
              };

              return (
                <div className="space-y-5">
                  {groups.map((group) => {
                    const firstIdx = group.indices[0];
                    const vState = variantUploadState[firstIdx] || { uploading: false, error: "", progress: "", manualUrl: "" };
                    const vImages = Array.isArray(formData.variants[firstIdx]?.images) ? formData.variants[firstIdx].images : [];

                    return (
                      <div key={group.key} className="border border-outline-variant rounded-xl bg-surface overflow-hidden shadow-xs">

                        {/* â”€â”€ Color Group Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                        <div className="bg-surface-container-low px-5 pt-4 pb-4 border-b border-outline-variant/60 space-y-4">
                          {/* Top: color summary + delete */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-9 h-9 rounded-full border-2 border-white shadow-md shrink-0"
                                style={{ backgroundColor: group.hexCode }}
                              />
                              <div>
                                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Color Group</span>
                                <p className="font-semibold text-on-surface text-sm leading-tight flex items-center gap-1.5">
                                  {group.color?.trim() ? (
                                    group.color
                                  ) : (
                                    <span className="text-error font-bold flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[14px]">warning</span>
                                      Color Name Required
                                    </span>
                                  )}{" "}
                                  <span className="font-mono text-[11px] text-on-surface-variant">{group.hexCode}</span>
                                </p>
                              </div>
                              <span className="text-[11px] bg-primary/10 text-primary font-bold px-2.5 py-0.5 rounded-full">
                                {group.indices.length} size{group.indices.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeColorGroup(group.indices)}
                              className="text-error hover:bg-error/10 p-1.5 rounded-lg transition-colors"
                              title="Remove entire color group"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </div>

                          {/* Color Name + HEX inputs */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                            <div className="sm:col-span-4">
                              <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase font-bold">
                                Color Name <span className="text-error">*</span>
                              </label>
                              <input
                                required
                                type="text"
                                className={`w-full bg-surface-container-lowest text-on-surface font-body-sm border rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary text-sm font-semibold ${
                                  !group.color?.trim() ? "border-error ring-1 ring-error/30" : "border-outline-variant"
                                }`}
                                value={group.color}
                                onChange={(e) => updateGroupColorField(group.indices, "color", e.target.value)}
                                placeholder="e.g. Onyx Black, Sage Green"
                              />
                              {!group.color?.trim() && (
                                <span className="text-[10px] text-error font-medium block mt-1">Color name is required</span>
                              )}
                            </div>
                            <div className="sm:col-span-8">
                              <label className="block font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase">Color HEX & Picker</label>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-9 h-9 rounded border border-outline-variant shadow-xs shrink-0"
                                  style={{ backgroundColor: group.hexCode }}
                                  title={`Swatch: ${group.hexCode}`}
                                />
                                <input
                                  type="color"
                                  aria-label="Color picker"
                                  className="w-9 h-9 p-0.5 rounded cursor-pointer border border-outline-variant bg-surface-container-lowest shrink-0"
                                  value={group.hexCode && /^#[0-9A-F]{6}$/i.test(group.hexCode) ? group.hexCode : "#000000"}
                                  onChange={(e) => updateGroupColorField(group.indices, "hexCode", e.target.value.toUpperCase())}
                                  title="Choose Color"
                                />
                                <input
                                  type="text"
                                  aria-label="Color HEX code"
                                  className="flex-1 bg-surface-container-lowest font-mono uppercase text-on-surface font-body-sm border border-outline-variant rounded px-2.5 py-2 focus:border-primary focus:ring-1 focus:ring-primary text-sm"
                                  value={group.hexCode}
                                  onChange={(e) => {
                                    let val = e.target.value.trim();
                                    if (!val.startsWith("#") && val.length > 0) val = "#" + val;
                                    updateGroupColorField(group.indices, "hexCode", val.toUpperCase());
                                  }}
                                  placeholder="#000000"
                                  maxLength={7}
                                />
                              </div>
                              {/* Palette quick-swatches */}
                              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                {STREETWEAR_COLOR_PALETTE.map((c) => (
                                  <button
                                    key={c.name}
                                    type="button"
                                    onClick={() => {
                                      updateGroupColorField(group.indices, "color", c.name);
                                      updateGroupColorField(group.indices, "hexCode", c.hex);
                                    }}
                                    className={`w-4 h-4 rounded-full border transition-all cursor-pointer hover:scale-125 ${
                                      (group.hexCode || "").toUpperCase() === c.hex.toUpperCase()
                                        ? "ring-2 ring-primary ring-offset-1 scale-110"
                                        : "border-black/20"
                                    }`}
                                    style={{ backgroundColor: c.hex }}
                                    title={`${c.name} (${c.hex})`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* â”€â”€ Sizes Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                        <div className="px-5 py-4 space-y-2">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Sizes & Inventory</span>
                            <button
                              type="button"
                              onClick={() => addSizeToGroup(group)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant text-on-surface text-xs font-semibold hover:bg-surface-container-low transition-colors cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[15px]">add</span>
                              Add Size
                            </button>
                          </div>

                          {/* Column headers */}
                          <div className="grid gap-2 px-2 pb-1.5 border-b border-outline-variant/40"
                            style={{ gridTemplateColumns: "80px 1fr 90px 100px 90px 36px" }}>
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase">Size</span>
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase">SKU *</span>
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase">Stock</span>
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase">+Price (₹)</span>
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase text-center">Available</span>
                            <span />
                          </div>

                          {/* Size rows */}
                          {group.indices.map((variantIdx) => {
                            const v = formData.variants[variantIdx];
                            return (
                              <div
                                key={variantIdx}
                                className="grid gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-surface-container-low transition-colors group/row"
                                style={{ gridTemplateColumns: "80px 1fr 90px 100px 90px 36px" }}
                              >
                                {/* Size */}
                                <input
                                  type="text"
                                  className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary text-sm font-bold text-center"
                                  value={v.size || ""}
                                  onChange={(e) => updateVariant(variantIdx, "size", e.target.value)}
                                  placeholder="M"
                                />
                                {/* SKU */}
                                <input
                                  required
                                  type="text"
                                  className="w-full bg-surface-container-lowest text-on-surface font-mono font-body-sm border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary text-xs"
                                  value={v.sku || ""}
                                  onChange={(e) => updateVariant(variantIdx, "sku", e.target.value)}
                                  placeholder="SKU-XXX-M"
                                />
                                {/* Stock */}
                                {isEditing ? (
                                  <div className="w-full bg-surface-container-high text-on-surface-variant font-body-sm border border-outline-variant/50 rounded px-2.5 py-1.5 opacity-70 cursor-not-allowed flex items-center justify-between text-sm">
                                    {v.stock} <span className="material-symbols-outlined text-[13px]">lock</span>
                                  </div>
                                ) : (
                                  <input
                                    required
                                    type="number"
                                    min="0"
                                    className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary text-sm"
                                    value={v.stock}
                                    onChange={(e) => updateVariant(variantIdx, "stock", e.target.value)}
                                  />
                                )}
                                {/* Additional Price */}
                                <input
                                  type="number"
                                  min="0"
                                  className="w-full bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-2.5 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary text-sm"
                                  value={v.additionalPrice || 0}
                                  onChange={(e) => updateVariant(variantIdx, "additionalPrice", e.target.value)}
                                />
                                {/* Available checkbox */}
                                <div className="flex items-center justify-center">
                                  <label className="relative flex items-center justify-center w-5 h-5 border border-outline-variant rounded cursor-pointer hover:border-primary transition-colors">
                                    <input
                                      type="checkbox"
                                      className="opacity-0 absolute w-full h-full cursor-pointer"
                                      checked={v.isAvailable !== false}
                                      onChange={(e) => updateVariant(variantIdx, "isAvailable", e.target.checked)}
                                    />
                                    {v.isAvailable !== false && (
                                      <span className="material-symbols-outlined text-[15px] text-primary pointer-events-none">check</span>
                                    )}
                                  </label>
                                </div>
                                {/* Delete row */}
                                <button
                                  type="button"
                                  onClick={() => removeVariant(variantIdx)}
                                  className="flex items-center justify-center w-8 h-8 text-on-surface-variant hover:text-error hover:bg-error/10 rounded-lg transition-colors cursor-pointer opacity-0 group-hover/row:opacity-100"
                                  title="Remove this size"
                                >
                                  <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* â”€â”€ Color-Specific Images (shared for this color) â”€â”€â”€â”€ */}
                        <div className="px-5 pb-5 pt-1 border-t border-outline-variant/40 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3">
                            <label className="block font-label-caps text-[10px] text-on-surface-variant uppercase font-bold">
                              Color-Specific Images
                            </label>
                            <span className="font-body-xs text-[11px] text-on-surface-variant">
                              Shown on PDP when customer selects {group.color || "this color"}.
                            </span>
                          </div>

                          {/* Upload controls */}
                          <div className="flex flex-wrap items-center gap-3">
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
                                onChange={(e) => handleVariantImageUpload(firstIdx, e.target.files)}
                                disabled={vState.uploading}
                              />
                            </label>
                            <div className="flex flex-1 min-w-[280px] gap-2">
                              <input
                                type="text"
                                className="flex-1 bg-surface-container-lowest text-on-surface font-body-sm border border-outline-variant rounded px-3 py-1.5 focus:border-primary focus:ring-1 focus:ring-primary"
                                value={vState.manualUrl || ""}
                                onChange={(e) =>
                                  setVariantUploadState((prev) => ({
                                    ...prev,
                                    [firstIdx]: { ...(prev[firstIdx] || { uploading: false, error: "", progress: "" }), manualUrl: e.target.value },
                                  }))
                                }
                                placeholder="Paste Direct Image URL fallback..."
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const url = vState.manualUrl?.trim();
                                  if (!url) return;
                                  updateGroupImages(group.indices, [...vImages, url]);
                                  setVariantUploadState((prev) => ({
                                    ...prev,
                                    [firstIdx]: { ...(prev[firstIdx] || { uploading: false, error: "", progress: "" }), manualUrl: "" },
                                  }));
                                }}
                                className="px-3 py-1.5 bg-surface-container-high border border-outline-variant hover:border-primary text-on-surface font-label-caps text-xs rounded transition-colors"
                              >
                                Add URL
                              </button>
                            </div>
                          </div>

                          {/* Error */}
                          {vState.error && (
                            <div className="p-3 bg-error-container/20 text-error border border-error/20 rounded text-xs">{vState.error}</div>
                          )}

                          {/* Image thumbnails */}
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
                                    alt={`${group.color} Image ${imgIdx + 1}`}
                                    className="w-full h-full object-cover"
                                    onError={(e) => { e.currentTarget.src = "https://placehold.co/300x400?text=Image+Error"; }}
                                  />
                                  {imgIdx === 0 && (
                                    <span className="absolute top-1 left-1 bg-primary text-on-primary font-label-caps text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                      PRIMARY
                                    </span>
                                  )}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5">
                                    <div className="flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updated = vImages.filter((_: string, i: number) => i !== imgIdx);
                                          updateGroupImages(group.indices, updated);
                                        }}
                                        className="w-6 h-6 bg-red-600/90 text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors"
                                        title="Remove Image"
                                      >
                                        <span className="material-symbols-outlined text-[14px]">delete</span>
                                      </button>
                                    </div>
                                    <div className="flex justify-between items-center bg-surface-container-lowest/90 backdrop-blur-xs rounded px-1.5 py-0.5">
                                      <button
                                        type="button"
                                        disabled={imgIdx === 0}
                                        onClick={() => {
                                          if (imgIdx === 0) return;
                                          const updated = [...vImages];
                                          const [moved] = updated.splice(imgIdx, 1);
                                          updated.splice(imgIdx - 1, 0, moved);
                                          updateGroupImages(group.indices, updated);
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
                                          updateGroupImages(group.indices, updated);
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
              );
            })()}
          </section>

          {/* Size Guide Table Builder */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-6 border-b border-outline-variant pb-4">
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Size Guide Measurement Table</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({
                    ...formData,
                    sizeGuideTable: [
                      { size: "S", chest: 38, length: 27, shoulder: 17.5 },
                      { size: "M", chest: 40, length: 28, shoulder: 18.5 },
                      { size: "L", chest: 42, length: 29, shoulder: 19.5 },
                      { size: "XL", chest: 44, length: 30, shoulder: 20.5 },
                      { size: "XXL", chest: 46, length: 31, shoulder: 21.5 },
                    ]
                  })}
                  className="px-2.5 py-1 text-xs font-semibold rounded border border-outline-variant bg-surface-container-low hover:bg-surface-container text-on-surface transition-colors flex items-center gap-1"
                  title="Auto-fill standard Indian garment size measurements"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                  Fill Standard S–XXL
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({
                    ...formData,
                    sizeGuideTable: [...formData.sizeGuideTable, { size: "M", chest: 42, length: 28, shoulder: 19 }]
                  })}
                  className="text-primary font-body-sm text-body-sm font-semibold hover:underline flex items-center gap-1 ml-1"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span> Add Row
                </button>
              </div>
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

          {/* Technical Specifications Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-6 border-b border-outline-variant pb-4">Technical Specifications & Garment Details</h3>

            {/* Quick Fabric & GSM Presets */}
            <div className="mb-5 pb-4 border-b border-outline-variant/40">
              <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">
                ⚡ Quick Blank Presets (Fabric &amp; GSM):
              </span>
              <div className="flex flex-wrap gap-2">
                {FABRIC_GSM_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, fabric: preset.fabric, gsm: preset.gsm }))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                      formData.gsm === preset.gsm && formData.fabric === preset.fabric
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-xs scale-105"
                        : "border-outline-variant bg-surface hover:bg-surface-container-low text-on-surface"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Fabric Composition</label>
                <input type="text" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.fabric} onChange={e => setFormData({...formData, fabric: e.target.value})} placeholder="e.g. 100% Heavyweight French Terry Cotton" />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Fabric Weight (GSM)</label>
                <input type="number" min="0" className="w-full bg-surface text-on-surface font-body-md text-body-md border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors" value={formData.gsm === 0 ? "" : formData.gsm} onChange={e => setFormData({...formData, gsm: e.target.value === "" ? 0 : Number(e.target.value)})} placeholder="e.g. 240" />
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
                value={careInput}
                onChange={(e) => {
                  setCareInput(e.target.value);
                  setFormData({
                    ...formData,
                    careInstructions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  });
                }}
                placeholder="e.g. Machine wash cold inside out, Do not iron directly on print, Line dry in shade"
              />
            </div>
          </section>

          {/* Search Engine Optimization (SEO) & Social Sharing Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex items-center justify-between gap-3 mb-6 border-b border-outline-variant pb-4">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Search Engine Optimization (SEO)</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Optimize your garment for Google search indexing, rich snippets, and social sharing.
                </p>
              </div>
              <span className="material-symbols-outlined text-outline text-[24px]">travel_explore</span>
            </div>

            {/* Google SERP Live Snippet Preview */}
            <div className="mb-6 p-4 rounded-xl bg-surface-container-low border border-outline-variant/40 space-y-1">
              <span className="font-mono text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">
                Google Search Snippet Preview
              </span>
              <div className="pt-1">
                <p className="text-xs text-[#202124] dark:text-[#bdc1c6] font-mono truncate">
                  samratfashion.com &gt; products &gt; {formData.slug || "product-slug"}
                </p>
                <h4 className="text-base text-[#1a0dab] dark:text-[#8ab4f8] hover:underline font-medium cursor-pointer line-clamp-1">
                  {formData.seo?.title || formData.name || "Product Title"} — Samrat Fashion
                </h4>
                <p className="text-xs text-[#4d5156] dark:text-[#bdc1c6] line-clamp-2 leading-relaxed">
                  {formData.seo?.description || formData.description || "High quality 240+ GSM oversized streetwear graphic apparel made in India."}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-label-caps text-xs text-on-surface-variant uppercase font-bold">SEO Meta Title</label>
                  <span className={`text-[11px] font-mono ${(formData.seo?.title?.length || 0) > 60 ? 'text-amber-600 font-bold' : 'text-on-surface-variant'}`}>
                    {formData.seo?.title?.length || 0} / 60 characters
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={70}
                  className="w-full bg-surface text-on-surface font-body-md text-sm border border-outline-variant rounded px-4 py-2.5 focus:outline-none focus:border-primary"
                  value={formData.seo?.title || ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, seo: { ...prev.seo, title: e.target.value } }))}
                  placeholder={formData.name ? `${formData.name} — Luxury Streetwear` : "e.g. Heavyweight Oversized Graphic Tee — Streetwear"}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-label-caps text-xs text-on-surface-variant uppercase font-bold">SEO Meta Description</label>
                  <span className={`text-[11px] font-mono ${(formData.seo?.description?.length || 0) > 160 ? 'text-amber-600 font-bold' : 'text-on-surface-variant'}`}>
                    {formData.seo?.description?.length || 0} / 160 characters
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={180}
                  className="w-full bg-surface text-on-surface font-body-md text-sm border border-outline-variant rounded px-4 py-2.5 focus:outline-none focus:border-primary leading-relaxed"
                  value={formData.seo?.description || ""}
                  onChange={(e) => setFormData((prev) => ({ ...prev, seo: { ...prev.seo, description: e.target.value } }))}
                  placeholder="e.g. Shop the authentic 240 GSM combed cotton oversized streetwear tee with high-density print and drop shoulder fit."
                />
              </div>
            </div>
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

          {/* Pricing Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface mb-4 border-b border-outline-variant pb-3">Pricing</h3>
            <div className="space-y-4">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5 uppercase font-bold text-[11px]">Base Price (₹)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant font-mono text-sm">₹</span>
                  <input
                    required
                    type="number"
                    min="0"
                    placeholder="0.00"
                    className="w-full bg-surface text-on-surface font-body-md text-sm border border-outline-variant rounded pl-8 pr-4 py-2.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-mono font-bold"
                    value={formData.basePrice === 0 ? "" : formData.basePrice}
                    onChange={e => setFormData({ ...formData, basePrice: e.target.value === "" ? 0 : Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase font-bold text-[11px]">
                    MRP (₹) <span className="text-on-surface-variant/50 normal-case font-normal">(Optional)</span>
                  </label>
                  {formData.basePrice > 0 && (
                    <div className="flex gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, mrp: Math.round(prev.basePrice * 1.5) }))}
                        className="px-1.5 py-0.5 rounded border border-outline-variant/60 hover:bg-surface-container text-on-surface-variant transition-colors cursor-pointer"
                        title="Set MRP at 50% markup"
                      >
                        +50% (₹{Math.round(formData.basePrice * 1.5)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, mrp: Math.round(prev.basePrice * 2) }))}
                        className="px-1.5 py-0.5 rounded border border-outline-variant/60 hover:bg-surface-container text-on-surface-variant transition-colors cursor-pointer"
                        title="Set MRP at 2x markup"
                      >
                        2x (₹{Math.round(formData.basePrice * 2)})
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant font-mono text-sm">₹</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Optional"
                    className="w-full bg-surface text-on-surface font-body-md text-sm border border-outline-variant rounded pl-8 pr-4 py-2.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-mono"
                    value={formData.mrp === 0 ? "" : formData.mrp}
                    onChange={(e) => setFormData({ ...formData, mrp: e.target.value === "" ? 0 : Number(e.target.value) })}
                  />
                </div>
              </div>

              {/* Live Pricing Preview & Customer Discount Calculation */}
              {formData.basePrice > 0 && formData.mrp > 0 && (
                <div className="pt-3 border-t border-outline-variant/40 space-y-2 text-xs font-mono">
                  {formData.mrp > formData.basePrice ? (
                    <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg font-bold text-[11px]">
                      <span className="material-symbols-outlined text-[15px]">local_offer</span>
                      <span>
                        {Math.round(((formData.mrp - formData.basePrice) / formData.mrp) * 100)}% OFF
                      </span>
                      <span className="text-emerald-700 font-normal">
                        (Save ₹{(formData.mrp - formData.basePrice).toLocaleString('en-IN')})
                      </span>
                    </div>
                  ) : formData.mrp < formData.basePrice ? (
                    <div className="flex items-center gap-1.5 text-error bg-error-container/20 border border-error/30 px-2.5 py-1.5 rounded-lg font-bold text-[11px]">
                      <span className="material-symbols-outlined text-[15px]">warning</span>
                      <span>MRP lower than Base Price.</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between items-center text-on-surface-variant font-medium text-[11px]">
                    <span>Selling Price:</span>
                    <strong className="text-on-surface text-sm font-bold">₹{formData.basePrice.toLocaleString('en-IN')}</strong>
                  </div>
                </div>
              )}
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
                    {hierarchicalCategories.map(c => (
                      <option key={c._id} value={c._id} disabled={c.disabled}>
                        {c.label}
                      </option>
                    ))}
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

              {/* Thematic Capsule Drops */}
              <div className="pt-6 border-t border-outline-variant">
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-label-caps text-xs text-on-surface-variant uppercase font-bold">
                    Thematic Capsule Drops
                  </label>
                  <span className="text-[10px] text-on-surface-variant font-mono">
                    {formData.themeIds.length} selected
                  </span>
                </div>
                {themes.length === 0 ? (
                  <p className="text-xs text-on-surface-variant italic">No capsule drop themes configured yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {themes.map((theme) => {
                      const isSelected = formData.themeIds.includes(theme._id);
                      return (
                        <button
                          key={theme._id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setFormData({
                                ...formData,
                                themeIds: formData.themeIds.filter((id) => id !== theme._id),
                              });
                            } else {
                              setFormData({
                                ...formData,
                                themeIds: [...formData.themeIds, theme._id],
                              });
                            }
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                            isSelected
                              ? "bg-neutral-900 text-white font-bold shadow-xs border border-neutral-900"
                              : "bg-surface-container-low text-on-surface border border-outline-variant hover:border-neutral-900"
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${isSelected ? "bg-primary" : "bg-neutral-400"}`} />
                          <span>{theme.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Customizable Garment Blank */}
              <div className="pt-6 border-t border-outline-variant">
                <label className="flex items-center justify-between text-body-md cursor-pointer group">
                  <div>
                    <span className="block font-medium">Customizable Blank</span>
                    <span className="block text-[11px] text-on-surface-variant">Available in Studio Customizer</span>
                  </div>
                  <div className={`w-11 h-6 rounded-full relative transition-colors ${formData.isCustomizable ? 'bg-primary' : 'bg-surface-variant'}`}>
                    <input type="checkbox" className="opacity-0 absolute w-full h-full cursor-pointer z-10" checked={formData.isCustomizable} onChange={e => setFormData({...formData, isCustomizable: e.target.checked})} />
                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${formData.isCustomizable ? 'translate-x-5' : ''}`}></div>
                  </div>
                </label>
              </div>
            </div>
          </section>

          {/* Tags & Micro-specs Card */}
          <section className="bg-surface-container-lowest rounded-lg border border-outline-variant p-6 hover:scale-[1.005] transition-transform duration-300">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Tags &amp; Micro-specs</h3>
              <span className="font-mono text-[11px] text-on-surface-variant">{formData.tags.length} tags</span>
            </div>
            <p className="font-body-sm text-xs text-on-surface-variant mb-4">
              Displayed as garment specs on storefront cards and indexed for search.
            </p>

            {/* Active Tags */}
            <div className="flex flex-wrap gap-1.5 mb-4 min-h-[32px]">
              {formData.tags.length === 0 ? (
                <span className="text-xs text-on-surface-variant italic">No tags added yet.</span>
              ) : (
                formData.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-high border border-outline-variant/60 font-mono text-xs text-on-surface font-semibold"
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(t)}
                      className="text-on-surface-variant hover:text-error transition-colors cursor-pointer"
                      title="Remove tag"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Tag Input */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Add tag (e.g. ACID WASH)..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="flex-1 bg-surface text-on-surface font-mono text-xs border border-outline-variant rounded px-3 py-2 focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => handleAddTag()}
                disabled={!tagInput.trim()}
                className="px-3 py-2 bg-primary text-on-primary font-mono text-xs font-bold rounded hover:bg-primary-fixed-variant transition-colors disabled:opacity-40 cursor-pointer"
              >
                Add
              </button>
            </div>

            {/* Quick Presets */}
            <div>
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">
                ⚡ Quick Presets:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {STREETWEAR_TAG_PRESETS.map((tag) => {
                  const isAdded = formData.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => (isAdded ? handleRemoveTag(tag) : handleAddTag(tag))}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded transition-all cursor-pointer ${
                        isAdded
                          ? "bg-primary/10 text-primary font-bold border border-primary/30"
                          : "bg-surface hover:bg-surface-container border border-outline-variant/40 text-on-surface-variant"
                      }`}
                    >
                      {isAdded ? `✓ ${tag}` : `+ ${tag}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Floating Bottom Sticky Action Bar */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-40 bg-surface-container-lowest/95 backdrop-blur-md border-t border-outline-variant py-3.5 px-6 md:px-8 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="max-w-container-max mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${formData.status === 'ACTIVE' ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-amber-500'}`} />
            <div className="truncate">
              <span className="font-bold text-xs text-on-surface truncate block">
                {formData.name || (isEditing ? "Edit Product" : "New Garment Product")}
              </span>
              <span className="font-mono text-[11px] text-on-surface-variant truncate block">
                {formData.status} • {formData.variants.reduce((acc, v) => acc + (Number(v.stock) || 0), 0)} units in stock • {formData.variants.length} sizes in {new Set(formData.variants.map((v) => v.color?.trim() || v.hexCode)).size} colors
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 rounded-lg border border-outline text-on-surface font-body-sm text-xs font-semibold hover:bg-surface-container-low transition-colors cursor-pointer"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={saving || deleting}
              className="px-5 py-2 rounded-lg bg-primary text-on-primary font-body-sm text-xs font-bold hover:bg-primary-fixed-variant transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              <span>{saving ? "Saving..." : isEditing ? "Save Changes" : "Create Product"}</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
