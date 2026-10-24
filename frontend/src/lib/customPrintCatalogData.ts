export type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  backMockupImageUrl?: string;
  displayPrice?: number;
  minOrderQuantity?: number;
  isActive?: boolean;
  category?: string;
  categoryId?: { _id: string; name: string; slug?: string; parentCategory?: any } | string;
  placementTemplateIds?: Array<{
    _id: string;
    name: string;
    code: string;
    side: string;
    previewConfig: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  productId?: {
    _id: string;
    categoryId?: { _id: string; name: string; slug?: string } | string;
    name: string;
    basePrice: number;
    mrp?: number;
    discount?: number;
    fabric?: string;
    fit?: string;
    gsm?: number;
    images?: string[];
    variants: Array<{
      _id?: string;
      size?: string;
      color: string;
      hexCode?: string;
      sku?: string;
      stock?: number;
      isAvailable?: boolean;
      images?: string[];
    }>;
  };
  placementTemplateId?: {
    _id: string;
    name: string;
    code: string;
    side: string;
    previewConfig: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};
