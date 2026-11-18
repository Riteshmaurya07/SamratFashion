export const HIDDEN_STOREFRONT_CATEGORY_SLUGS = new Set([
  "custom-print",
  "custom-printing",
  "bulk-printing",
  "jersey",
  "corporate-jersey",
]);

export interface StorefrontCategoryLike {
  _id: string;
  name: string;
  slug: string;
  status?: "ACTIVE" | "INACTIVE";
  parentCategory?: string | { _id: string; status?: "ACTIVE" | "INACTIVE" } | null;
  productCount?: number;
}

/**
 * Filters active categories for public storefront navigation, pills, and filters:
 * - Excludes internal/deferred custom-print slugs
 * - Excludes empty categories (productCount === 0 with no populated descendants)
 *   so shoppers never click into an empty category like Kurta.
 */
export function filterStorefrontCategories<T extends StorefrontCategoryLike>(categories: T[]): T[] {
  const active = (categories || []).filter((c) => {
    if (c.status && c.status !== "ACTIVE") return false;
    const slug = (c.slug || "").toLowerCase();
    return !HIDDEN_STOREFRONT_CATEGORY_SLUGS.has(slug);
  });

  const childrenByParent = new Map<string, T[]>();
  for (const c of active) {
    const parentRef = c.parentCategory;
    const parentId =
      parentRef && typeof parentRef === "object"
        ? parentRef._id
        : typeof parentRef === "string" && parentRef.trim().length > 0
        ? parentRef
        : null;
    if (parentId) {
      const list = childrenByParent.get(parentId) || [];
      list.push(c);
      childrenByParent.set(parentId, list);
    }
  }

  const hasPopulatedInventory = (cat: T, visited = new Set<string>()): boolean => {
    if (visited.has(cat._id)) return false;
    visited.add(cat._id);
    if (typeof cat.productCount !== "number") return true;
    if (cat.productCount > 0) return true;
    const children = childrenByParent.get(cat._id) || [];
    return children.some((child) => hasPopulatedInventory(child, visited));
  };

  return active.filter((cat) => hasPopulatedInventory(cat));
}
