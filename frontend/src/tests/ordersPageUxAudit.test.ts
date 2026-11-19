import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ORDER_STATUS_TONE_CLASSES } from "../lib/orderStatus.ts";

test("ordersPageUx: ORDER_STATUS_TONE_CLASSES includes brand tone", () => {
  assert.ok("brand" in ORDER_STATUS_TONE_CLASSES);
  assert.strictEqual(
    ORDER_STATUS_TONE_CLASSES.brand,
    "bg-brand/10 text-brand border-brand/20"
  );
});

test("ordersPageUx: globals.css contains brand accent color tokens", () => {
  const cssPath = path.resolve(import.meta.dirname, "../app/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  assert.match(cssContent, /--color-brand:\s*#781d28/i);
  assert.match(cssContent, /--color-brand-hover:/i);
});

test("ordersPageUx: OrdersClient source verifies all P0/P1/P2 fixes", () => {
  const ordersClientPath = path.resolve(
    import.meta.dirname,
    "../components/account/OrdersClient.tsx"
  );
  const source = fs.readFileSync(ordersClientPath, "utf-8");

  // P0 Fix 1: Product title must never use truncate
  assert.doesNotMatch(
    source,
    /<h4[^>]*truncate/i,
    "Product title <h4> must not use truncate class"
  );
  assert.match(
    source,
    /font-headline-sm[^>]*leading-snug break-words/,
    "Product title must wrap naturally with leading-snug and break-words"
  );

  // P0 Fix 2: Price breakdown reconciles item price with total paid
  assert.match(source, /Item total:/i, "Price breakdown must show Item total");
  assert.match(source, /Discount/i, "Price breakdown must show Discount row");
  assert.match(source, /Delivery:/i, "Price breakdown must show Delivery row");
  assert.match(source, /Total Paid:/i, "Price breakdown must show Total Paid");

  // P0 Fix 3: Real fulfilment state and Track your order
  assert.match(source, /Packed & ready to ship/i, "Must show real fulfillment state");
  assert.match(
    source,
    /Tracking will appear here once your order ships/i,
    "Must explicitly reassure buyer when tracking is not yet active"
  );
  assert.match(
    source,
    /Track your order/i,
    "Link must be renamed from View Shipment Timeline to Track your order"
  );
  assert.match(
    source,
    /href=\{`\/account\/orders\/\$\{order\._id\}#tracking`\}/,
    "Track your order link must point specifically to #tracking anchor"
  );
  assert.match(
    source,
    /order\.status === "CONFIRMED" \? \(/,
    "Single fulfilment pill for CONFIRMED status avoids redundant duplicate badges"
  );
  assert.doesNotMatch(
    source,
    /View Shipment Timeline/i,
    "Vague 'View Shipment Timeline' copy must be removed"
  );

  // P1 Fix 1: Shopkeeper copy, no system jargon
  assert.doesNotMatch(
    source,
    /courier logistics/i,
    "Must not use 'courier logistics' on customer page"
  );
  assert.doesNotMatch(
    source,
    /inspect technical garment specs/i,
    "Must not use 'inspect technical garment specs' on customer page"
  );
  assert.match(
    source,
    /See where your order is, download your GST invoice, and manage returns/i,
    "Header must use buyer-friendly shopkeeper copy"
  );

  // P1 Fix 2: Repeated Explore Collection button eliminated
  const exploreMatches = source.match(/Explore Collection/gi) || [];
  assert.strictEqual(
    exploreMatches.length,
    1,
    `Explore Collection must only appear once on screen (in empty state card), found ${exploreMatches.length}`
  );

  // P1 Fix 3: System jargon removed
  assert.doesNotMatch(
    source,
    /DEFAULT VIEW/i,
    "Must not show 'DEFAULT VIEW' jargon"
  );
  assert.doesNotMatch(
    source,
    /INFINITE SCROLL MODE/i,
    "Must not show 'INFINITE SCROLL MODE' jargon"
  );
  assert.doesNotMatch(
    source,
    /CAP VIEW/i,
    "Must not show 'CAP VIEW' jargon"
  );

  // P1 Fix 4: Warm empty state with image, reassurance, and support contacts
  assert.match(
    source,
    /Your orders will appear here/i,
    "Empty state must show warm heading 'Your orders will appear here'"
  );
  assert.match(
    source,
    /Orders can take a few minutes to appear after payment/i,
    "Empty state must reassure buyer about order arrival latency"
  );
  assert.match(
    source,
    /SITE_CONFIG\.email/i,
    "Empty state must provide customer support email"
  );
  assert.match(
    source,
    /SITE_CONFIG\.telephone/i,
    "Empty state must provide customer support telephone"
  );

  // P1 Fix 5: Filter row and search gated on store scale (orders > 5)
  assert.match(
    source,
    /orders\.length\s*>\s*5/,
    "Filter row and search bar must be gated on orders.length > 5"
  );

  // P2 Fix 2: Mobile tabs navigation must have whitespace-nowrap and fade hint
  assert.match(
    source,
    /whitespace-nowrap/,
    "Tabs must include whitespace-nowrap to avoid clipping mid-word"
  );
  assert.match(
    source,
    /from-surface to-transparent/i,
    "Tabs container must include scroll fade hint on mobile"
  );
});

test("ordersPageUx: Navbar announcement bar bullet spacing and wrapping", () => {
  const navbarPath = path.resolve(
    import.meta.dirname,
    "../components/ui/Navbar.tsx"
  );
  const navbarSource = fs.readFileSync(navbarPath, "utf-8");

  // Verify bullet is cleanly wrapped in a separate element so it never jams against ₹2+
  assert.doesNotMatch(
    navbarSource,
    /\{formatFreeShippingRule\([^)]+\)\}\s*&bull;/,
    "Free shipping rule must not directly concatenate &bull; inside text node without wrapper"
  );
  assert.match(
    navbarSource,
    /whitespace-nowrap[^>]*>\s*\{formatFreeShippingRule/,
    "Free shipping rule must have whitespace-nowrap wrapper"
  );

  // Verify Offers nav item is a single clean label, not "OFFERS Deals"
  assert.doesNotMatch(
    navbarSource,
    /<span[^>]*>OFFERS<\/span>\s*Deals/i,
    "Navbar must not have OFFERS DEALS dual label"
  );
  assert.match(
    navbarSource,
    /<Link[^>]*href="\/offers"[^>]*>[\s\S]*?Offers[\s\S]*?<\/Link>/,
    "Navbar must have clean single 'Offers' label"
  );
});

test("ordersPageUx: OrderDetailsClient tracking gate and timeline section", () => {
  const orderDetailsPath = path.resolve(
    import.meta.dirname,
    "../components/account/OrderDetailsClient.tsx"
  );
  const source = fs.readFileSync(orderDetailsPath, "utf-8");

  // P0: canShareTracking is widened to all non-cancelled, non-expired placed orders (CONFIRMED onwards)
  assert.match(
    source,
    /canShareTracking\s*=\s*!isCancelledOrExpired\s*&&\s*order\.status\s*!==\s*['"]PENDING['"]/,
    "canShareTracking must be widened to all placed orders from CONFIRMED onwards"
  );

  // P0: tracking section has id="tracking" anchor for deep linking
  assert.match(
    source,
    /<section[^>]*id="tracking"/,
    "OrderDetailsClient must contain tracking section with id='tracking'"
  );

  // P1: details page includes honest pending tracking note before shipment
  assert.match(
    source,
    /Tracking will appear here once your order ships/,
    "OrderDetailsClient must display 'Tracking will appear here once your order ships' when not yet shipped"
  );
});
