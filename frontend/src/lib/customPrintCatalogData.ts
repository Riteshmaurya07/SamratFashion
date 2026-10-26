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
};
