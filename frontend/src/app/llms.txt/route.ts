import { SITE_URL } from "../../lib/seo.ts";
import { serverFetch } from "../../lib/serverApi.ts";
import { api } from "../../lib/api.ts";

export const revalidate = 3600; // Cache for 1 hour

interface ProductVariant {
  size?: string;
  color?: string;
  hexCode?: string;
  sku?: string;
  stock?: number;
  isAvailable?: boolean;
}

interface CatalogProduct {
  _id?: string;
  name: string;
  slug: string;
  description?: string;
  basePrice: number;
  mrp?: number;
  status?: string;
  isAvailable?: boolean;
  variants?: ProductVariant[];
}

interface CatalogApiResponse {
  success?: boolean;
  data?: {
    items?: CatalogProduct[];
    products?: CatalogProduct[];
  };
}

const FALLBACK_PRODUCTS: CatalogProduct[] = [
  {
    name: "Classic Mandarin Collar Textured Nehru Jacket",
    slug: "classic-mandarin-collar-textured-nehru-jacket",
    description:
      "Elevate your festive and formal wardrobe with the Samrat Fashion Classic Mandarin Collar Nehru Jacket. Crafted from a premium woven suiting fabric with a refined matte texture, this tailored sleeveless waistcoat offers sharp structure and effortless comfort.",
    basePrice: 500,
    mrp: 1000,
    status: "ACTIVE",
    variants: [
      { size: "S", color: "Warm White" },
      { size: "M", color: "Warm White" },
      { size: "L", color: "Warm White" },
      { size: "XL", color: "Warm White" },
      { size: "2XL", color: "Warm White" },
      { size: "S", color: "Midnight Black" },
      { size: "M", color: "Midnight Black" },
      { size: "L", color: "Midnight Black" },
      { size: "XL", color: "Midnight Black" },
      { size: "2XL", color: "Midnight Black" },
      { size: "S", color: "Navy Blue" },
      { size: "M", color: "Navy Blue" },
      { size: "L", color: "Navy Blue" },
      { size: "XL", color: "Navy Blue" },
      { size: "2XL", color: "Navy Blue" },
      { size: "S", color: "Royal Maroon" },
      { size: "M", color: "Royal Maroon" },
      { size: "L", color: "Royal Maroon" },
      { size: "XL", color: "Royal Maroon" },
      { size: "2XL", color: "Royal Maroon" },
    ],
  },
  {
    name: "Classic 4-Pocket Safari Style Modi Jacket",
    slug: "classic-4-pocket-safari-style-modi-jacket",
    description:
      "Tailored 4-pocket Mandarin collar Nehru jacket crafted from a structured, breathable matte-finish fabric. Blends classic Indian heritage with a sharp, modern utility silhouette featuring four functional pleated flap pockets.",
    basePrice: 400,
    status: "ACTIVE",
    variants: [
      { size: "S", color: "Steel Grey" },
      { size: "M", color: "Steel Grey" },
      { size: "L", color: "Steel Grey" },
      { size: "XL", color: "Steel Grey" },
      { size: "S", color: "Camel Tan" },
      { size: "M", color: "Camel Tan" },
      { size: "L", color: "Camel Tan" },
      { size: "XL", color: "Camel Tan" },
      { size: "S", color: "Navy Blue" },
      { size: "M", color: "Navy Blue" },
      { size: "L", color: "Navy Blue" },
      { size: "XL", color: "Navy Blue" },
      { size: "S", color: "Cream" },
      { size: "M", color: "Cream" },
      { size: "L", color: "Cream" },
      { size: "XL", color: "Cream" },
      { size: "S", color: "Coffee Brown" },
      { size: "M", color: "Coffee Brown" },
      { size: "L", color: "Coffee Brown" },
      { size: "XL", color: "Coffee Brown" },
    ],
  },
];

async function getLiveProducts(): Promise<CatalogProduct[]> {
  try {
    const cached = await serverFetch<CatalogApiResponse>("/catalog/products?limit=100", {
      revalidate: 3600,
    });
    const items = cached?.data?.items || cached?.data?.products;
    if (Array.isArray(items) && items.length > 0) {
      return items;
    }
  } catch (error) {
    console.warn("serverFetch failed in llms.txt:", error);
  }

  try {
    const res = await api.get("/catalog/products?limit=100");
    const items = res.data?.data?.items || res.data?.data?.products;
    if (Array.isArray(items) && items.length > 0) {
      return items;
    }
  } catch (error) {
    console.warn("api.get failed in llms.txt:", error);
  }

  return FALLBACK_PRODUCTS;
}

export async function GET() {
  const products = await getLiveProducts();
  const baseUrl = SITE_URL;

  // Filter out internal testing products and inactive items
  const activeProducts = products.filter(
    (p) =>
      Boolean(p.slug) &&
      p.status === "ACTIVE" &&
      p.slug !== "testing-product" &&
      !p.slug.startsWith("test-") &&
      !p.name.toLowerCase().includes("testing")
  );

  const productList = activeProducts.length > 0 ? activeProducts : FALLBACK_PRODUCTS;

  const productSections = productList
    .map((p) => {
      const productUrl = `${baseUrl}/shop/${p.slug}`;
      const priceStr = `₹${p.basePrice.toLocaleString("en-IN")}`;
      const mrpStr =
        typeof p.mrp === "number" && p.mrp > p.basePrice
          ? `₹${p.mrp.toLocaleString("en-IN")}`
          : null;

      const variants = Array.isArray(p.variants) ? p.variants : [];
      const uniqueSizes = Array.from(
        new Set(variants.map((v) => (v.size || "").trim()).filter(Boolean))
      );
      const uniqueColors = Array.from(
        new Set(variants.map((v) => (v.color || "").trim()).filter(Boolean))
      );

      const lines = [
        `### ${p.name}`,
        `- URL: ${productUrl}`,
        `- Price: ${priceStr}`,
      ];

      if (mrpStr) {
        lines.push(`- MRP: ${mrpStr}`);
      }

      if (uniqueSizes.length > 0) {
        lines.push(`- Sizes: ${uniqueSizes.join(", ")}`);
      }

      if (uniqueColors.length > 0) {
        lines.push(`- Colourways: ${uniqueColors.join(", ")}`);
      }

      if (p.description) {
        const cleanDesc = p.description
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleanDesc) {
          lines.push(`- Description: ${cleanDesc}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");

  const body = `# Samrat Fashion

> Contemporary Indian menswear crafted for festive, formal, and everyday dressing — structured Nehru jackets, coti, and wardrobe essentials with express Pan-India delivery.

## Key Information
- Brand: Samrat Fashion
- Category: Contemporary Indian Menswear (Nehru jackets, coti, Modi jackets, tailored ethnic wear)
- Delivery: Pan-India delivery available across all major pincodes
- Payment: Prepaid online only via Razorpay (UPI, Credit/Debit Cards, Net Banking, Wallets). Cash on Delivery (COD) is currently unavailable.
- Shipping: Free express shipping on all orders ₹399 and above
- Returns: 7-day easy returns policy
- Ordering Requirement: Login is required for ordering (no guest checkout)
- Customer Support: support@samratfashion.com | +91-62621-27724

## Key Pages
- Shop: ${baseUrl}/shop
- Offers: ${baseUrl}/offers
- Customer Support: ${baseUrl}/support
- Shipping & Returns: ${baseUrl}/shipping-returns
- Terms of Service: ${baseUrl}/terms
- Privacy Policy: ${baseUrl}/privacy

## Products
${productSections}
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
