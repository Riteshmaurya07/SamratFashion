import mongoose from "mongoose";
import { connectSafeTestDb } from "./testHelpers";
import { Address } from "../models/Address";
import { Order } from "../models/Order";
import { normalizeIndianPhone, isValidIndianMobile } from "../controllers/addressController";
import { generateShippingLabelPDFStream } from "../utils/pdfLabelGenerator";

let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n==========================================");
  console.log("FEATURE 1: ALTERNATE CONTACT NUMBER TESTS");
  console.log("==========================================\n");

  await connectSafeTestDb();

  const testUserId = new mongoose.Types.ObjectId();
  const testProductId = new mongoose.Types.ObjectId();
  const testVariantId = new mongoose.Types.ObjectId();

  try {
    // Clean any remnants
    await Address.deleteMany({ userId: testUserId });
    await Order.deleteMany({ userId: testUserId });

    // 1. Phone Normalization & Validation Helper Tests
    console.log("--- 1. Phone Normalization & Validation ---");
    check(normalizeIndianPhone("9876543210") === "9876543210", "10-digit number normalizes verbatim");
    check(normalizeIndianPhone("+91 9876543210") === "9876543210", "+91 prefix strips to 10 digits");
    check(normalizeIndianPhone("919876543210") === "9876543210", "91 prefix strips to 10 digits");
    check(normalizeIndianPhone("09876543210") === "9876543210", "Leading 0 strips to 10 digits");
    check(isValidIndianMobile("9876543210") === true, "Valid Indian 10-digit mobile starts with 6-9");
    check(isValidIndianMobile("5876543210") === false, "Invalid start digit (5) rejected");
    check(isValidIndianMobile("98765") === false, "Short number rejected");

    // 2. Address Creation without Alternate Phone (Backward Compatibility)
    console.log("\n--- 2. Backward Compatibility (No Alternate Phone) ---");
    const addr1 = await Address.create({
      userId: testUserId,
      fullName: "Arun Kumar",
      phone: "9876543210",
      addressLine1: "123 Street Corner",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
      addressType: "HOME",
      isDefault: true,
    });

    check(addr1.phone === "9876543210", "Address saved with valid primary phone");
    check(addr1.alternatePhone === undefined, "Address without alternatePhone remains undefined");

    // 3. Address Creation with Valid Alternate Phone
    console.log("\n--- 3. Address with Valid Alternate Phone ---");
    const addr2 = await Address.create({
      userId: testUserId,
      fullName: "Arun Kumar",
      phone: "9876543210",
      alternatePhone: "8765432109",
      addressLine1: "456 Avenue Park",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560002",
      country: "India",
      addressType: "WORK",
    });

    check(addr2.alternatePhone === "8765432109", "Address saved with alternatePhone");

    // 4. Address Validation: Invalid Alternate Phone Rejected by Schema
    console.log("\n--- 4. Invalid Alternate Phone Rejection ---");
    let caughtSchemaErr = false;
    try {
      await Address.create({
        userId: testUserId,
        fullName: "Bad Phone Test",
        phone: "9876543210",
        alternatePhone: "12345", // invalid!
        addressLine1: "789 Broken Lane",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560003",
        country: "India",
        addressType: "OTHER",
      });
    } catch {
      caughtSchemaErr = true;
    }
    check(caughtSchemaErr, "Schema rejects invalid alternatePhone length/format");

    // 5. Order Snapshot Immutability
    console.log("\n--- 5. Order Snapshot Immutability ---");
    const orderNumber = `SF-TEST-${Date.now()}`;
    const order = await Order.create({
      orderNumber,
      userId: testUserId,
      items: [
        {
          productId: testProductId,
          variantId: testVariantId,
          productName: "Oversized Streetwear Tee",
          productImage: "https://example.com/tee.jpg",
          selectedSize: "L",
          selectedColor: "Jet Black",
          quantity: 1,
          unitPrice: 1299,
          lineTotal: 1299,
        },
      ],
      shippingAddress: {
        fullName: addr2.fullName,
        phone: addr2.phone,
        alternatePhone: addr2.alternatePhone,
        addressLine1: addr2.addressLine1,
        city: addr2.city,
        state: addr2.state,
        postalCode: addr2.postalCode,
        country: addr2.country,
        addressType: addr2.addressType,
      },
      subtotal: 1299,
      discount: 0,
      shipping: 0,
      tax: 65,
      total: 1364,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });

    check(order.shippingAddress.phone === "9876543210", "Order snapshot contains primary phone");
    check(order.shippingAddress.alternatePhone === "8765432109", "Order snapshot contains alternate phone");

    // Mutate the original saved address
    await Address.findByIdAndUpdate(addr2._id, {
      alternatePhone: "7654321098",
      addressLine1: "Changed Address Lane",
    });

    // Re-fetch order from database to ensure immutability
    const freshOrder = await Order.findById(order._id);
    check(
      freshOrder?.shippingAddress.alternatePhone === "8765432109",
      "Historical order alternatePhone remains unchanged after address update"
    );
    check(
      freshOrder?.shippingAddress.addressLine1 === "456 Avenue Park",
      "Historical order addressLine1 remains unchanged after address update"
    );

    // 6. Shipping Label PDF Rendering with Alternate Phone
    console.log("\n--- 6. Shipping Label Rendering ---");
    const mockShipment = {
      orderId: order._id,
      userId: testUserId,
      carrier: "Delhivery Express",
      trackingNumber: "DEL-123456789",
      awbNumber: "DEL-123456789",
      provider: "delhivery",
      status: "LABEL_CREATED",
      packageDetails: { weightGrams: 500, lengthCm: 30, widthCm: 25, heightCm: 5 },
    };

    let pdfError = false;
    try {
      const doc = generateShippingLabelPDFStream(mockShipment as any, order);
      check(Boolean(doc), "Shipping label stream generated without throwing");
    } catch (e) {
      pdfError = true;
      console.error(e);
    }
    check(!pdfError, "PDF shipping label handles alternatePhone cleanly");

  } finally {
    // Cleanup test fixtures
    await Address.deleteMany({ userId: testUserId });
    await Order.deleteMany({ userId: testUserId });
    await mongoose.disconnect();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
