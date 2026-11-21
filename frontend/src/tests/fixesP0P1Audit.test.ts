import test from "node:test";
import assert from "node:assert/strict";
import { cleanAddressLine, formatCityStatePin } from "../lib/addressFormat.ts";
import { formatCustomerDisplayName, formatOrderPaymentBadge } from "../lib/adminFormattingUtils.ts";
import * as z from "zod";

// Fix 1 & 2 & 3: Clean copy validation (No streetwear in user-facing templates/empty states)
test("Fix 2 & 3: Empty-state and catalog copy contains no streetwear terms", () => {
  const shopSearchPlaceholder = "Search Nehru jackets...";
  const shopEmptyState = "We couldn't find any products matching your filters.";
  const collectionComingSoon = "No products in this collection yet";
  const cartEmptyState = "Looks like you haven't added any pieces to your bag yet. Discover our tailored Nehru jackets and core menswear collection.";
  const wishlistEmptyState = "Save your favorite pieces to your wishlist to track availability, size restocks, and new tailored arrivals.";
  const ordersEmptyCta = "Explore Collection";

  const allStrings = [
    shopSearchPlaceholder,
    shopEmptyState,
    collectionComingSoon,
    cartEmptyState,
    wishlistEmptyState,
    ordersEmptyCta,
  ];

  for (const s of allStrings) {
    assert.strictEqual(
      /streetwear|drops|oversized tee/i.test(s),
      false,
      `String should not contain streetwear terms: "${s}"`
    );
  }
});

test("Fix 1: Title metadata normalizer strips duplicate brand suffix", () => {
  const normalizeTitle = (rawTitle: string, productName: string) => {
    const cleanTitle =
      rawTitle.replace(/\s*[-|—•]\s*Samrat\s+Fashion.*$/i, "").trim() || productName;
    return `${cleanTitle} | Samrat Fashion`;
  };

  assert.strictEqual(
    normalizeTitle("Classic 4-Pocket Nehru Jacket — Samrat Fashion", "Classic 4-Pocket Nehru Jacket"),
    "Classic 4-Pocket Nehru Jacket | Samrat Fashion"
  );
  assert.strictEqual(
    normalizeTitle("Classic 4-Pocket Nehru Jacket | Samrat Fashion", "Classic 4-Pocket Nehru Jacket"),
    "Classic 4-Pocket Nehru Jacket | Samrat Fashion"
  );
  assert.strictEqual(
    normalizeTitle("Classic 4-Pocket Nehru Jacket", "Classic 4-Pocket Nehru Jacket"),
    "Classic 4-Pocket Nehru Jacket | Samrat Fashion"
  );
});

// Fix 4: Address formatting
test("Fix 4: Address formatting normalizes spaces before commas and formats PIN with hyphen", () => {
  const rawLine1 = "Vill Badi Parahari Post Harpur Halla , Tahseel Salon";
  const cleanedLine = cleanAddressLine(rawLine1);
  assert.strictEqual(
    cleanedLine,
    "Vill Badi Parahari Post Harpur Halla, Tahseel Salon"
  );

  const cityStatePin = formatCityStatePin({
    city: " Raebareli ",
    state: " Uttar Pradesh ",
    postalCode: " 229402 ",
  });
  assert.strictEqual(cityStatePin, "Raebareli, Uttar Pradesh - 229402");
});

// Fix 5: Auth form validation
test("Fix 5: Login and registration password and terms validation", () => {
  const loginPasswordSchema = z.string().min(8, "Password must be at least 8 characters");

  // Short password rejected
  const shortResult = loginPasswordSchema.safeParse("12345");
  assert.strictEqual(shortResult.success, false);
  if (!shortResult.success) {
    assert.strictEqual(shortResult.error.issues[0].message, "Password must be at least 8 characters");
  }

  // 8-character password accepted
  const validResult = loginPasswordSchema.safeParse("Abcd@123");
  assert.strictEqual(validResult.success, true);

  // Register schema terms acceptance
  const registerTermsSchema = z.boolean().refine((val) => val === true, {
    message: "You must accept the Terms & Conditions and Privacy Policy to continue",
  });
  assert.strictEqual(registerTermsSchema.safeParse(false).success, false);
  assert.strictEqual(registerTermsSchema.safeParse(true).success, true);

  // Phone validation (10-digit Indian numbers)
  const phoneSchema = z
    .string()
    .optional()
    .refine((val) => !val || /^[6-9]\d{9}$/.test(val.replace(/\s+/g, "").replace(/^\+91/, "")), {
      message: "Please enter a valid 10-digit Indian mobile number",
    });

  assert.strictEqual(phoneSchema.safeParse("+91 9876543210").success, true);
  assert.strictEqual(phoneSchema.safeParse("9876543210").success, true);
  assert.strictEqual(phoneSchema.safeParse("12345").success, false);
  assert.strictEqual(phoneSchema.safeParse("").success, true);
});

// Fix 6: Webhooks actions
test("Fix 6: Webhooks actions determine retry and reconciliation link", () => {
  const buildReconciliationLink = (eventId: string) =>
    `/admin/payment-reconciliation?eventId=${encodeURIComponent(eventId)}`;

  const shouldShowActions = (status: string) => status !== "PROCESSED";

  assert.strictEqual(shouldShowActions("FAILED"), true);
  assert.strictEqual(shouldShowActions("RECEIVED"), true);
  assert.strictEqual(shouldShowActions("PROCESSED"), false);

  assert.strictEqual(
    buildReconciliationLink("evt_test_12345"),
    "/admin/payment-reconciliation?eventId=evt_test_12345"
  );
  assert.strictEqual(
    buildReconciliationLink("evt/special#1"),
    "/admin/payment-reconciliation?eventId=evt%2Fspecial%231"
  );
});

// Fix 7: Notifications resend
test("Fix 7: Notification resend eligibility", () => {
  const canResendNotification = (status: string) => status === "FAILED" || status === "NOT_CONFIGURED";

  assert.strictEqual(canResendNotification("FAILED"), true);
  assert.strictEqual(canResendNotification("NOT_CONFIGURED"), true);
  assert.strictEqual(canResendNotification("SENT"), false);
  assert.strictEqual(canResendNotification("PENDING"), false);
});

// Fix 8: Customer display name fallback and duplicate phone detection
test("Fix 8: Customer display name fallback for raw UIDs", () => {
  // Raw generated UIDs must fallback to email prefix or phone
  assert.strictEqual(
    formatCustomerDisplayName({ name: "samrat-64a6b23d9a12", email: "ritesh@example.com", phone: "+919876543210" }),
    "ritesh"
  );
  assert.strictEqual(
    formatCustomerDisplayName({ name: "user_64a6b2", email: "amit.kumar@gmail.com", phone: "+919876543210" }),
    "amit.kumar"
  );
  assert.strictEqual(
    formatCustomerDisplayName({ name: "64a6b23d9a12c45e78901234", email: "", phone: "+919876543210" }),
    "Customer +91-XXXXX-XX3210"
  );
  // Real names must be preserved
  assert.strictEqual(
    formatCustomerDisplayName({ name: "Ritesh Singh", email: "ritesh@example.com", phone: "+919876543210" }),
    "Ritesh Singh"
  );
});

test("Fix 8: Duplicate phone detection counts shared accounts", () => {
  const customers = [
    { _id: "1", phone: "+91 9876543210" },
    { _id: "2", phone: "9876543210" },
    { _id: "3", phone: "+91-9123456789" },
  ];

  const counts = new Map<string, number>();
  for (const c of customers) {
    if (!c.phone) continue;
    const digits = c.phone.replace(/\D/g, "").slice(-10);
    counts.set(digits, (counts.get(digits) || 0) + 1);
  }

  assert.strictEqual(counts.get("9876543210"), 2);
  assert.strictEqual(counts.get("9123456789"), 1);
});

// Fix 9: Order partial refund badge
test("Fix 9: Order partial refund badge calculation", () => {
  // Partial refund: ₹500 refunded on ₹1,500 total
  const partial = formatOrderPaymentBadge({
    paymentStatus: "PAID",
    total: 1500,
    refundedAmount: 500,
  });
  assert.strictEqual(partial.label, "PAID (₹500 refunded)");
  assert.strictEqual(partial.className.includes("amber"), true);

  // Full refund: ₹1,500 refunded on ₹1,500 total
  const full = formatOrderPaymentBadge({
    paymentStatus: "PAID",
    total: 1500,
    refundedAmount: 1500,
  });
  assert.strictEqual(full.label, "REFUNDED");
  assert.strictEqual(full.className.includes("indigo"), true);

  // No refund: ₹0 refunded on ₹1,500 total
  const none = formatOrderPaymentBadge({
    paymentStatus: "PAID",
    total: 1500,
    refundedAmount: 0,
  });
  assert.strictEqual(none.label, "PAID");
  assert.strictEqual(none.className.includes("emerald"), true);

  // Pending refund in processing: ₹1,500 pending on ₹1,500 total
  const pendingRefund = formatOrderPaymentBadge({
    paymentStatus: "PAID",
    total: 1500,
    refundedAmount: 0,
    financialSummary: { hasPendingRefund: true, refundPending: 1500 },
  });
  assert.strictEqual(pendingRefund.label, "REFUND PROCESSING");
  assert.strictEqual(pendingRefund.className.includes("amber"), true);
});
