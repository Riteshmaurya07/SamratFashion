/**
 * Injects automatic format, quality, and width capping into raw Cloudinary image URLs.
 * Prevents Vercel and clients from downloading multi-megabyte unoptimized camera uploads.
 */
export function optimizeCloudinaryUrl(url?: string, width = 600): string {
  if (!url || typeof url !== "string") return url || "";
  if (!url.includes("res.cloudinary.com") || !url.includes("/image/upload/")) {
    return url;
  }
  // If already transformed with f_auto, quality, or width transformations, leave untouched
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
