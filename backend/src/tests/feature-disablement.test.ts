import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

process.env.NODE_ENV = "test";
process.env.PORT = "5001";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test_access_secret_for_feature_disablement";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test_refresh_secret_for_feature_disablement";
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_mock";
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "mock_secret_test";

const { connectSafeTestDb } = require("./testHelpers");
const { app } = require("../index");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { User } = require("../models/User");
const { Product, ProductStatus } = require("../models/Product");
const { Cart } = require("../models/Cart");
const { BulkOrderRequest } = require("../models/BulkOrderRequest");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ? PASS: ${name}`);
    passed++;
  } else {
    const msg = details ? `${name} � ${details}` : name;
    console.error(`  ? FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

async function request(method: string, urlPath: string, options: any = {}) {
  const headers: any = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:5001${urlPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function expectDisabled(method: string, urlPath: string, options: any = {}, label = "") {
  const res = await request(method, urlPath, options);
  check(
    res.status === 503 && res.json?.code === "CUSTOM_DESIGN_DISABLED",
    `${label}: ${method} ${urlPath} returns 503 CUSTOM_DESIGN_DISABLED`,
    `status=${res.status}, code=${res.json?.code}`
  );
}

async function run() {
  await connectSafeTestDb();
  console.log("Connected to verified isolated test database");

  const adminEmail = `admin-${Date.now()}@example.com`;
  const adminPassword = "AdminPass123!";
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await User.create({
    name: "Feature Flag Admin",
    email: adminEmail,
    passwordHash,
    role: "ADMIN",
    status: "ACTIVE",
  });

  const product = await Product.create({
    name: "Feature Flag Product",
    slug: `feature-flag-product-${Date.now()}`,
    description: "Normal product",
    categoryId: new (require("mongoose").Types.ObjectId)(),
    basePrice: 500,
    status: ProductStatus.ACTIVE,
    variants: [{ size: "M", color: "Black", sku: `FF-${Date.now()}`, stock: 10, additionalPrice: 0, isAvailable: true }],
    images: ["https://example.com/p.jpg"],
  });
  const variantId = product.variants[0]._id.toString();

  const server = app.listen(5001);
  await new Promise((resolve) => server.on("listening", resolve));

  const customerEmail = `customer-${Date.now()}@example.com`;
  const reg = await request("POST", "/api/auth/register", {
    body: { name: "Feature Customer", email: customerEmail, password: "CustomerPass123!" },
  });
  check(reg.status === 201, "normal registration returns 201", `status=${reg.status}`);
  const login = await request("POST", "/api/auth/login", {
    body: { email: customerEmail, password: "CustomerPass123!" },
  });
  check(login.status === 200 && !!login.json?.data?.accessToken, "normal login returns token", `status=${login.status}`);
  const customerToken = login.json?.data?.accessToken;

  const adminLogin = await request("POST", "/api/auth/login", {
    body: { email: adminEmail, password: adminPassword },
  });
  check(adminLogin.status === 200 && !!adminLogin.json?.data?.accessToken, "admin login returns token", `status=${adminLogin.status}`);
  const adminToken = adminLogin.json?.data?.accessToken;

  const customerUser = await User.findOne({ email: customerEmail });

  const productsRes = await request("GET", "/api/catalog/products");
  check(productsRes.status === 200, "catalog products route stays active", `status=${productsRes.status}`);

  const cartRes = await request("GET", "/api/cart", { token: customerToken });
  check(cartRes.status === 200, "standard cart route stays active", `status=${cartRes.status}`);

  const volumeRulesRes = await request("GET", `/api/pricing/volume-rules?productId=${product._id.toString()}`);
  check(volumeRulesRes.status === 200, "volume pricing rules route stays active", `status=${volumeRulesRes.status}`);

  const bulkRes = await request("POST", "/api/bulk-orders/request", {
    body: {
      organizationName: "Test Org",
      contactName: "Test Contact",
      email: customerEmail,
      phone: "9876543210",
      productId: product._id.toString(),
      variantAllocations: [{ size: "M", color: "Black", quantity: 12 }],
      deliveryLocation: "Test delivery",
      requiredByDate: "2026-12-01",
    },
  });
  check(bulkRes.status === 201, "normal bulk quotation route stays active", `status=${bulkRes.status}`);
  const bulkRequestId = bulkRes.json?.data?._id || bulkRes.json?.data?.id;

  const adminBulkRes = await request("GET", "/api/admin/bulk-orders", { token: adminToken });
  check(adminBulkRes.status === 200, "admin bulk management route stays active", `status=${adminBulkRes.status}`);

  const orderRes = await request("POST", "/api/orders", {
    token: customerToken,
    body: { addressId: new (require("mongoose").Types.ObjectId)().toString() },
  });
  check(orderRes.status !== 503, "standard order route is not feature-disabled", `status=${orderRes.status}`);

  const directPayloadChecks = async (label: string) => {
    const cartAddRes = await request("POST", "/api/cart/items", {
      token: customerToken,
      body: {
        productId: product._id.toString(),
        variantId,
        quantity: 1,
        isCustomized: true,
        customConfigurations: [{ designId: new (require("mongoose").Types.ObjectId)().toString() }],
      },
    });
    check(cartAddRes.status === 503 && cartAddRes.json?.code === "CUSTOM_DESIGN_DISABLED", `${label}: cart add with isCustomized/customConfigurations is blocked`, `status=${cartAddRes.status}, code=${cartAddRes.json?.code}`);

    const normalCartAdd = await request("POST", "/api/cart/items", {
      token: customerToken,
      body: { productId: product._id.toString(), variantId, quantity: 1 },
    });
    check(normalCartAdd.status === 200, `${label}: normal cart add remains available`, `status=${normalCartAdd.status}`);

    const cart = await request("GET", "/api/cart", { token: customerToken });
    const itemId = cart.json?.data?.items?.[0]?._id;
    if (itemId) {
      const cartUpdateRes = await request("PATCH", `/api/cart/items/${itemId}`, {
        token: customerToken,
        body: { customConfigurations: [{ designId: new (require("mongoose").Types.ObjectId)().toString() }] },
      });
      check(cartUpdateRes.status === 503 && cartUpdateRes.json?.code === "CUSTOM_DESIGN_DISABLED", `${label}: cart update with customConfigurations is blocked`, `status=${cartUpdateRes.status}, code=${cartUpdateRes.json?.code}`);
    } else {
      check(false, `${label}: cart update with customConfigurations is blocked`, "no cart item id");
    }

    await Cart.findOneAndUpdate(
      { userId: customerUser._id },
      {
        userId: customerUser._id,
        items: [{
          productId: product._id,
          variantId: product.variants[0]._id,
          quantity: 1,
          isCustomized: true,
          customConfigurations: [{
            color: "Black",
            variantId: product.variants[0]._id,
            designId: new (require("mongoose").Types.ObjectId)(),
            sizeDistribution: [{ size: "M", quantity: 1 }],
          }],
          pricingSnapshot: { total: 500 },
        }],
      },
      { upsert: true, new: true }
    );
    const customOrderRes = await request("POST", "/api/orders", {
      token: customerToken,
      body: { addressId: new (require("mongoose").Types.ObjectId)().toString() },
    });
    check(customOrderRes.status === 503 && customOrderRes.json?.code === "CUSTOM_DESIGN_DISABLED", `${label}: order creation with customized cart item is blocked`, `status=${customOrderRes.status}, code=${customOrderRes.json?.code}`);
    await Cart.deleteOne({ userId: customerUser._id });

    const deferredBulkFields = [
      { customPrintingRequired: true },
      { customDesignId: new (require("mongoose").Types.ObjectId)().toString() },
      { printLocations: ["FRONT"] },
      { printMethod: "DTF Transfer" },
      { printText: "Sample text" },
      { preferredColors: ["White"] },
      { designPreferences: "Sample preference" },
      { needsDesignAssistance: true },
      { artworkFiles: [{ url: "https://example.com/artwork.png" }] },
    ];
    for (const field of deferredBulkFields) {
      const res = await request("POST", "/api/bulk-orders/request", {
        body: {
          organizationName: "Test Org",
          contactName: "Test Contact",
          email: customerEmail,
          phone: "9876543210",
          productId: product._id.toString(),
          variantAllocations: [{ size: "M", color: "Black", quantity: 12 }],
          deliveryLocation: "Test delivery",
          requiredByDate: "2026-12-01",
          ...field,
        },
      });
      check(res.status === 503 && res.json?.code === "CUSTOM_DESIGN_DISABLED", `${label}: bulk request with ${Object.keys(field)[0]} is blocked`, `status=${res.status}, code=${res.json?.code}`);
    }

    const pricingRes = await request("POST", "/api/pricing/calculate", {
      body: { productId: product._id.toString(), variantId, quantity: 1, isCustomized: true, customConfigurations: [{ designId: new (require("mongoose").Types.ObjectId)().toString() }] },
    });
    check(pricingRes.status === 503 && pricingRes.json?.code === "CUSTOM_DESIGN_DISABLED", `${label}: pricing calculate with custom payload is blocked`, `status=${pricingRes.status}, code=${pricingRes.json?.code}`);

    const form = new FormData();
    form.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "artwork.png");
    form.append("category", "custom-artwork");
    const multipartRes = await fetch("http://127.0.0.1:5001/api/upload/image", { method: "POST", body: form });
    let multipartJson: any = null;
    try { multipartJson = await multipartRes.json(); } catch { multipartJson = null; }
    check(multipartRes.status === 503 && multipartJson?.code === "CUSTOM_DESIGN_DISABLED", `${label}: multipart custom-artwork upload is blocked`, `status=${multipartRes.status}, code=${multipartJson?.code}`);
  };

  const privateFileChecks = async (label: string) => {
    const privateDir = path.resolve(__dirname, "../../../uploads/samrat-fashion/custom-designs");
    fs.mkdirSync(privateDir, { recursive: true });
    const marker = "PRIVATE_ARTWORK_MARKER_123";
    const fileName = `feature-disablement-private-${Date.now()}.png`;
    const filePath = path.join(privateDir, fileName);
    fs.writeFileSync(filePath, marker);
    try {
      const privateRes = await fetch(`http://127.0.0.1:5001/uploads/samrat-fashion/custom-designs/${fileName}`);
      const bodyText = await privateRes.text();
      check(privateRes.status === 404, `${label}: existing private custom-design file is not retrievable`, `status=${privateRes.status}`);
      check(!bodyText.includes(marker), `${label}: private custom-design response does not reveal file contents`, `body=${bodyText.slice(0, 120)}`);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  };

  const customChecks = async (label: string) => {
    await expectDisabled("GET", "/api/designs", {}, label);
    await expectDisabled("GET", "/api/custom-templates", {}, label);
    await expectDisabled("GET", "/api/custom-print-catalog", {}, label);
    await expectDisabled("GET", "/api/custom-print-catalog/categories", {}, label);
    await expectDisabled("POST", "/api/ai/generate", { body: {} }, label);
    await expectDisabled("GET", "/api/admin/custom-orders", { token: adminToken }, label);
    await expectDisabled("GET", "/api/admin/production/queue", { token: adminToken }, label);
    await expectDisabled("GET", "/api/admin/custom-print-catalog", { token: adminToken }, label);
    await expectDisabled("GET", "/api/admin/print-catalog", { token: adminToken }, label);
    await expectDisabled("GET", "/api/admin/print-pricing", { token: adminToken }, label);
    await expectDisabled("GET", "/api/admin/pricing-configs", { token: adminToken }, label);
    await expectDisabled("POST", "/api/pricing/calculate", { body: { productId: product._id.toString(), variantId, quantity: 1 } }, label);
    await expectDisabled("POST", "/api/upload/image", { body: { category: "custom-artwork" } }, label);
    await expectDisabled("POST", `/api/admin/bulk-orders/${new (require("mongoose").Types.ObjectId)()}/mockup`, { token: adminToken }, label);
    await expectDisabled("POST", `/api/orders/${new (require("mongoose").Types.ObjectId)()}/items/${new (require("mongoose").Types.ObjectId)()}/approve-mockup`, { token: customerToken }, label);
    await expectDisabled("POST", `/api/orders/${new (require("mongoose").Types.ObjectId)()}/items/${new (require("mongoose").Types.ObjectId)()}/request-revision`, { token: customerToken }, label);
    await expectDisabled("POST", `/api/bulk-orders/requests/${new (require("mongoose").Types.ObjectId)()}/approve-mockup`, { token: customerToken }, label);
    await expectDisabled("POST", `/api/bulk-orders/requests/${new (require("mongoose").Types.ObjectId)()}/request-revision`, { token: customerToken }, label);

    await directPayloadChecks(label);
    await privateFileChecks(label);
  };

  delete process.env.ENABLE_CUSTOM_DESIGN;
  console.log("Testing with ENABLE_CUSTOM_DESIGN unset");
  await customChecks("unset");

  process.env.ENABLE_CUSTOM_DESIGN = "false";
  console.log("Testing with ENABLE_CUSTOM_DESIGN=false");
  await customChecks("false");

  await User.deleteMany({ email: { $in: [adminEmail, customerEmail] } });
  await Product.deleteOne({ _id: product._id });
  await Cart.deleteMany({ userId: customerUser._id });
  if (bulkRequestId) await BulkOrderRequest.deleteOne({ _id: bulkRequestId });

  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  console.log(`\nFeature disablement integration results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Feature disablement test fatal error:", err);
  process.exit(1);
});