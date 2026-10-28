import { cache } from "react";
import { api } from "@/lib/api";

interface CacheStore<T> {
  data: T;
  expires: number;
}

let categoriesMemCache: CacheStore<CategoryItem[]> | null = null;
let themesMemCache: CacheStore<ThemeItem[]> | null = null;
const categoryBySlugCache = new Map<string, CacheStore<CategoryItem | null>>();
const themeBySlugCache = new Map<string, CacheStore<ThemeItem | null>>();
const CACHE_TTL_MS = 60_000;

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

export const getActiveCategories = cache(async function getActiveCategories(): Promise<CategoryItem[]> {
  if (categoriesMemCache && categoriesMemCache.expires > Date.now()) {
    return categoriesMemCache.data;
  }
  try {
    const res = await api.get<{ success: boolean; data: CategoryItem[] }>("/catalog/categories");
    if (res.data?.success && Array.isArray(res.data.data)) {
      categoriesMemCache = { data: res.data.data, expires: Date.now() + CACHE_TTL_MS };
      return res.data.data;
    }
    return categoriesMemCache?.data || [];
  } catch (error) {
    if (categoriesMemCache?.data) return categoriesMemCache.data;
    console.error("Failed to fetch active categories", error);
    return [];
  }
});

export const getCategoryBySlug = cache(async function getCategoryBySlug(slug: string): Promise<CategoryItem | null> {
  const normalizedSlug = slug.toLowerCase().trim();
  const cached = categoryBySlugCache.get(normalizedSlug);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  try {
    const res = await api.get<{ success: boolean; data: CategoryItem }>(`/catalog/categories/${encodeURIComponent(normalizedSlug)}`);
    const data = res.data?.data || null;
    categoryBySlugCache.set(normalizedSlug, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (error) {
    if (cached?.data) return cached.data;
    console.error(`Failed to fetch category by slug: ${slug}`, error);
    return null;
  }
});

export const getActiveThemes = cache(async function getActiveThemes(): Promise<ThemeItem[]> {
  if (themesMemCache && themesMemCache.expires > Date.now()) {
    return themesMemCache.data;
  }
  try {
    const res = await api.get<{ success: boolean; data: ThemeItem[] }>("/catalog/themes");
    if (res.data?.success && Array.isArray(res.data.data)) {
      themesMemCache = { data: res.data.data, expires: Date.now() + CACHE_TTL_MS };
      return res.data.data;
    }
    return themesMemCache?.data || [];
  } catch (error) {
    if (themesMemCache?.data) return themesMemCache.data;
    console.error("Failed to fetch active themes", error);
    return [];
  }
});

export const getThemeBySlug = cache(async function getThemeBySlug(slug: string): Promise<ThemeItem | null> {
  const normalizedSlug = slug.toLowerCase().trim();
  const cached = themeBySlugCache.get(normalizedSlug);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  try {
    const res = await api.get<{ success: boolean; data: ThemeItem }>(`/catalog/themes/${encodeURIComponent(normalizedSlug)}`);
    const data = res.data?.data || null;
    themeBySlugCache.set(normalizedSlug, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (error) {
    if (cached?.data) return cached.data;
    console.error(`Failed to fetch theme by slug: ${slug}`, error);
    return null;
  }
});
