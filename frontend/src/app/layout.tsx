import type { Metadata, Viewport } from "next";
import { Inter, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

import { SITE_CONFIG, SITE_URL, GEO_METADATA_OTHER, getOrganizationJsonLd, getWebSiteJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { AsyncStyleLoader } from "@/components/ui/AsyncStyleLoader";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_CONFIG.defaultTitle,
    template: SITE_CONFIG.titleTemplate,
  },
  description: SITE_CONFIG.description,
  applicationName: SITE_CONFIG.name,
  keywords: [
    "oversized t-shirts india",
    "streetwear india",
    "heavyweight graphic tees",
    "240 gsm cotton t-shirt",
    "custom t-shirt printing",
    "bulk t-shirt printing",
    "urban streetwear mumbai",
    "threadvibe",
    "samrat fashion",
    "acid wash tees",
    "drop shoulder t shirts",
  ],
  authors: [{ name: SITE_CONFIG.name, url: SITE_URL }],
  creator: SITE_CONFIG.name,
  publisher: SITE_CONFIG.name,
  category: "clothing",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
    languages: {
      "en-IN": "/",
      "en": "/",
    },
  },
  openGraph: {
    title: SITE_CONFIG.defaultTitle,
    description: SITE_CONFIG.description,
    url: SITE_URL,
    siteName: SITE_CONFIG.name,
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Samrat Fashion - Premium Oversized Streetwear & Custom Prints",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_CONFIG.defaultTitle,
    description: SITE_CONFIG.description,
    creator: "@samratfashion",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  other: GEO_METADATA_OTHER,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#09090b",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable} antialiased min-h-full flex flex-col w-full overflow-x-hidden`}
      >
        <JsonLd id="org-jsonld" data={getOrganizationJsonLd()} />
        <JsonLd id="website-jsonld" data={getWebSiteJsonLd()} />
        <GoogleAnalytics />
        <AsyncStyleLoader />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
