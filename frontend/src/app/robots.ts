import { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = SITE_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/shop",
          "/shop/*",
          "/offers",
          "/support",
          "/terms",
          "/privacy",
          "/_next/static/*",
          "/_next/image*",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/account",
          "/account/*",
          "/checkout",
          "/cart",
          "/login",
          "/register",
          "/admin/login",
          "/forgot-password",
          "/reset-password",
          "/order-confirmation/*",
          "/track/*",
          "/my-designs",
          "/custom-designer",
          "/bulk-orders/request",
          "/bulk-orders/quote/*",
          "/custom-printing",
          "/custom-printing/*",
          "/bulk-printing",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: [
          "/",
          "/shop",
          "/shop/*",
          "/offers",
          "/support",
          "/terms",
          "/privacy",
          "/_next/static/*",
          "/_next/image*",
        ],
        disallow: [
          "/admin/",
          "/account/",
          "/checkout/",
          "/cart/",
          "/login",
          "/register",
          "/admin/login",
          "/forgot-password",
          "/reset-password",
          "/order-confirmation/",
          "/track/",
          "/my-designs",
          "/custom-designer",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
