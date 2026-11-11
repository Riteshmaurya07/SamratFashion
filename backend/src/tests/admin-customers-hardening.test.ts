import http from "http";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectSafeTestDb } from "./testHelpers";
import { escapeRegex, sanitizeCsvCell } from "../controllers/adminCustomerController";
import { User, UserRole, UserStatus } from "../models/User";

// Prevent the application entrypoint from auto-starting a listener on the shared port.
process.env.NODE_ENV = "test";
const { app } = require("../index") as typeof import("../index");

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

function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  rawText: string;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<HttpResponse> {
  const { promise, resolve, reject } = withResolvers<HttpResponse>();
  const url = new URL(path, serverUrl);
  const headers: Record<string, string> = {};
  let payload = "";

  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const req = http.request(url, { method, headers }, (res) => {
    let resData = "";
    res.on("data", (chunk) => {
      resData += chunk;
    });
    res.on("end", () => {
      let parsed = null;
      try {
        parsed = resData ? JSON.parse(resData) : null;
      } catch {
        parsed = null;
      }
      resolve({
        status: res.statusCode || 500,
        headers: res.headers,
        body: parsed,
        rawText: resData,
      });
    });
  });

  req.on("error", reject);
  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

async function loginToken(serverUrl: string, email: string, password: string): Promise<string> {
  const res = await request(serverUrl, "POST", "/api/auth/login", { email, password });
  const token = res.body?.data?.accessToken;
  if (res.status !== 200 || typeof token !== "string" || !token) {
    throw new Error(`Test login failed with HTTP ${res.status}`);
  }
  return token;
}

async function runCustomerHardeningTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Admin Customers Security, KPIs & CSV Hardening Test Suite     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  await connectSafeTestDb();
  const testSuffix = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const server = http.createServer(app);
  const { promise: listenPromise, resolve: listenResolve } = withResolvers<void>();
  server.listen(0, () => listenResolve());
  await listenPromise;
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const rawPass = "AdminCustomerPass123!";
    const hashed = await bcrypt.hash(rawPass, 10);

    const admin = await new User({
      name: "Admin Customer Reviewer",
      email: `admin_cust_${testSuffix}@example.com`,
      passwordHash: hashed,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    }).save();

    const customer = await new User({
      name: "Standard Customer User",
      email: `standard_cust_${testSuffix}@example.com`,
      passwordHash: hashed,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    }).save();
    const superAdmin = await new User({
      name: "Super Admin User",
      email: `super_admin_${testSuffix}@example.com`,
      passwordHash: hashed,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    }).save();

    const adminToken = await loginToken(serverUrl, admin.email, rawPass);
    const superAdminToken = await loginToken(serverUrl, superAdmin.email, rawPass);
    const customerToken = await loginToken(serverUrl, customer.email, rawPass);

    console.log("\n[TEST 0] Pure Helper Hardening");
    const specialCharsForRegex = ".*+?^${}()|[]\\/\"'";
    const escapedLiteral = escapeRegex(specialCharsForRegex);
    check(
      new RegExp(`^${escapedLiteral}$`).test(specialCharsForRegex),
      "escapeRegex turns every regex metacharacter into a literal"
    );
    check(
      !new RegExp(`^${escapedLiteral}$`).test(specialCharsForRegex + "x"),
      "escapeRegex output does not over-match a longer string"
    );
    check(sanitizeCsvCell("=1+1") === "\"'=1+1\"", "sanitizeCsvCell neutralizes '=' with a leading single quote");
    check(sanitizeCsvCell("+SUM(A1)") === "\"'+SUM(A1)\"", "sanitizeCsvCell neutralizes '+'");
    check(sanitizeCsvCell("-2+3") === "\"'-2+3\"", "sanitizeCsvCell neutralizes '-'");
    check(sanitizeCsvCell("@cmd") === "\"'@cmd\"", "sanitizeCsvCell neutralizes '@'");
    check(sanitizeCsvCell("  =cmd") === "\"'  =cmd\"", "sanitizeCsvCell neutralizes leading-whitespace formulas");
    check(sanitizeCsvCell('a"b') === "\"a\"\"b\"", "sanitizeCsvCell escapes embedded double quotes");
    check(sanitizeCsvCell("a,b") === "\"a,b\"", "sanitizeCsvCell quotes embedded commas");
    check(sanitizeCsvCell(null) === '""', "sanitizeCsvCell renders null as an empty quoted cell");

    console.log("\n[TEST 1] RBAC Protection on Customer Endpoints & CSV Export");
    const unauthGetRes = await request(serverUrl, "GET", "/api/admin/customers");
    check(unauthGetRes.status === 401, "Unauthenticated /api/admin/customers returns 401");

    const unauthExportRes = await request(serverUrl, "GET", "/api/admin/customers/export");
    check(unauthExportRes.status === 401, "Unauthenticated /api/admin/customers/export returns 401");

    const customerGetRes = await request(serverUrl, "GET", "/api/admin/customers", undefined, customerToken);
    check(customerGetRes.status === 403, "Customer role accessing /api/admin/customers returns 403 Forbidden");

    const customerExportRes = await request(serverUrl, "GET", "/api/admin/customers/export", undefined, customerToken);
    check(customerExportRes.status === 403, "Customer role accessing /api/admin/customers/export returns 403 Forbidden");

    const adminGetRes = await request(serverUrl, "GET", "/api/admin/customers", undefined, adminToken);
    check(adminGetRes.status === 200, "Admin accessing /api/admin/customers returns 200 OK");

    const adminExportRes = await request(serverUrl, "GET", "/api/admin/customers/export", undefined, adminToken);
    check(adminExportRes.status === 200, "Admin accessing /api/admin/customers/export returns 200 OK");
    check(
      Boolean(adminExportRes.headers["content-type"]?.includes("text/csv")),
      "Export responds with Content-Type text/csv"
    );

    const superAdminExportRes = await request(serverUrl, "GET", "/api/admin/customers/export", undefined, superAdminToken);
    check(superAdminExportRes.status === 200, "Super Admin accessing /api/admin/customers/export returns 200 OK");
    check(
      Boolean(superAdminExportRes.headers["content-disposition"]?.includes('attachment; filename="customers-export-')),
      "Export response sets Content-Disposition attachment filename header"
    );
    check(
      Boolean(superAdminExportRes.headers["access-control-expose-headers"]?.includes("Content-Disposition")),
      "Export response exposes Content-Disposition header in CORS"
    );

    console.log("\n[TEST 2] Store-Wide KPI Aggregation Invariance Under Filtering");
    // Seed fixtures with various statuses
    const eightDigits = String(Math.floor(10000000 + Math.random() * 90000000));
    const fixtureUsers = await User.insertMany([
      { name: "Active User One", email: `active1_${testSuffix}@example.com`, phone: `+918${eightDigits}1`, passwordHash: hashed, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
      { name: "Active User Two", email: `active2_${testSuffix}@example.com`, phone: `8${eightDigits}2`, passwordHash: hashed, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
      { name: "Suspended User Three", email: `susp_${testSuffix}@example.com`, phone: `08${eightDigits}3`, passwordHash: hashed, role: UserRole.CUSTOMER, status: UserStatus.SUSPENDED },
      { name: "Disabled User Four", email: `dis_${testSuffix}@example.com`, phone: `918${eightDigits}4`, passwordHash: hashed, role: UserRole.CUSTOMER, status: UserStatus.DISABLED },
    ]);

    // Request with status=SUSPENDED filter
    const filteredRes = await request(serverUrl, "GET", `/api/admin/customers?status=SUSPENDED`, undefined, adminToken);
    check(filteredRes.status === 200, "Filtered customer query returns 200");
    check(
      filteredRes.body?.data?.items?.every((c: any) => c.status === "SUSPENDED"),
      "Items array is strictly filtered by status SUSPENDED"
    );
    const summary = filteredRes.body?.data?.summary;
    check(Boolean(summary), "Response includes store-wide summary metrics");
    check(summary?.total >= 5, "Store-wide total customers count includes all customers (not just filtered)");
    check(summary?.active >= 3, "Store-wide active count accurately reported");
    check(summary?.suspended >= 1, "Store-wide suspended count accurately reported");
    check(summary?.disabled >= 1, "Store-wide disabled count accurately reported");

    const searchFilteredRes = await request(
      serverUrl,
      "GET",
      `/api/admin/customers?search=${encodeURIComponent("Active User")}&status=ACTIVE`,
      undefined,
      adminToken
    );
    check(searchFilteredRes.status === 200, "Search + status filtered query returns 200");
    const searchSummary = searchFilteredRes.body?.data?.summary;
    check(
      searchSummary?.total === summary?.total &&
        searchSummary?.active === summary?.active &&
        searchSummary?.suspended === summary?.suspended &&
        searchSummary?.disabled === summary?.disabled,
      "KPI summary remains store-wide when both search and status filters are active"
    );

    console.log("\n[TEST 3] Search Security: Regex Escaping & ReDoS Protection");
    const specialChars = ".*+?^${}()|[]\\/\"'@#%&!";
    const specialRes = await request(
      serverUrl,
      "GET",
      `/api/admin/customers?search=${encodeURIComponent(specialChars)}`,
      undefined,
      adminToken
    );
    check(specialRes.status === 200, "Search with regex metacharacters succeeds safely (HTTP 200)");
    check(Array.isArray(specialRes.body?.data?.items), "Special character search returns items array without crashing");

    console.log("\n[TEST 4] Indian Phone Number Normalization in Search");
    // Search with 10-digit number without country code
    const raw10Digits = `8${eightDigits}1`;
    const search10Res = await request(serverUrl, "GET", `/api/admin/customers?search=${raw10Digits}`, undefined, adminToken);
    check(search10Res.body?.data?.items?.length > 0, "10-digit phone search matches +91 prefixed phone in database");

    // Search with +91 prefix for number stored without prefix
    const searchPlus91Res = await request(serverUrl, "GET", `/api/admin/customers?search=%2B918${eightDigits}2`, undefined, adminToken);
    check(searchPlus91Res.body?.data?.items?.length > 0, "+91 prefixed search matches local number in database");
    console.log("\n[TEST 5] Pagination & Non-Truncating CSV Export with Formula Injection Guard");
    // Pagination check
    const pageRes = await request(serverUrl, "GET", `/api/admin/customers?limit=2&page=1`, undefined, adminToken);
    check(pageRes.body?.data?.items?.length <= 2, "Page limit respected (max 2 items)");
    check(pageRes.body?.data?.totalPages >= 2, "totalPages calculated accurately");

    const page2Res = await request(serverUrl, "GET", `/api/admin/customers?limit=2&page=2`, undefined, adminToken);
    check(page2Res.body?.data?.items?.length <= 2, "Page 2 respects the page limit");
    const page1Ids = (pageRes.body?.data?.items || []).map((c: any) => c._id);
    const page2Ids = (page2Res.body?.data?.items || []).map((c: any) => c._id);
    check(
      page2Ids.length > 0 && page2Ids.every((id: string) => !page1Ids.includes(id)),
      "Page 2 does not repeat any page 1 customer"
    );

    // Create customers with CSV formula injection payloads in name, email, and phone
    // Covering =, +, -, @, \t, \r, and leading whitespace cases
    const maliciousInsert = await mongoose.connection.db!.collection("users").insertMany([
      { name: "=cmd|' /C calc'!A0", email: `+calc_${testSuffix}@example.com`, phone: `-9999999999`, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, createdAt: new Date() },
      { name: "@SUM(1+1)", email: `\tcalc_${testSuffix}@example.com`, phone: `\r9999999998`, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, createdAt: new Date() },
      { name: "   =cmd|' /C calc'!A1", email: `  +alert_${testSuffix}@example.com`, phone: `  @9999999997`, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, createdAt: new Date() },
    ]);
    const maliciousUserIds = Object.values(maliciousInsert.insertedIds);

    const exportCsvRes = await request(serverUrl, "GET", `/api/admin/customers/export`, undefined, adminToken);
    check(exportCsvRes.status === 200, "CSV export returns HTTP 200");
    const csvText = exportCsvRes.rawText;

    // Check header
    check(
      csvText.includes('"Customer ID","Name","Email","Phone","Status","Joined Date","Orders Count","Total Spent (INR)"'),
      "CSV includes standard RFC compliant headers"
    );
    check(!csvText.toLowerCase().includes("passwordhash"), "CSV never includes password hash material");

    // Verify all customers are exported (no silent truncation)
    const csvLines = csvText.trim().split("\n");
    const totalCustomersInDb = await User.countDocuments({ role: UserRole.CUSTOMER });
    check(
      csvLines.length === totalCustomersInDb + 1, // +1 for header
      `CSV exports every customer document without truncation (${csvLines.length - 1} data rows for ${totalCustomersInDb} DB customers)`
    );

    // Verify formula triggers =, +, -, @, \t, \r are neutralized with leading quote
    check(csvText.includes("\"'="), "Formula trigger '=' is neutralized with leading single quote (\"'=)");
    check(csvText.includes("\"'+"), "Formula trigger '+' is neutralized with leading single quote (\"'+)");
    check(csvText.includes("\"'-"), "Formula trigger '-' is neutralized with leading single quote (\"'-)");
    check(csvText.includes("\"'@"), "Formula trigger '@' is neutralized with leading single quote (\"'@)");
    check(csvText.includes("\"'\t"), "Formula trigger tab (\\t) is neutralized with leading single quote (\"'\\t)");
    check(csvText.includes("\"'\r"), "Formula trigger carriage return (\\r) is neutralized with leading single quote (\"'\\r)");

    // Verify leading whitespace formula triggers are also neutralized
    check(csvText.includes("\"'   ="), "Leading whitespace before '=' is neutralized (\"'   =)");
    check(csvText.includes("\"'  +"), "Leading whitespace before '+' is neutralized (\"'  +)");
    check(csvText.includes("\"'  @"), "Leading whitespace before '@' is neutralized (\"'  @)");

    // Clean up test fixtures
    await mongoose.connection.db!.collection("users").deleteMany({
      _id: { $in: [admin._id, superAdmin._id, customer._id, ...maliciousUserIds, ...fixtureUsers.map((u) => u._id)] },
    });
  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\nCustomer Hardening Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runCustomerHardeningTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
