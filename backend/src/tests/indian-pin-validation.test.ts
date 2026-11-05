import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";
import { connectSafeTestDb } from "./testHelpers";
import { Address } from "../models/Address";
import { User, UserRole, UserStatus } from "../models/User";
import {
  isValidIndianPostalCode,
  createAddress,
  updateAddress,
} from "../controllers/addressController";

let passed = 0;
let failed = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  body: any;
  status(code: number): this;
  json(body: any): this;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  return res;
}

async function runIndianPinValidationTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Indian Postal PIN Code Validation Test Suite                  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const cleanupAddressIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [userId];

  try {
    await User.create({
      _id: userId,
      name: "PIN Test Customer",
      email: `pin_test_${Date.now()}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HELPER UNIT VALIDATION: isValidIndianPostalCode
    // ─────────────────────────────────────────────────────────────────────────
    console.log("--- 1. PIN Code Helper Unit Tests ---");

    // Valid 6-digit Indian PIN codes across regional circles (1-8 and Army 9)
    const validPins = [
      "110001", // Delhi
      "122001", // Haryana (Gurugram)
      "141001", // Punjab (Ludhiana)
      "201301", // UP (Noida)
      "302001", // Rajasthan (Jaipur)
      "380001", // Gujarat (Ahmedabad)
      "400001", // Maharashtra (Mumbai)
      "500001", // Telangana (Hyderabad)
      "560001", // Karnataka (Bengaluru)
      "600001", // Tamil Nadu (Chennai)
      "682001", // Kerala (Kochi)
      "700001", // West Bengal (Kolkata)
      "781001", // Assam (Guwahati)
      "800001", // Bihar (Patna)
      "900001", // APS (Army Postal Service)
    ];

    for (const pin of validPins) {
      check(isValidIndianPostalCode(pin) === true, `Valid PIN '${pin}' is accepted`);
      check(isValidIndianPostalCode(`  ${pin}  `) === true, `Valid PIN '${pin}' with whitespace padding is accepted`);
    }

    // Invalid PIN codes
    check(isValidIndianPostalCode("012345") === false, "PIN starting with 0 is rejected");
    check(isValidIndianPostalCode("000000") === false, "All-zero PIN '000000' is rejected");
    check(isValidIndianPostalCode("000001") === false, "Leading zero PIN '000001' is rejected");
    check(isValidIndianPostalCode("56003A") === false, "PIN with alphanumeric character '56003A' is rejected");
    check(isValidIndianPostalCode("ABCDEF") === false, "Pure alphabetic string 'ABCDEF' is rejected");
    check(isValidIndianPostalCode("560-001") === false, "PIN with hyphen '560-001' is rejected");
    check(isValidIndianPostalCode("560 001") === false, "PIN with internal space '560 001' is rejected");
    check(isValidIndianPostalCode("56001") === false, "Short 5-digit PIN '56001' is rejected");
    check(isValidIndianPostalCode("5600") === false, "Short 4-digit PIN '5600' is rejected");
    check(isValidIndianPostalCode("123") === false, "Short 3-digit PIN '123' is rejected");
    check(isValidIndianPostalCode("5600011") === false, "Long 7-digit PIN '5600011' is rejected");
    check(isValidIndianPostalCode("123456789") === false, "Long 9-digit PIN is rejected");
    check(isValidIndianPostalCode("") === false, "Empty PIN string is rejected");
    check(isValidIndianPostalCode("      ") === false, "Whitespace-only PIN string is rejected");
    check(isValidIndianPostalCode("560001' OR '1'='1") === false, "Injection string in PIN is rejected");
    check(isValidIndianPostalCode("<script>alert(1)</script>") === false, "XSS payload in PIN is rejected");

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CONTROLLER VALIDATION: createAddress
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- 2. createAddress Controller Endpoint Tests ---");

    // 2.1 Rejects creation with invalid PIN codes
    const invalidCreationPins = ["054321", "56003A", "56001", "5600011", "INVALID"];
    for (const badPin of invalidCreationPins) {
      let createErr: any = null;
      const req = {
        user: { id: userId.toString(), role: "CUSTOMER" },
        body: {
          fullName: "Customer Name",
          phone: "9876543210",
          addressLine1: "123 Road",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: badPin,
          addressType: "HOME",
        },
      } as unknown as Request;
      const res = createMockRes();
      const next: NextFunction = (err) => { createErr = err; };

      await createAddress(req, res as unknown as Response, next);
      check(
        createErr !== null &&
          createErr.statusCode === 400 &&
          createErr.message.includes("PIN Code must be a valid 6-digit Indian postal code"),
        `createAddress rejects invalid PIN '${badPin}' with 400 VALIDATION_ERROR`
      );
    }

    // 2.2 Accepts creation with valid PIN
    let validCreateErr: any = null;
    const validCreateReq = {
      user: { id: userId.toString(), role: "CUSTOMER" },
      body: {
        fullName: "Customer Name",
        phone: "9876543210",
        addressLine1: "123 Indiranagar 100ft Rd",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560038",
        addressType: "HOME",
      },
    } as unknown as Request;
    const validCreateRes = createMockRes();
    const validCreateNext: NextFunction = (err) => { validCreateErr = err; };

    await createAddress(validCreateReq, validCreateRes as unknown as Response, validCreateNext);
    check(
      validCreateErr === null && validCreateRes.statusCode === 201,
      "createAddress creates address with valid PIN '560038' and returns 201"
    );

    const createdAddressId = validCreateRes.body?.data?._id;
    if (createdAddressId) cleanupAddressIds.push(new mongoose.Types.ObjectId(createdAddressId));

    // ─────────────────────────────────────────────────────────────────────────
    // 3. CONTROLLER VALIDATION: updateAddress
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- 3. updateAddress Controller Endpoint Tests ---");

    // 3.1 Rejects update with invalid PIN
    let updateBadPinErr: any = null;
    const updateBadReq = {
      user: { id: userId.toString(), role: "CUSTOMER" },
      params: { id: createdAddressId.toString() },
      body: { postalCode: "012345" },
    } as unknown as Request;
    const updateBadRes = createMockRes();
    const updateBadNext: NextFunction = (err) => { updateBadPinErr = err; };

    await updateAddress(updateBadReq, updateBadRes as unknown as Response, updateBadNext);
    check(
      updateBadPinErr !== null &&
        updateBadPinErr.statusCode === 400 &&
        updateBadPinErr.message.includes("PIN Code must be a valid 6-digit Indian postal code"),
      "updateAddress rejects update to invalid PIN '012345' with 400 VALIDATION_ERROR"
    );

    // 3.2 Accepts update with valid PIN
    let updateGoodPinErr: any = null;
    const updateGoodReq = {
      user: { id: userId.toString(), role: "CUSTOMER" },
      params: { id: createdAddressId.toString() },
      body: { postalCode: "560001" },
    } as unknown as Request;
    const updateGoodRes = createMockRes();
    const updateGoodNext: NextFunction = (err) => { updateGoodPinErr = err; };

    await updateAddress(updateGoodReq, updateGoodRes as unknown as Response, updateGoodNext);
    check(
      updateGoodPinErr === null && updateGoodRes.statusCode === 200,
      "updateAddress updates address with valid PIN '560001' and returns 200"
    );

    const reloadedAddress = await Address.findById(createdAddressId);
    check(
      reloadedAddress?.postalCode === "560001",
      "Persisted address postalCode is updated to '560001'"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 4. MONGOOSE SCHEMA LEVEL VALIDATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- 4. Mongoose Schema Invariant Tests ---");

    let schemaValidationThrew = false;
    try {
      await Address.create({
        userId,
        fullName: "Schema Test",
        phone: "9876543210",
        addressLine1: "Schema Road",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "40000A", // Invalid!
        addressType: "HOME",
      });
    } catch (err: any) {
      if (err.name === "ValidationError" && err.errors?.postalCode) {
        schemaValidationThrew = true;
      }
    }
    check(
      schemaValidationThrew,
      "AddressSchema rejects invalid postalCode '40000A' with Mongoose ValidationError"
    );

  } finally {
    if (cleanupAddressIds.length > 0) {
      await Address.deleteMany({ _id: { $in: cleanupAddressIds } });
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } });
    }
    await mongoose.disconnect();
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runIndianPinValidationTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});

