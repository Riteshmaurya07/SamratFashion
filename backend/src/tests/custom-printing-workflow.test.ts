import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { Product, ProductStatus } from "../models/Product";
import { Category, CategoryStatus } from "../models/Category";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { PrintPricingConfig } from "../models/PrintPricingConfig";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { CustomDesign } from "../models/CustomDesign";
import { Order } from "../models/Order";

import { createAdminCatalogItem } from "../controllers/adminCustomPrintCatalogController";
import {
  getCatalogItems,
  getCatalogItemBySlug,
} from "../controllers/customPrintCatalogController";
import {
  createBulkRequest,
  getMyBulkRequestById,
  approveMockup,
  requestMockupRevision,
  acceptQuote,
} from "../controllers/bulkOrderController";
import {
  uploadAdminMockup,
  createAdminQuote,
  updateBulkStatus,
} from "../controllers/adminBulkOrderController";
import { createCustomPrintingRequest } from "../controllers/customDesignController";
import { uploadImage } from "../controllers/uploadController";
import {
  getEffectivePricingRule,
  calculateAuthoritativeBulkPricing,
} from "../services/volumePricingService";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = `  ❌ FAIL: ${name}${details ? ` — ${details}` : ""}`;
    console.error(msg);
    failures.push(`${name}${details ? `: ${details}` : ""}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.data = payload;
      return res;
    },
  };
  return res;
}

async function runTestSuite() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Custom Printing & Bulk Order End-to-End Test Suite         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("Connected to MongoDB for test execution\n");

  const customerId = new mongoose.Types.ObjectId().toString();
  const otherCustomerId = new mongoose.Types.ObjectId().toString();
  const adminId = new mongoose.Types.ObjectId().toString();

  // Test setup references
  let testCategory: any = null;
  let testPlacement1: any = null;
  let testPlacement2: any = null;
  let testProduct: any = null;
  let variantIdM: any = null;
  let variantIdL: any = null;
  let testCatalogItem: any = null;

  try {
    // ─── 0. SETUP BASE FIXTURES ─────────────────────────────────────
    testCategory = await Category.create({
      name: `Streetwear Blanks ${Date.now()}`,
      slug: `streetwear-blanks-${Date.now()}`,
      status: CategoryStatus.ACTIVE,
    });

    testPlacement1 = await PrintPlacementTemplate.create({
      name: "Front Chest Print",
      code: `CHEST_${Date.now()}`,
      side: "FRONT",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample_chest.png",
      previewConfig: { x: 35, y: 30, width: 30, height: 25 },
      isActive: true,
      sortOrder: 1,
    });

    testPlacement2 = await PrintPlacementTemplate.create({
      name: "Full Back Graphic",
      code: `BACK_${Date.now()}`,
      side: "BACK",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample_back.png",
      previewConfig: { x: 25, y: 25, width: 50, height: 45 },
      isActive: true,
      sortOrder: 2,
    });

    variantIdM = new mongoose.Types.ObjectId();
    variantIdL = new mongoose.Types.ObjectId();

    testProduct = await Product.create({
      name: "Heavyweight Boxy Cotton Tee",
      slug: `heavyweight-boxy-cotton-tee-${Date.now()}`,
      description: "240 GSM combed cotton blank",
      categoryId: testCategory._id,
      basePrice: 899, // Rupees
      mrp: 1499,
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
      variants: [
        {
          _id: variantIdM,
          size: "M",
          color: "Pitch Black",
          sku: `HBC-BLK-M-${Date.now()}`,
          stock: 100,
          isAvailable: true,
          additionalPrice: 0,
        },
        {
          _id: variantIdL,
          size: "L",
          color: "Pitch Black",
          sku: `HBC-BLK-L-${Date.now()}`,
          stock: 80,
          isAvailable: true,
          additionalPrice: 0,
        },
      ],
    });

    // ─── 1. ADMIN CATALOG CREATION & VALIDATION ──────────────────────
    console.log("[1. Admin Custom Print Catalog Management]");

    // Test 1.1: Rejects catalog item referencing non-existent or inactive placement
    {
      const req: unknown = {
        body: {
          name: "Invalid Placement Tee",
          slug: `invalid-placement-${Date.now()}`,
          productId: testProduct._id.toString(),
          placementTemplateId: new mongoose.Types.ObjectId().toString(),
          mockupImageUrl: "https://res.cloudinary.com/demo/image/upload/mockup.png",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createAdminCatalogItem(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "ADM-CAT-1 Rejects catalog item with non-existent placement template");
    }

    // Test 1.2: Rejects catalog item referencing non-customizable product
    {
      const nonCustomProd = await Product.create({
        name: "Non Customizable Hoodie",
        slug: `non-custom-hoodie-${Date.now()}`,
        description: "Standard hoodie",
        categoryId: testCategory._id,
        basePrice: 1999,
        status: ProductStatus.ACTIVE,
        isCustomizable: false,
        variants: [{ sku: `NCH-${Date.now()}`, size: "L", color: "Grey", stock: 10, isAvailable: true, additionalPrice: 0 }],
      });

      const req: unknown = {
        body: {
          name: "Hoodie Print",
          slug: `hoodie-print-${Date.now()}`,
          productId: nonCustomProd._id.toString(),
          placementTemplateId: testPlacement1._id.toString(),
          mockupImageUrl: "https://res.cloudinary.com/demo/image/upload/mockup.png",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createAdminCatalogItem(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "ADM-CAT-2 Rejects catalog item with non-customizable product");
      await Product.deleteOne({ _id: nonCustomProd._id });
    }

    // Test 1.3: Successfully creates catalog item with multi-placement support
    {
      const req: unknown = {
        body: {
          name: "Boxy Tee DTF Run",
          slug: `boxy-tee-dtf-run-${Date.now()}`,
          description: "Premium chest & back DTF print on heavyweight blank",
          productId: testProduct._id.toString(),
          placementTemplateIds: [testPlacement1._id.toString(), testPlacement2._id.toString()],
          categoryId: testCategory._id.toString(),
          mockupImageUrl: "https://res.cloudinary.com/demo/image/upload/boxy_tee_mockup.png",
          displayPrice: 899,
          minOrderQuantity: 15, // Custom MOQ for this blank
          isActive: true,
          sortOrder: 1,
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createAdminCatalogItem(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "ADM-CAT-3 Admin creates catalog item with multiple permitted placements");
      check(res.statusCode === 201, "ADM-CAT-4 Returns HTTP 201 Created");

      const responseData = res.data as { success: boolean; data: any };
      testCatalogItem = responseData?.data;
      check(Boolean(testCatalogItem?._id), "ADM-CAT-5 Catalog item ID generated in MongoDB");
      check(testCatalogItem?.placementTemplateIds?.length === 2, "ADM-CAT-6 Persists 2 placement templates");
      check(testCatalogItem?.minOrderQuantity === 15, "ADM-CAT-7 Persists configured MOQ of 15");
    }

    // ─── 2. STOREFRONT CATALOG ENDPOINTS ─────────────────────────────
    console.log("\n[2. Storefront Custom Print Catalog Loading & Category Filtering]");

    // Test 2.1: Public catalog returns real configured items without synthetic items
    {
      const req: unknown = { query: {} };
      const res = createMockRes();
      let caughtError: unknown = null;
      await getCatalogItems(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "STORE-CAT-1 getCatalogItems succeeds");
      const responseData = res.data as { success: boolean; data: any[] };
      const foundItem = responseData?.data?.find((i) => i._id.toString() === testCatalogItem._id.toString());
      check(Boolean(foundItem), "STORE-CAT-2 Real configured catalog item appears in public catalog");
      check(foundItem?.placementTemplateId?.code === testPlacement1.code, "STORE-CAT-3 Placement template populated with real data");
      check(!foundItem?._id?.startsWith?.("placement-chest"), "STORE-CAT-4 No synthetic fake placement IDs");
    }

    // Test 2.2: Category filtering returns matching items
    {
      const req: unknown = { query: { category: testCategory.slug } };
      const res = createMockRes();
      let caughtError: unknown = null;
      await getCatalogItems(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "STORE-CAT-5 Filter by category slug succeeds");
      const responseData = res.data as { success: boolean; data: any[] };
      check(responseData?.data?.length >= 1, "STORE-CAT-6 Returns items in matching category");
    }

    // Test 2.3: Detail endpoint by slug attaches authoritative pricing rule and MOQ
    {
      const req: unknown = { params: { slug: testCatalogItem.slug } };
      const res = createMockRes();
      let caughtError: unknown = null;
      await getCatalogItemBySlug(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "STORE-CAT-7 getCatalogItemBySlug succeeds");
      const responseData = res.data as { success: boolean; data: any };
      check(responseData?.data?.effectiveMOQ === 15, "STORE-CAT-8 Effective MOQ of 15 returned to storefront");
      check(Boolean(responseData?.data?.pricingRule), "STORE-CAT-9 Authoritative pricingRule attached");
    }

    // ─── 3. DYNAMIC MOQ & VOLUME PRICING PRECEDENCE ──────────────────
    console.log("\n[3. Dynamic MOQ & Volume Pricing Precedence]");

    // Test 3.1: Global rule precedence
    await PrintPricingConfig.create({
      scope: "GLOBAL",
      minOrderQuantity: 12,
      tiers: [
        { minQuantity: 12, maxQuantity: 24, discountPercentage: 8 },
        { minQuantity: 25, discountPercentage: 18 },
      ],
      printLocationFee: 180,
      setupFee: 0,
      isActive: true,
    });

    // Test 3.2: Category rule overrides global rule
    await PrintPricingConfig.create({
      scope: "CATEGORY",
      categoryId: testCategory._id,
      minOrderQuantity: 20,
      tiers: [
        { minQuantity: 20, maxQuantity: 49, discountPercentage: 12 },
        { minQuantity: 50, discountPercentage: 25 },
      ],
      printLocationFee: 150,
      setupFee: 500,
      isActive: true,
    });

    const effRuleCategory = await getEffectivePricingRule(testProduct._id);
    check(effRuleCategory.source === "CATEGORY", "PRICING-1 Category rule takes precedence over Global rule");
    check(effRuleCategory.minOrderQuantity === 20, "PRICING-2 Category MOQ of 20 units enforced");

    // Test 3.3: Product rule overrides category rule
    await PrintPricingConfig.create({
      scope: "PRODUCT",
      productId: testProduct._id,
      minOrderQuantity: 25,
      tiers: [
        { minQuantity: 25, maxQuantity: 49, discountPercentage: 15 },
        { minQuantity: 50, discountPercentage: 30 },
      ],
      printLocationFee: 120,
      setupFee: 300,
      isActive: true,
    });

    const effRuleProduct = await getEffectivePricingRule(testProduct._id);
    check(effRuleProduct.source === "PRODUCT", "PRICING-3 Product rule takes precedence over Category rule");
    check(effRuleProduct.minOrderQuantity === 25, "PRICING-4 Product rule MOQ of 25 units enforced");

    // Test 3.4: Authoritative price calculation with strict currency conversion (Rupees & Paise)
    // Product basePrice: ₹899. Order 50 units -> 30% discount.
    // Unit price after discount = 899 - 269.7 = 629.3 -> ₹629.30
    // Product total = 899 * 50 = ₹44,950. Discount = 30% = ₹13,485. Net product = ₹31,465.
    // 2 print locations: 120 * 2 * 50 = ₹12,000. Setup fee = ₹300.
    // Subtotal = 31,465 + 12,000 + 300 = ₹43,765.
    // Tax (18% GST) = 43,765 * 0.18 = ₹7,877.70 -> ₹7,878.
    // Total = 43,765 + 7,878 + 0 = ₹51,643.
    const calcResult = await calculateAuthoritativeBulkPricing({
      productId: testProduct._id,
      totalQuantity: 50,
      printLocationsCount: 2,
    });

    check(calcResult.discountPercentage === 30, "PRICING-5 Matched 50+ unit tier discount of 30%");
    check(calcResult.totalProductPriceRupees === 44950, "PRICING-6 Gross product total is ₹44,950");
    check(calcResult.totalDiscountRupees === 13485, "PRICING-7 Volume discount is ₹13,485");
    check(calcResult.totalPrintingFeeRupees === 12000, "PRICING-8 Printing fee for 2 locations is ₹12,000");
    check(calcResult.subtotalRupees === 43765, "PRICING-9 Subtotal is ₹43,765");
    check(calcResult.subtotalPaise === 4376500, "PRICING-10 Subtotal in paise is 4,376,500");
    check(calcResult.totalRupees === 51643, "PRICING-11 Total quotation is ₹51,643");
    check(calcResult.totalPaise === 5164300, "PRICING-12 Total in paise is 5,164,300");

    // ─── 4. BULK INQUIRY SUBMISSION & DATA PERSISTENCE ───────────────
    console.log("\n[4. Bulk Order Inquiry Submission & Asset Persistence]");

    // Test 4.1: Rejects submission below effective MOQ (product MOQ is 25)
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          organizationName: "Alpha Gaming",
          contactName: "Aman Gupta",
          email: "aman@alphagaming.com",
          phone: "+919876500000",
          productId: testProduct._id.toString(),
          variantAllocations: [
            { variantId: variantIdM.toString(), size: "M", quantity: 10 },
            { variantId: variantIdL.toString(), size: "L", quantity: 10 },
          ], // Total 20 units < MOQ 25
          deliveryLocation: "Indiranagar, Bengaluru",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "INQ-1 Server rejects inquiry with quantity 20 below effective MOQ 25");
    }

    // Test 4.2: Rejects fabricated or invalid variant ID
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          organizationName: "Alpha Gaming",
          contactName: "Aman Gupta",
          email: "aman@alphagaming.com",
          phone: "+919876500000",
          productId: testProduct._id.toString(),
          variantAllocations: [
            { variantId: new mongoose.Types.ObjectId().toString(), size: "XXXL", quantity: 25 },
          ],
          deliveryLocation: "Indiranagar, Bengaluru",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "INQ-2 Server rejects fabricated variant ID not belonging to product");
    }

    // Test 4.3: Successfully persists complete inquiry with structured artwork and placements
    let bulkRequestId = "";
    let quoteNumber = "";
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          organizationName: "Alpha Gaming Esports",
          contactName: "Aman Gupta",
          email: "aman@alphagaming.com",
          phone: "+919876500000",
          productId: testProduct._id.toString(),
          catalogItemId: testCatalogItem._id.toString(),
          variantAllocations: [
            { variantId: variantIdM.toString(), size: "M", color: "Pitch Black", quantity: 15 },
            { variantId: variantIdL.toString(), size: "L", color: "Pitch Black", quantity: 15 },
          ], // Total 30 units >= MOQ 25
          colorAllocation: "Pitch Black",
          customPrintingRequired: true,
          selectedPlacementIds: [testPlacement1._id.toString(), testPlacement2._id.toString()],
          printLocations: ["FRONT", "BACK"],
          printMethod: "DTF Transfer",
          artworkFiles: [
            {
              url: "https://res.cloudinary.com/demo/image/upload/team_logo.png",
              publicId: "team_logo_123",
              originalFilename: "alpha_logo_vector.png",
              fileType: "image/png",
              sizeBytes: 1048576,
            },
          ],
          needsDesignAssistance: false,
          printText: "ALPHA ESPORTS 2026",
          preferredColors: ["White", "Neon Green"],
          deliveryLocation: "100 Feet Road, Indiranagar",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560038",
          requiredByDate: new Date(Date.now() + 86400000 * 20).toISOString(),
          customerNote: "High density finish requested.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "INQ-3 Inquiry submitted successfully meeting MOQ");
      check(res.statusCode === 201, "INQ-4 Returns HTTP 201 Created");

      const responseData = res.data as { success: boolean; data: any };
      const savedInquiry = responseData?.data;
      bulkRequestId = savedInquiry?._id?.toString() || "";
      quoteNumber = savedInquiry?.quoteNumber || "";

      check(savedInquiry?.totalQuantity === 30, "INQ-5 Total quantity accurately calculated as 30");
      check(savedInquiry?.artworkFiles?.length === 1, "INQ-6 Structured artwork file persisted in MongoDB");
      check(savedInquiry?.artworkFiles?.[0]?.publicId === "team_logo_123", "INQ-7 Asset publicId preserved");
      check(savedInquiry?.printText === "ALPHA ESPORTS 2026", "INQ-8 Print text preserved");
      check(savedInquiry?.selectedPlacementIds?.length === 2, "INQ-9 Selected placement template IDs preserved");
      check(savedInquiry?.status === BulkRequestStatus.REQUESTED, "INQ-10 Initial status is REQUESTED");
    }

    // Test 4.4: Slogan alone is persisted when no artwork is uploaded
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          contactName: "Vikram Malhotra",
          email: "vikram@example.com",
          phone: "+919876543210",
          productId: testProduct._id.toString(),
          variantAllocations: [
            { variantId: variantIdM.toString(), size: "M", quantity: 25 },
          ],
          customPrintingRequired: true,
          printText: "FUTURE ARCHITECTURE CLUB",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "INQ-11 Slogan text alone (without artwork file) is accepted");
      const responseData = res.data as { success: boolean; data: any };
      check(responseData?.data?.printText === "FUTURE ARCHITECTURE CLUB", "INQ-12 Slogan text persisted");
      check(responseData?.data?.organizationName === "Individual", "INQ-13 Missing company name defaults to Individual");
      if (responseData?.data?._id) await BulkOrderRequest.deleteOne({ _id: responseData.data._id });
    }

    // Test 4.5: Artwork alone is persisted when no slogan text is provided
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          contactName: "Vikram Malhotra",
          email: "vikram@example.com",
          phone: "+919876543210",
          productId: testProduct._id.toString(),
          variantAllocations: [
            { variantId: variantIdM.toString(), size: "M", quantity: 25 },
          ],
          customPrintingRequired: true,
          artworkFiles: [
            {
              url: "https://res.cloudinary.com/demo/image/upload/solo_logo.png",
              originalFilename: "solo_logo.png",
            },
          ],
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "INQ-14 Artwork file alone (without slogan) is accepted");
      const responseData = res.data as { success: boolean; data: any };
      check(responseData?.data?.artworkFiles?.length === 1, "INQ-15 Artwork file reference persisted");
      if (responseData?.data?._id) await BulkOrderRequest.deleteOne({ _id: responseData.data._id });
    }

    // Test 4.6: Guest inquiry submission (public unauthenticated visitor)
    let guestInquiryId = "";
    {
      const req: unknown = {
        // Unauthenticated visitor (no user property)
        body: {
          contactName: "Pooja Sharma",
          email: "pooja.sharma@example.com",
          phone: "+919876511111",
          organizationName: "Pooja Studio",
          productId: testProduct._id.toString(),
          catalogItemId: testCatalogItem._id.toString(),
          variantAllocations: [
            { variantId: variantIdM.toString(), size: "M", quantity: 25 },
          ],
          customPrintingRequired: true,
          printText: "SUMMER RUN 2026",
          customerNote: "Please quote with express delivery.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "INQ-16 Public guest visitor submits inquiry without login");
      check(res.statusCode === 201, "INQ-17 Guest inquiry returns 201 Created");
      const responseData = res.data as { success: boolean; data: any };
      check(Boolean(responseData?.data?.quoteNumber), "INQ-18 Guest inquiry generates unique quoteNumber reference");
      guestInquiryId = responseData?.data?._id?.toString() || "";
    }

    // Test 4.7: Database persistence reload — Verify all fields survived MongoDB storage
    {
      const reloadedDoc = await BulkOrderRequest.findById(bulkRequestId);
      check(Boolean(reloadedDoc), "INQ-19 Inquiry document reloaded from MongoDB");
      check(reloadedDoc?.contactName === "Aman Gupta", "INQ-20 Contact name survived persistence");
      check(reloadedDoc?.email === "aman@alphagaming.com", "INQ-21 Email survived persistence");
      check(reloadedDoc?.phone === "+919876500000", "INQ-22 Phone number survived persistence");
      check(reloadedDoc?.organizationName === "Alpha Gaming Esports", "INQ-23 Organization name survived persistence");
      check(reloadedDoc?.totalQuantity === 30, "INQ-24 Total quantity survived persistence");
      check(reloadedDoc?.printText === "ALPHA ESPORTS 2026", "INQ-25 Slogan text survived persistence");
      check(reloadedDoc?.customerNote === "High density finish requested.", "INQ-26 Additional instructions survived persistence");
      check(reloadedDoc?.artworkFiles?.[0]?.url === "https://res.cloudinary.com/demo/image/upload/team_logo.png", "INQ-27 Artwork URL survived persistence");
      check(reloadedDoc?.variantAllocations?.length === 2, "INQ-28 Variant allocations survived persistence");
    }

    // Test 4.8: Multi-product MOQ differentiation — Different products enforce different MOQs
    {
      // Product A: MOQ = 10
      const catA = await Category.create({
        name: `Category A ${Date.now()}`,
        slug: `cat-a-${Date.now()}`,
        status: CategoryStatus.ACTIVE,
      });
      const prodA = await Product.create({
        name: "MOQ 10 Test Garment",
        slug: `moq-10-prod-${Date.now()}`,
        description: "Blank A",
        categoryId: catA._id,
        basePrice: 500,
        status: ProductStatus.ACTIVE,
        isCustomizable: true,
        variants: [{ sku: `MA-M-${Date.now()}`, size: "M", stock: 100, isAvailable: true, additionalPrice: 0 }],
      });
      const catItemA = await CustomPrintCatalogItem.create({
        name: "MOQ 10 Item",
        slug: `moq-10-item-${Date.now()}`,
        productId: prodA._id,
        placementTemplateId: testPlacement1._id,
        placementTemplateIds: [testPlacement1._id],
        mockupImageUrl: "https://example.com/mock.png",
        minOrderQuantity: 10,
        isActive: true,
      });

      // Product B: MOQ = 50
      const prodB = await Product.create({
        name: "MOQ 50 Test Garment",
        slug: `moq-50-prod-${Date.now()}`,
        description: "Blank B",
        categoryId: testCategory._id,
        basePrice: 600,
        status: ProductStatus.ACTIVE,
        isCustomizable: true,
        variants: [{ sku: `MB-M-${Date.now()}`, size: "M", stock: 100, isAvailable: true, additionalPrice: 0 }],
      });
      const catItemB = await CustomPrintCatalogItem.create({
        name: "MOQ 50 Item",
        slug: `moq-50-item-${Date.now()}`,
        productId: prodB._id,
        placementTemplateId: testPlacement1._id,
        placementTemplateIds: [testPlacement1._id],
        mockupImageUrl: "https://example.com/mock.png",
        minOrderQuantity: 50,
        isActive: true,
      });

      // Test with quantity 15:
      // For Product A (MOQ 10), quantity 15 must be ACCEPTED
      {
        const reqA: unknown = {
          body: {
            contactName: "Test User",
            email: "test@example.com",
            phone: "+919876543210",
            productId: prodA._id.toString(),
            catalogItemId: catItemA._id.toString(),
            variantAllocations: [{ size: "M", quantity: 15 }],
          },
        };
        const resA = createMockRes();
        let errA: unknown = null;
        await createBulkRequest(reqA as never, resA as never, (err: unknown) => { errA = err; });
        check(!errA, "DIFF-MOQ-1 Product A (MOQ 10) accepts quantity 15");
        if ((resA.data as any)?.data?._id) await BulkOrderRequest.deleteOne({ _id: (resA.data as any).data._id });
      }

      // For Product B (MOQ 50), quantity 15 must be REJECTED
      {
        const reqB: unknown = {
          body: {
            contactName: "Test User",
            email: "test@example.com",
            phone: "+919876543210",
            productId: prodB._id.toString(),
            catalogItemId: catItemB._id.toString(),
            variantAllocations: [{ size: "M", quantity: 15 }],
          },
        };
        const resB = createMockRes();
        let errB: unknown = null;
        await createBulkRequest(reqB as never, resB as never, (err: unknown) => { errB = err; });
        check(Boolean(errB), "DIFF-MOQ-2 Product B (MOQ 50) rejects quantity 15");
      }

      // For Product B (MOQ 50), quantity 50 must be ACCEPTED
      {
        const reqB50: unknown = {
          body: {
            contactName: "Test User",
            email: "test@example.com",
            phone: "+919876543210",
            productId: prodB._id.toString(),
            catalogItemId: catItemB._id.toString(),
            variantAllocations: [{ size: "M", quantity: 50 }],
          },
        };
        const resB50 = createMockRes();
        let errB50: unknown = null;
        await createBulkRequest(reqB50 as never, resB50 as never, (err: unknown) => { errB50 = err; });
        check(!errB50, "DIFF-MOQ-3 Product B (MOQ 50) accepts quantity 50");
        if ((resB50.data as any)?.data?._id) await BulkOrderRequest.deleteOne({ _id: (resB50.data as any).data._id });
      }

      // Cleanup temporary products
      await Category.deleteOne({ _id: catA._id });
      await Product.deleteMany({ _id: { $in: [prodA._id, prodB._id] } });
      await CustomPrintCatalogItem.deleteMany({ _id: { $in: [catItemA._id, catItemB._id] } });
      if (guestInquiryId) await BulkOrderRequest.deleteOne({ _id: guestInquiryId });
    }

    // ─── 5. MOCKUP PROOF & REVISION LIFECYCLE ─────────────────────────
    console.log("\n[5. Mockup Sharing, Revisions & Customer Approval Lifecycle]");

    // Test 5.1: Staff uploads and shares mockup v1 -> Status becomes MOCKUP_SHARED
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: bulkRequestId },
        body: {
          mockupUrl: "https://res.cloudinary.com/demo/image/upload/boxy_tee_proof_v1.png",
          notes: "Digital proof generated with neon green ink color match.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await uploadAdminMockup(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "MOCK-1 Staff shares mockup v1");
      check(res.statusCode === 200, "MOCK-2 Returns 200 OK");

      const updated = await BulkOrderRequest.findById(bulkRequestId);
      check(updated?.status === BulkRequestStatus.MOCKUP_SHARED, "MOCK-3 Status transitions to MOCKUP_SHARED");
      check(updated?.mockupHistory?.length === 1, "MOCK-4 Proof version 1 recorded in mockupHistory");
      check(updated?.currentMockupUrl === "https://res.cloudinary.com/demo/image/upload/boxy_tee_proof_v1.png", "MOCK-5 currentMockupUrl updated");
    }

    // Test 5.2: Privacy check — Another customer cannot view or modify the request
    {
      const req: unknown = {
        user: { id: otherCustomerId, role: "CUSTOMER" },
        params: { id: bulkRequestId },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await getMyBulkRequestById(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "SEC-1 Unauthorized customer receives 404/403 for another customer's request");
    }

    // Test 5.3: Customer requests revision -> Status becomes REVISION_REQUESTED
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        params: { id: bulkRequestId },
        body: {
          comment: "Please enlarge the chest logo by 15% and center it 2 inches lower.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await requestMockupRevision(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "MOCK-6 Customer requests revision with comment");
      check(res.statusCode === 200, "MOCK-7 Revision request returns 200 OK");

      const updated = await BulkOrderRequest.findById(bulkRequestId);
      check(updated?.status === BulkRequestStatus.REVISION_REQUESTED, "MOCK-8 Status transitions to REVISION_REQUESTED");
      check(updated?.approvalDecision?.decision === "REVISION_REQUESTED", "MOCK-9 Approval decision records revision request");
      check(Boolean(updated?.approvalDecision?.comment), "MOCK-10 Revision comment recorded");
    }

    // Test 5.4: Staff shares updated mockup v2 -> Status returns to MOCKUP_SHARED
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: bulkRequestId },
        body: {
          mockupUrl: "https://res.cloudinary.com/demo/image/upload/boxy_tee_proof_v2.png",
          notes: "Logo scaled 15% larger and shifted 2 inches down as requested.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await uploadAdminMockup(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "MOCK-11 Staff uploads revised mockup proof v2");

      const updated = await BulkOrderRequest.findById(bulkRequestId);
      check(updated?.status === BulkRequestStatus.MOCKUP_SHARED, "MOCK-12 Status transitions back to MOCKUP_SHARED");
      check(updated?.mockupHistory?.length === 2, "MOCK-13 Version 2 appended to history without overwriting v1");
    }

    // Test 5.5: Customer approves mockup proof -> Status becomes DESIGN_APPROVED
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        params: { id: bulkRequestId },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await approveMockup(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "MOCK-14 Customer approves mockup proof");
      check(res.statusCode === 200, "MOCK-15 Approval returns 200 OK");

      const updated = await BulkOrderRequest.findById(bulkRequestId);
      check(updated?.status === BulkRequestStatus.DESIGN_APPROVED, "MOCK-16 Status transitions to DESIGN_APPROVED");
      check(updated?.approvalDecision?.decision === "APPROVED", "MOCK-17 Approval decision recorded as APPROVED");
    }

    // Test 5.6: Admin updates status (e.g. CONTACTED, CONFIRMED, CLOSED)
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: bulkRequestId },
        body: { status: BulkRequestStatus.CONTACTED },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await updateBulkStatus(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "STATUS-1 Admin updates status to CONTACTED");
      const updated = await BulkOrderRequest.findById(bulkRequestId);
      check(updated?.status === BulkRequestStatus.CONTACTED, "STATUS-2 Status persisted as CONTACTED");

      // Restore to DESIGN_APPROVED for quotation issuance step
      await BulkOrderRequest.findByIdAndUpdate(bulkRequestId, { status: BulkRequestStatus.DESIGN_APPROVED });
    }

    // Test 5.7: Admin rejects invalid status transition/update
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: bulkRequestId },
        body: { status: "INVALID_STATUS_XYZ" },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await updateBulkStatus(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "STATUS-3 Rejects invalid status string with 400");
    }

    // Test 5.8: Upload authorization and restrictions
    {
      // Non-admin attempting to upload 'product' category asset is rejected with 403
      const reqCust: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: { category: "product" },
        file: {
          mimetype: "image/png",
          buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00]),
        },
      };
      const resCust = createMockRes();
      await uploadImage(reqCust as never, resCust as never);
      check(resCust.statusCode === 403, "UPLOAD-1 Customer blocked from uploading catalog assets with 403 Forbidden");

      // Guest uploading custom artwork with invalid/non-image buffer rejected
      const reqBadFile: unknown = {
        body: { category: "custom-artwork" },
        file: {
          mimetype: "text/plain",
          buffer: Buffer.from("plain text not image"),
        },
      };
      const resBad = createMockRes();
      await uploadImage(reqBadFile as never, resBad as never);
      check(resBad.statusCode === 400 || resBad.statusCode === 500, "UPLOAD-2 Invalid file MIME/kind rejected");
    }

    // ─── 6. FORMAL QUOTE ISSUANCE & ACCEPTANCE ───────────────────────
    console.log("\n[6. Formal B2B Quotation Issuance & Order Conversion]");

    // Test 6.1: Admin issues formal quotation based on approved design
    let quoteId = "";
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: bulkRequestId },
        body: {
          productPrice: 26970, // 30 units * 899
          printingFee: 7200,   // 30 units * 2 loc * 120
          setupFee: 300,
          discount: 4045,     // 15% volume discount
          shipping: 0,
          validUntilDays: 14,
          notes: "Locked terms for Alpha Gaming Esports summer drop.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createAdminQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "QUOTE-1 Admin issues formal quotation");
      check(res.statusCode === 200, "QUOTE-2 Returns 200 OK");

      const quote = await BulkQuote.findOne({ quoteNumber });
      quoteId = quote?._id?.toString() || "";
      check(Boolean(quote), "QUOTE-3 BulkQuote record exists");
      check(quote?.status === BulkQuoteStatus.SENT, "QUOTE-4 Quote status marked as SENT");
      check(quote?.subtotal === 3042500, "QUOTE-5 Subtotal stored in paise (₹30,425 = 3,042,500 paise)");
      check(quote?.total === 3590150, "QUOTE-6 Total with 18% GST stored in paise (3,590,150 paise)");

      const updatedReq = await BulkOrderRequest.findById(bulkRequestId);
      check(updatedReq?.status === BulkRequestStatus.QUOTED, "QUOTE-7 Bulk request status transitions to QUOTED");
    }

    // Test 6.2: Expired quote cannot be accepted
    {
      const expiredQuote = await BulkQuote.create({
        quoteNumber: `QT_EXP_${Date.now()}`,
        bulkRequestId: new mongoose.Types.ObjectId(bulkRequestId),
        userId: new mongoose.Types.ObjectId(customerId),
        productPrice: 1000000,
        subtotal: 1000000,
        tax: 180000,
        total: 1180000,
        validUntil: new Date(Date.now() - 86400000), // Expired yesterday
        status: BulkQuoteStatus.SENT,
      });

      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        params: { quoteId: expiredQuote._id.toString() },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await acceptQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "ACCEPT-1 Rejects acceptance of expired quotation");
      await BulkQuote.deleteOne({ _id: expiredQuote._id });
    }

    // Test 6.3: Customer accepts formal quotation -> Creates Order with individual variant lines
    let convertedOrderId = "";
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        params: { quoteId },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await acceptQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "ACCEPT-2 Customer accepts active quote");
      check(res.statusCode === 200, "ACCEPT-3 Quote acceptance returns 200 OK");

      const responseData = res.data as { success: boolean; data: { quote: any; order: any } };
      convertedOrderId = responseData?.data?.order?._id?.toString() || "";

      const order = await Order.findById(convertedOrderId);
      check(Boolean(order), "ACCEPT-4 Converted Order record created in MongoDB");
      check(order?.total === 35902, "ACCEPT-5 Order total stored in Rupees (₹35,902, NOT paise)");
      check(order?.subtotal === 30425, "ACCEPT-6 Order subtotal stored in Rupees (₹30,425)");
      check(order?.items?.length === 2, "ACCEPT-7 Order items preserved as 2 distinct variant items (M & L)");
      check(order?.items?.[0]?.selectedSize === "M", "ACCEPT-8 Item 1 size is M (not VARIOUS)");
      check(order?.items?.[0]?.quantity === 15, "ACCEPT-9 Item 1 quantity is 15");
      check(order?.items?.[1]?.selectedSize === "L", "ACCEPT-10 Item 2 size is L (not VARIOUS)");
      check(order?.items?.[1]?.quantity === 15, "ACCEPT-11 Item 2 quantity is 15");
      check(
        order?.items?.[0]?.mockupImages?.[0]?.url === "https://res.cloudinary.com/demo/image/upload/boxy_tee_proof_v2.png",
        "ACCEPT-12 Approved mockup proof carried into Order items"
      );
    }

    // Test 6.4: Idempotency check — Repeated accept call creates NO duplicate order
    {
      // Count verification
      const totalOrdersBefore = await Order.countDocuments();

      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        params: { quoteId },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await acceptQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "IDEMP-1 Repeated accept call does not throw error");
      const totalOrdersAfter = await Order.countDocuments();
      check(totalOrdersAfter === totalOrdersBefore, "IDEMP-2 Duplicate accept creates ZERO duplicate orders");
    }

    // ─── 7. CUSTOM DESIGN DATA-LOSS FIX VERIFICATION ─────────────────
    console.log("\n[7. Custom Design Request Data-Loss Fix Verification]");
    {
      const req: unknown = {
        user: { id: customerId, role: "CUSTOMER" },
        body: {
          productId: testProduct._id.toString(),
          selectedVariantId: variantIdM.toString(),
          selectedColor: "Pitch Black",
          selectedSize: "M",
          instructions: "Direct transfer with gold metallic outline.",
          catalogItemId: testCatalogItem._id.toString(),
          selectedPlacements: [
            {
              templateId: testPlacement1._id.toString(),
              code: testPlacement1.code,
              name: testPlacement1.name,
            },
          ],
          artworkType: "HAS_ARTWORK",
          artwork: {
            url: "https://res.cloudinary.com/demo/image/upload/gold_logo.png",
            publicId: "gold_logo_456",
            format: "png",
          },
          designAssistanceName: "Aman Gupta",
          designAssistanceEmail: "aman@alphagaming.com",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createCustomPrintingRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "CD-1 createCustomPrintingRequest succeeds");
      const responseData = res.data as { success: boolean; data: any };
      const savedDesign = responseData?.data;

      check(savedDesign?.catalogItemId?.toString() === testCatalogItem._id.toString(), "CD-2 catalogItemId persisted in CustomDesign");
      check(savedDesign?.selectedPlacements?.length === 1, "CD-3 selectedPlacements persisted in CustomDesign");
      check(savedDesign?.selectedPlacements?.[0]?.code === testPlacement1.code, "CD-4 Placement code preserved");
      check(savedDesign?.designAssistance?.name === "Aman Gupta", "CD-5 Design assistance contact preserved");
      if (savedDesign?._id) await CustomDesign.deleteOne({ _id: savedDesign._id });
    }

  } finally {
    // Clean up test fixtures
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (testProduct?._id) await Product.deleteOne({ _id: testProduct._id });
    if (testCategory?._id) await Category.deleteOne({ _id: testCategory._id });
    if (testPlacement1?._id) await PrintPlacementTemplate.deleteOne({ _id: testPlacement1._id });
    if (testPlacement2?._id) await PrintPlacementTemplate.deleteOne({ _id: testPlacement2._id });
    if (testCatalogItem?._id) await CustomPrintCatalogItem.deleteOne({ _id: testCatalogItem._id });
    await PrintPricingConfig.deleteMany({ scope: { $in: ["GLOBAL", "CATEGORY", "PRODUCT"] } });
    await BulkOrderRequest.deleteMany({ organizationName: { $regex: /Alpha Gaming/i } });
    await BulkQuote.deleteMany({ quoteNumber: { $regex: /^QT/ } });

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
