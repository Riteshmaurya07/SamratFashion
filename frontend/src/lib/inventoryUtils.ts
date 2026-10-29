export interface RawVariant {
  _id?: string;
  sku: string;
  size?: string;
  color?: string;
  hexCode?: string;
  stock: number;
  reorderThreshold?: number;
  warehouseLocation?: string;
  images?: string[];
  isAvailable?: boolean;
  additionalPrice?: number;
}

export interface RawProduct {
  _id: string;
  name: string;
  slug: string;
  images?: string[];
  categoryId?: { _id?: string; name?: string; slug?: string } | string;
  variants?: RawVariant[];
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type VariantStockStatus = "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY";

export interface NormalizedVariant {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  size: string;
  color: string;
  hexCode?: string;
  stock: number;
  reorderThreshold: number;
  warehouseLocation: string;
  image?: string;
  isAvailable: boolean;
  stockStatus: VariantStockStatus;
}

export interface ColorwayGroup {
  color: string;
  hexCode?: string;
  image?: string;
  totalStock: number;
  variants: NormalizedVariant[];
  variantsBySize: Record<string, NormalizedVariant[]>;
  hasOutOfStock: boolean;
  hasLowStock: boolean;
}

export interface StockHealthSummary {
  outOfStockCount: number;
  lowStockCount: number;
  healthyCount: number;
}

export interface ProductInventoryGroup {
  productId: string;
  name: string;
  slug: string;
  image?: string;
  categoryName?: string;
  totalStock: number;
  totalVariants: number;
  colorways: ColorwayGroup[];
  allSizes: string[];
  stockHealth: StockHealthSummary;
  overallStatus: "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY";
}

export interface InventoryStats {
  totalProducts: number;
  totalVariants: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface FilterOptions {
  search?: string;
  stockStatus?: "ALL" | "OUT_OF_STOCK" | "LOW_STOCK" | "NEEDS_ATTENTION" | "HEALTHY" | "";
  color?: string;
  size?: string;
}

export const COLOR_HEX_FALLBACK: Record<string, string> = {
  black: "#18181B",
  white: "#FFFFFF",
  beige: "#D2B48C",
  "sand beige": "#D2B48C",
  "sage green": "#8A9A86",
  green: "#2E7D32",
  red: "#D32F2F",
  blue: "#1976D2",
  navy: "#000080",
  grey: "#808080",
  gray: "#808080",
  charcoal: "#36454F",
  olive: "#808000",
  brown: "#8D6E63",
  yellow: "#EAB308",
  purple: "#9333EA",
  pink: "#EC4899",
  orange: "#F97316",
  maroon: "#800000",
  lavender: "#E6E6FA",
  cream: "#FFFDD0",
  tan: "#D2B48C",
  khaki: "#F0E68C",
  teal: "#008080",
};

export function resolveColorHex(
  color: string | undefined,
  hexCode: string | undefined,
  siblingVariants?: RawVariant[]
): string | undefined {
  if (hexCode && hexCode.trim().length > 0) return hexCode;
  const cleanColor = (color || "").trim().toLowerCase();
  if (!cleanColor) return undefined;

  if (siblingVariants && Array.isArray(siblingVariants)) {
    const siblingMatch = siblingVariants.find(
      (s) => s.color && s.color.trim().toLowerCase() === cleanColor && s.hexCode
    );
    if (siblingMatch?.hexCode) return siblingMatch.hexCode;
  }

  return COLOR_HEX_FALLBACK[cleanColor];
}

const APPAREL_SIZE_MAP: Record<string, number> = {
  XXXS: 1,
  "3XS": 1,
  XXS: 2,
  "2XS": 2,
  XS: 3,
  S: 4,
  M: 5,
  L: 6,
  XL: 7,
  XXL: 8,
  "2XL": 8,
  XXXL: 9,
  "3XL": 9,
  "4XL": 10,
  "5XL": 11,
  FREE: 12,
  "FREE SIZE": 12,
  "ONE SIZE": 13,
  OS: 13,
};

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const aTrim = a.trim();
    const bTrim = b.trim();
    const aUpper = aTrim.toUpperCase();
    const bUpper = bTrim.toUpperCase();

    const aRank = APPAREL_SIZE_MAP[aUpper];
    const bRank = APPAREL_SIZE_MAP[bUpper];

    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;

    const aNum = Number(aTrim);
    const bNum = Number(bTrim);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;

    return aUpper.localeCompare(bUpper);
  });
}

export function getVariantStockStatus(stock: number, reorderThreshold: number = 5): VariantStockStatus {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= reorderThreshold) return "LOW_STOCK";
  return "HEALTHY";
}

export function groupProductInventory(product: RawProduct): ProductInventoryGroup {
  const rawVariants = Array.isArray(product.variants) ? product.variants : [];
  const primaryImage = product.images?.[0];

  let categoryName: string | undefined;
  if (product.categoryId && typeof product.categoryId === "object" && product.categoryId.name) {
    categoryName = product.categoryId.name;
  }

  let totalStock = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;
  let healthyCount = 0;

  const colorMap = new Map<string, {
    colorName: string;
    hexCode?: string;
    image?: string;
    variants: NormalizedVariant[];
    variantsBySize: Record<string, NormalizedVariant[]>;
  }>();

  const allSizesSet = new Set<string>();

  rawVariants.forEach((v, index) => {
    const stock = typeof v.stock === "number" && !isNaN(v.stock) ? v.stock : 0;
    const reorderThreshold = typeof v.reorderThreshold === "number" && !isNaN(v.reorderThreshold) ? v.reorderThreshold : 5;
    const stockStatus = getVariantStockStatus(stock, reorderThreshold);

    totalStock += stock;
    if (stockStatus === "OUT_OF_STOCK") outOfStockCount++;
    else if (stockStatus === "LOW_STOCK") lowStockCount++;
    else healthyCount++;

    const colorName = (v.color || "Standard").trim();
    const sizeName = (v.size || "Standard").trim();
    allSizesSet.add(sizeName);

    const resolvedHex = resolveColorHex(colorName, v.hexCode, rawVariants);

    const siblingColorMatch = rawVariants.find(
      (s) =>
        s.color &&
        s.color.trim().toLowerCase() === colorName.toLowerCase() &&
        Array.isArray(s.images) &&
        s.images.length > 0
    );

    const variantImage =
      (Array.isArray(v.images) && v.images.length > 0 ? v.images[0] : null) ||
      (siblingColorMatch ? siblingColorMatch.images![0] : null) ||
      primaryImage;

    const normalizedVariant: NormalizedVariant = {
      variantId: v._id || `${product._id}-var-${v.sku || index}`,
      productId: product._id,
      productName: product.name,
      productSlug: product.slug,
      sku: v.sku || `${product.slug}-${sizeName}-${index}`,
      size: sizeName,
      color: colorName,
      hexCode: resolvedHex,
      stock,
      reorderThreshold,
      warehouseLocation: v.warehouseLocation || "Main Warehouse",
      image: variantImage,
      isAvailable: v.isAvailable !== false,
      stockStatus,
    };

    const colorKey = colorName.toLowerCase();
    if (!colorMap.has(colorKey)) {
      colorMap.set(colorKey, {
        colorName,
        hexCode: resolvedHex,
        image: variantImage,
        variants: [],
        variantsBySize: {},
      });
    }

    const colorGroup = colorMap.get(colorKey)!;
    colorGroup.variants.push(normalizedVariant);

    if (!colorGroup.variantsBySize[sizeName]) {
      colorGroup.variantsBySize[sizeName] = [];
    }
    colorGroup.variantsBySize[sizeName].push(normalizedVariant);

    if (!colorGroup.hexCode && resolvedHex) {
      colorGroup.hexCode = resolvedHex;
    }
    if (!colorGroup.image && variantImage) {
      colorGroup.image = variantImage;
    }
  });

  const colorways: ColorwayGroup[] = Array.from(colorMap.values()).map((cg) => {
    const cgStock = cg.variants.reduce((sum, v) => sum + v.stock, 0);
    const hasOutOfStock = cg.variants.some((v) => v.stockStatus === "OUT_OF_STOCK");
    const hasLowStock = cg.variants.some((v) => v.stockStatus === "LOW_STOCK");

    return {
      color: cg.colorName,
      hexCode: cg.hexCode,
      image: cg.image,
      totalStock: cgStock,
      variants: cg.variants,
      variantsBySize: cg.variantsBySize,
      hasOutOfStock,
      hasLowStock,
    };
  });

  let overallStatus: "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY" = "HEALTHY";
  if (outOfStockCount > 0) {
    overallStatus = "OUT_OF_STOCK";
  } else if (lowStockCount > 0) {
    overallStatus = "LOW_STOCK";
  }

  return {
    productId: product._id,
    name: product.name,
    slug: product.slug,
    image: primaryImage,
    categoryName,
    totalStock,
    totalVariants: rawVariants.length,
    colorways,
    allSizes: sortSizes(Array.from(allSizesSet)),
    stockHealth: {
      outOfStockCount,
      lowStockCount,
      healthyCount,
    },
    overallStatus,
  };
}

export function groupAllProductsInventory(products: RawProduct[]): ProductInventoryGroup[] {
  if (!Array.isArray(products)) return [];
  return products.map(groupProductInventory);
}

export function calculateInventoryStats(groups: ProductInventoryGroup[]): InventoryStats {
  let totalVariants = 0;
  let totalUnits = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const group of groups) {
    totalVariants += group.totalVariants;
    totalUnits += group.totalStock;
    lowStockCount += group.stockHealth.lowStockCount;
    outOfStockCount += group.stockHealth.outOfStockCount;
  }

  return {
    totalProducts: groups.length,
    totalVariants,
    totalUnits,
    lowStockCount,
    outOfStockCount,
  };
}

export function extractUniqueColors(groups: ProductInventoryGroup[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    for (const c of g.colorways) {
      if (c.color) set.add(c.color);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function extractUniqueSizes(groups: ProductInventoryGroup[]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    for (const s of g.allSizes) {
      if (s) set.add(s);
    }
  }
  return sortSizes(Array.from(set));
}

export function filterProductGroups(
  groups: ProductInventoryGroup[],
  filters: FilterOptions
): ProductInventoryGroup[] {
  const search = filters.search?.trim().toLowerCase();
  const stockStatus = filters.stockStatus;
  const colorFilter = filters.color?.trim().toLowerCase();
  const sizeFilter = filters.size?.trim().toUpperCase();

  return groups.filter((p) => {
    // 1. Search filter
    if (search) {
      const matchName = p.name.toLowerCase().includes(search);
      const matchSlug = p.slug.toLowerCase().includes(search);
      const matchCategory = p.categoryName ? p.categoryName.toLowerCase().includes(search) : false;
      const matchVariants = p.colorways.some((cw) =>
        cw.variants.some(
          (v) =>
            v.sku.toLowerCase().includes(search) ||
            v.color.toLowerCase().includes(search) ||
            v.size.toLowerCase().includes(search)
        )
      );
      if (!matchName && !matchSlug && !matchCategory && !matchVariants) {
        return false;
      }
    }

    // 2. Stock status filter
    if (stockStatus && stockStatus !== "ALL") {
      if (stockStatus === "OUT_OF_STOCK" && p.stockHealth.outOfStockCount === 0) {
        return false;
      }
      if (stockStatus === "LOW_STOCK" && p.stockHealth.lowStockCount === 0) {
        return false;
      }
      if (
        stockStatus === "NEEDS_ATTENTION" &&
        p.stockHealth.outOfStockCount === 0 &&
        p.stockHealth.lowStockCount === 0
      ) {
        return false;
      }
      if (
        stockStatus === "HEALTHY" &&
        (p.stockHealth.outOfStockCount > 0 || p.stockHealth.lowStockCount > 0 || p.totalVariants === 0)
      ) {
        return false;
      }
    }

    // 3. Color filter
    if (colorFilter) {
      const hasColor = p.colorways.some(
        (cw) => cw.color.toLowerCase() === colorFilter
      );
      if (!hasColor) return false;
    }

    // 4. Size filter
    if (sizeFilter) {
      const hasSize = p.allSizes.some(
        (s) => s.trim().toUpperCase() === sizeFilter
      );
      if (!hasSize) return false;
    }

    return true;
  });
}

export function validateStockAdjustment(
  currentStock: number,
  quantity: number,
  reason: string
): { valid: boolean; error?: string } {
  if (typeof quantity !== "number" || isNaN(quantity) || !Number.isInteger(quantity)) {
    return { valid: false, error: "Adjustment quantity must be an integer" };
  }
  if (quantity === 0) {
    return { valid: false, error: "Quantity adjustment cannot be 0" };
  }
  if (!reason || reason.trim().length < 2) {
    return { valid: false, error: "Reason is required (at least 2 characters)" };
  }
  if (quantity < 0 && Math.abs(quantity) > currentStock) {
    return {
      valid: false,
      error: `Cannot decrease by ${Math.abs(quantity)} units. Current stock is only ${currentStock} units.`,
    };
  }
  return { valid: true };
}
