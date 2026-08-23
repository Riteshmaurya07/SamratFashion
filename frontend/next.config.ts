import type { NextConfig } from "next";

process.loadEnvFile?.("../.env");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
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
