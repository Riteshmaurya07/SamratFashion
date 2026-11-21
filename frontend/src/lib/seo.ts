export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://samratfashion.netlify.app";

export const SITE_CONFIG = {
  name: "Samrat Fashion",
  brandName: "Samrat Fashion",
  fullBrand: "Samrat Fashion",
  legalName: "Samrat Fashion",
  url: SITE_URL,
  description:
    "Contemporary Indian menswear crafted for festive, formal, and everyday dressing — structured Nehru jackets, coti, and wardrobe essentials with express Pan-India delivery.",
  defaultTitle: "Samrat Fashion | Premium Indian Menswear & Apparel",
  titleTemplate: "%s | Samrat Fashion",
  telephone: "+91-62621-27724",
  email: "support@samratfashion.com",
  geo: {
    region: "IN-MH",
    placename: "Mumbai, Maharashtra, India",
    latitude: 18.922,
    longitude: 72.8347,
    position: "18.9220;72.8347",
    icbm: "18.9220, 72.8347",
    postalCode: "400001",
    country: "IN",
    countryName: "India",
  },
  social: {
    instagram: "https://instagram.com/samratfashion",
    facebook: "https://facebook.com/samratfashion",
    twitter: "https://twitter.com/samratfashion",
  },
};

export const GEO_METADATA_OTHER = {
  "geo.region": SITE_CONFIG.geo.region,
  "geo.placename": SITE_CONFIG.geo.placename,
  "geo.position": SITE_CONFIG.geo.position,
  ICBM: SITE_CONFIG.geo.icbm,
  "target-country": SITE_CONFIG.geo.country,
  "revisit-after": "1 days",
  "rating": "general",
  "distribution": "global",
};

/**
 * Returns Schema.org JSON-LD for Organization & Local/Online Clothing Store.
 * Establishes Google Knowledge Graph entity and Indian geo-location trust.
 */
export function getOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["ClothingStore", "OnlineStore"],
    "@id": `${SITE_URL}/#organization`,
    name: SITE_CONFIG.name,
    alternateName: SITE_CONFIG.fullBrand,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    image: `${SITE_URL}/og-image.jpg`,
    description: SITE_CONFIG.description,
    telephone: SITE_CONFIG.telephone,
    email: SITE_CONFIG.email,
    // Live catalog range is ₹400 (Modi jacket) to ₹500 (Nehru jacket). Update this string if the catalog range changes.
    priceRange: "₹400 - ₹500",
    currenciesAccepted: "INR",
    paymentAccepted: "UPI, Credit Card, Debit Card, Net Banking, Wallets, Razorpay",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Samrat Fashion Distribution Hub",
      addressLocality: "Mumbai",
      addressRegion: "Maharashtra",
      postalCode: SITE_CONFIG.geo.postalCode,
      addressCountry: SITE_CONFIG.geo.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: SITE_CONFIG.geo.latitude,
      longitude: SITE_CONFIG.geo.longitude,
    },
    areaServed: {
      "@type": "Country",
      name: SITE_CONFIG.geo.countryName,
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: SITE_CONFIG.telephone,
      contactType: "customer service",
      areaServed: SITE_CONFIG.geo.country,
      availableLanguage: ["en", "hi"],
    },
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: SITE_CONFIG.geo.country,
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 7,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/FreeReturn",
    },
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingRate: {
        "@type": "MonetaryAmount",
        value: "0",
        currency: "INR",
      },
      shippingDestination: {
        "@type": "DefinedRegion",
        addressCountry: SITE_CONFIG.geo.country,
      },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: {
          "@type": "QuantitativeValue",
          minValue: 1,
          maxValue: 2,
          unitCode: "d",
        },
        transitTime: {
          "@type": "QuantitativeValue",
          minValue: 2,
          maxValue: 5,
          unitCode: "d",
        },
      },
    },
    sameAs: [
      SITE_CONFIG.social.instagram,
      SITE_CONFIG.social.facebook,
      SITE_CONFIG.social.twitter,
    ],
  };
}

/**
 * Returns Schema.org JSON-LD for WebSite with Sitelinks SearchBox for Google Indexing.
 */
export function getWebSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_CONFIG.name,
    alternateName: SITE_CONFIG.brandName,
    description: SITE_CONFIG.description,
    inLanguage: "en-IN",
    publisher: {
      "@id": `${SITE_URL}/#organization`,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/shop?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Returns Schema.org JSON-LD for BreadcrumbList.
 */
export function getBreadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url.startsWith("/") ? "" : "/"}${item.url}`,
    })),
  };
}

export interface ProductJsonLdParams {
  name: string;
  slug: string;
  description?: string;
  images?: string[];
  basePrice: number;
  mrp?: number;
  sku?: string;
  categoryName?: string;
  averageRating?: number;
  reviewCount?: number;
  isAvailable?: boolean;
}

/**
 * Returns Schema.org JSON-LD for Product & Offers to qualify for Google Merchant & Rich Snippets.
 */
export function getProductJsonLd(product: ProductJsonLdParams) {
  const productUrl = `${SITE_URL}/shop/${product.slug}`;
  const cleanDescription = (product.description || product.name)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    name: product.name,
    image: product.images && product.images.length > 0 ? product.images : [`${SITE_URL}/og-image.jpg`],
    description: cleanDescription,
    sku: product.sku || product.slug,
    mpn: product.sku || product.slug,
    brand: {
      "@type": "Brand",
      name: SITE_CONFIG.fullBrand,
    },
    offers: {
      "@type": "Offer",
      "@id": `${productUrl}#offer`,
      url: productUrl,
      priceCurrency: "INR",
      price: product.basePrice,
      priceValidUntil: "2027-12-31",
      itemCondition: "https://schema.org/NewCondition",
      availability:
        product.isAvailable !== false
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      seller: {
        "@type": "Organization",
        name: SITE_CONFIG.name,
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: SITE_CONFIG.geo.country,
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 7,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "0",
          currency: "INR",
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: SITE_CONFIG.geo.country,
        },
      },
    },
  };

  if (product.categoryName) {
    schema.category = product.categoryName;
  }

  if (
    typeof product.averageRating === "number" &&
    product.averageRating > 0 &&
    typeof product.reviewCount === "number" &&
    product.reviewCount > 0
  ) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: product.averageRating,
      reviewCount: product.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return schema;
}

/**
 * Returns Schema.org JSON-LD for CollectionPage.
 */
export function getCollectionPageJsonLd(name: string, description: string, url: string) {
  const fullUrl = url.startsWith("http") ? url : `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: fullUrl,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_CONFIG.name,
      url: SITE_URL,
    },
  };
}

/**
 * Returns Schema.org JSON-LD for FAQPage.
 */
export function getFaqPageJsonLd(faqs: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };
}

/**
 * Returns the standard 5 FAQs for product detail pages (PDP),
 * dynamically incorporating actual variant sizes for the product.
 */
export function getProductFaqs(product?: {
  variants?: Array<{ size?: string }>;
}): Array<{ q: string; a: string }> {
  const sizes = Array.from(
    new Set(
      (product?.variants || [])
        .map((v) => (v?.size || "").trim())
        .filter(Boolean)
    )
  );
  const sizeText = sizes.length > 0 ? ` (sizes ${sizes.join(", ")})` : "";

  return [
    {
      q: "How do I choose the right Nehru jacket size?",
      a: `Measure around the fullest part of your chest over a shirt or kurta and match it with the Size Guide on the product page${sizeText}. If you prefer a relaxed fit for layering, consider sizing up.`,
    },
    {
      q: "What is the return policy?",
      a: "7-day easy returns for unworn, unwashed garments with original tags intact. Submit a return from My Orders; after pickup and quality check the refund is credited within 5–7 business days and you can re-order the right size. For a direct size swap without re-ordering, raise a 'Size Exchange & Returns' support ticket and our team will arrange a manual exchange.",
    },
    {
      q: "How long does delivery take, and is shipping free?",
      a: "Orders are dispatched within 24–48 hours. Free express shipping on orders ₹399 and above; orders below that carry a flat ₹45 shipping fee. Metro delivery takes about 3–5 business days, non-metro 4–7 business days.",
    },
    {
      q: "What payment methods do you accept?",
      a: "100% encrypted prepaid checkout via Razorpay: UPI (Google Pay, PhonePe, Paytm, BHIM), all major Credit & Debit cards (Visa, MasterCard, RuPay), NetBanking, and Wallets. Cash on Delivery is currently unavailable.",
    },
    {
      q: "How do I care for my Nehru jacket?",
      a: "Dry clean recommended to preserve the collar structure and woven texture, or gently hand wash cold with mild detergent. Dry in shade and warm iron on the reverse side.",
    },
  ];
}
