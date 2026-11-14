import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_CONFIG.fullBrand,
    short_name: SITE_CONFIG.name,
    description: SITE_CONFIG.description,
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
