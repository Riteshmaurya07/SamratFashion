/**
 * Injects automatic format, quality, and width capping into raw Cloudinary and Unsplash image URLs.
 * Prevents Vercel and mobile clients from downloading multi-megabyte unoptimized camera uploads.
 */
export function optimizeCloudinaryUrl(url?: string, width = 600): string {
  if (!url || typeof url !== "string") return url || "";

  // Cloudinary optimization
  if (url.includes("res.cloudinary.com") && url.includes("/image/upload/")) {
    if (
      url.includes("/image/upload/f_auto") ||
      url.includes("/image/upload/c_") ||
      url.includes("/image/upload/w_") ||
      url.includes("/image/upload/q_")
    ) {
      return url;
    }
    return url.replace(
      "/image/upload/",
      `/image/upload/f_auto,q_auto:good,w_${width},c_limit/`
    );
  }

  // Unsplash optimization: cap huge master photos (e.g. w=2070) down to card dimensions
  if (url.includes("images.unsplash.com")) {
    try {
      const u = new URL(url);
      u.searchParams.set("w", String(width));
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "crop");
      u.searchParams.set("q", "75");
      return u.toString();
    } catch {
      return url;
    }
  }

  return url;
}

export const optimizeImageUrl = optimizeCloudinaryUrl;
