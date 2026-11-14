import { test } from "node:test";
import assert from "node:assert";
import {
  SITE_CONFIG,
  GEO_METADATA_OTHER,
  getOrganizationJsonLd,
  getWebSiteJsonLd,
  getBreadcrumbJsonLd,
  getProductJsonLd,
  getCollectionPageJsonLd,
  getFaqPageJsonLd,
} from "../lib/seo.ts";

test("SITE_CONFIG contains valid geo targeting and Indian location properties", () => {
  assert.strictEqual(SITE_CONFIG.geo.country, "IN");
  assert.strictEqual(SITE_CONFIG.geo.region, "IN-MH");
  assert.strictEqual(SITE_CONFIG.geo.postalCode, "400001");
  assert.strictEqual(typeof SITE_CONFIG.geo.latitude, "number");
  assert.strictEqual(typeof SITE_CONFIG.geo.longitude, "number");
  assert.strictEqual(GEO_METADATA_OTHER["geo.region"], "IN-MH");
  assert.strictEqual(GEO_METADATA_OTHER["target-country"], "IN");
});

test("getOrganizationJsonLd produces valid Schema.org Organization & ClothingStore", () => {
  const jsonLd = getOrganizationJsonLd();
  assert.strictEqual(jsonLd["@context"], "https://schema.org");
  assert.deepStrictEqual(jsonLd["@type"], ["ClothingStore", "OnlineStore"]);
  assert.strictEqual(jsonLd.currenciesAccepted, "INR");
  assert.strictEqual(jsonLd.address["@type"], "PostalAddress");
  assert.strictEqual(jsonLd.address.addressCountry, "IN");
  assert.strictEqual(jsonLd.geo["@type"], "GeoCoordinates");
  assert.strictEqual(jsonLd.hasMerchantReturnPolicy["@type"], "MerchantReturnPolicy");
  assert.strictEqual(jsonLd.shippingDetails["@type"], "OfferShippingDetails");
});

test("getWebSiteJsonLd produces Sitelinks SearchBox Schema", () => {
  const webSite = getWebSiteJsonLd();
  assert.strictEqual(webSite["@context"], "https://schema.org");
  assert.strictEqual(webSite["@type"], "WebSite");
  assert.strictEqual(webSite.potentialAction["@type"], "SearchAction");
  assert.ok(webSite.potentialAction.target.urlTemplate.includes("/shop?search="));
});

test("getBreadcrumbJsonLd produces valid BreadcrumbList", () => {
  const breadcrumbs = getBreadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Shop", url: "/shop" },
    { name: "Oversized Tee", url: "/shop/oversized-tee" },
  ]);
  assert.strictEqual(breadcrumbs["@type"], "BreadcrumbList");
  assert.strictEqual(breadcrumbs.itemListElement.length, 3);
  assert.strictEqual(breadcrumbs.itemListElement[0].position, 1);
  assert.strictEqual(breadcrumbs.itemListElement[0].name, "Home");
  assert.strictEqual(breadcrumbs.itemListElement[2].name, "Oversized Tee");
});

test("getProductJsonLd produces valid Product & Offer Schema", () => {
  const productSchema = getProductJsonLd({
    name: "Cyber Neon Oversized Tee",
    slug: "cyber-neon-oversized-tee",
    description: "240 GSM Heavyweight Streetwear Cotton T-Shirt",
    images: ["https://res.cloudinary.com/demo/image/upload/sample.jpg"],
    basePrice: 999,
    mrp: 1499,
    sku: "CYBER-NEON-M",
    categoryName: "Oversized Tees",
    averageRating: 4.8,
    reviewCount: 32,
    isAvailable: true,
  });

  assert.strictEqual(productSchema["@type"], "Product");
  assert.strictEqual(productSchema.name, "Cyber Neon Oversized Tee");
  assert.strictEqual(productSchema.sku, "CYBER-NEON-M");
  const offers = productSchema.offers as Record<string, unknown>;
  assert.strictEqual(offers["@type"], "Offer");
  assert.strictEqual(offers.priceCurrency, "INR");
  assert.strictEqual(offers.price, 999);
  assert.strictEqual(offers.availability, "https://schema.org/InStock");
  const aggRating = productSchema.aggregateRating as Record<string, unknown>;
  assert.strictEqual(aggRating["@type"], "AggregateRating");
  assert.strictEqual(aggRating.ratingValue, 4.8);
  assert.strictEqual(aggRating.reviewCount, 32);
});
test("getCollectionPageJsonLd produces valid CollectionPage Schema", () => {
  const collection = getCollectionPageJsonLd("All Drops", "Browse streetwear drops", "/shop");
  assert.strictEqual(collection["@type"], "CollectionPage");
  assert.strictEqual(collection.name, "All Drops");
  assert.ok(collection.url.includes("/shop"));
});


test("getFaqPageJsonLd produces valid FAQPage Schema", () => {
  const faqs = [
    { q: "How long does shipping take?", a: "24-48 hours across India via Delhivery." },
    { q: "What is your return policy?", a: "7-day doorstep size exchange." },
  ];
  const faqSchema = getFaqPageJsonLd(faqs);
  assert.strictEqual(faqSchema["@type"], "FAQPage");
  assert.strictEqual(faqSchema.mainEntity.length, 2);
  assert.strictEqual(faqSchema.mainEntity[0]["@type"], "Question");
  assert.strictEqual(faqSchema.mainEntity[0].acceptedAnswer["@type"], "Answer");
});
