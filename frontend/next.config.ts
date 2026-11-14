import type { NextConfig } from "next";

function getApiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (!configured) return "http://localhost:5000";

  try {
    return new URL(configured).origin;
  } catch {
    return "";
  }
}

/**
 * Content-Security-Policy for the integrations this storefront actually uses:
 * Razorpay Checkout, Google Identity Services, Cloudflare Turnstile, Google
 * Analytics, Cloudinary product imagery and the Samrat API.
 *
 * No wildcard script source is permitted. Next.js injects inline bootstrap
 * scripts, and the payment/CAPTCHA vendors inject inline styles, so
 * 'unsafe-inline' is required for those two directives until a nonce-based
 * setup is introduced.
 */
const apiOrigin = getApiOrigin();
const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://api.razorpay.com",
  "manifest-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    isProduction ? "" : "'unsafe-eval'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://checkout.razorpay.com",
    "https://accounts.google.com",
    "https://www.gstatic.com",
    "https://challenges.cloudflare.com",
  ]
    .filter(Boolean)
    .join(" "),
  // Google Fonts serves the Material Symbols stylesheet, whose @font-face
  // points at fonts.gstatic.com. Without both origins the icon font is
  // blocked and the ligature names render as plain text.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  [
    "img-src 'self' data: blob:",
    "https://res.cloudinary.com",
    "https://images.unsplash.com",
    "https://www.google-analytics.com",
    "https://www.googletagmanager.com",
    "https://checkout.razorpay.com",
    "https://cdn.razorpay.com",
    "https://*.rzp.io",
  ].join(" "),
  "font-src 'self' data: https://fonts.gstatic.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  [
    "connect-src 'self'",
    apiOrigin,
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://analytics.google.com",
    "https://www.googletagmanager.com",
    "https://checkout.razorpay.com",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://lumberjack-cx.razorpay.com",
    "https://accounts.google.com",
    "https://challenges.cloudflare.com",
  ]
    .filter(Boolean)
    .join(" "),
  "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com https://accounts.google.com https://challenges.cloudflare.com",
  isProduction ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")",
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  compress: true,
  compiler: {
    removeConsole: isProduction ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/themes",
        destination: "/shop",
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
