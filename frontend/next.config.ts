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
  "form-action 'self'",
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
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' data: blob:",
    "https://res.cloudinary.com",
    "https://images.unsplash.com",
    "https://www.google-analytics.com",
    "https://www.googletagmanager.com",
    "https://checkout.razorpay.com",
  ].join(" "),
  "font-src 'self' data:",
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
    "https://accounts.google.com",
    "https://challenges.cloudflare.com",
  ]
    .filter(Boolean)
    .join(" "),
  "frame-src https://checkout.razorpay.com https://accounts.google.com https://challenges.cloudflare.com",
  isProduction ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\")",
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  images: {
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
