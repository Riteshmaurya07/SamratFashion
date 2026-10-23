import { api } from "@/lib/api";

export type CategoryStatus = "ACTIVE" | "INACTIVE";

export interface CategoryParentRef {
  _id: string;
  name: string;
  slug: string;
  status?: CategoryStatus;
}

export interface CategoryItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentCategory?: string | CategoryParentRef | null;
  displayOrder: number;
  status: CategoryStatus;
  productCount?: number;
  seo?: {
    title?: string;
    description?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export type ThemeStatus = "ACTIVE" | "INACTIVE";

export interface ThemeItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  heroImage?: string;
  thumbnail?: string;
  status: ThemeStatus;
  displayOrder: number;
  isFeatured?: boolean;
  productCount?: number;
  seo?: {
    title?: string;
    description?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export async function getActiveCategories(): Promise<CategoryItem[]> {
  try {
    const res = await api.get<{ success: boolean; data: CategoryItem[] }>("/catalog/categories");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch active categories", error);
    return [];
  }
}

export async function getCategoryBySlug(slug: string): Promise<CategoryItem | null> {
  try {
    const normalizedSlug = slug.toLowerCase().trim();
    const res = await api.get<{ success: boolean; data: CategoryItem }>(`/catalog/categories/${encodeURIComponent(normalizedSlug)}`);
    return res.data?.data || null;
  } catch (error) {
    console.error(`Failed to fetch category by slug: ${slug}`, error);
    return null;
  }
}

export async function getActiveThemes(): Promise<ThemeItem[]> {
  try {
    const res = await api.get<{ success: boolean; data: ThemeItem[] }>("/catalog/themes");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch active themes", error);
    return [];
  }
}

export async function getThemeBySlug(slug: string): Promise<ThemeItem | null> {
  try {
    const normalizedSlug = slug.toLowerCase().trim();
    const res = await api.get<{ success: boolean; data: ThemeItem }>(`/catalog/themes/${encodeURIComponent(normalizedSlug)}`);
    return res.data?.data || null;
  } catch (error) {
    console.error(`Failed to fetch theme by slug: ${slug}`, error);
    return null;
  }
}
