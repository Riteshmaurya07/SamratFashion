/**
 * Cloudflare Turnstile CAPTCHA tests.
 *
 * This suite is network-free and database-free: Cloudflare's siteverify
 * endpoint is mocked via globalThis.fetch, and the middleware is exercised
 * through a tiny Express app instead of the full application.
 *
 * Run with: npm run test:captcha
 */

import http from "http";
import express from "express";
import { requireTurnstile } from "../middleware/turnstile";
import { verifyTurnstileToken } from "../services/turnstileService";
import { errorHandler } from "../middleware/errorHandler";

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

const originalFetch = globalThis.fetch;
const envSnapshot = {
  TURNSTILE_ENABLED: process.env.TURNSTILE_ENABLED,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  TURNSTILE_FAIL_OPEN: process.env.TURNSTILE_FAIL_OPEN,
  NODE_ENV: process.env.NODE_ENV,
};

let fetchCalls = 0;

function mockFetch(
  handler: (url: string, init?: any) => Promise<any>
): void {
  fetchCalls = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    fetchCalls++;
    return handler(String(input), init);
  }) as any;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function jsonResponse(status: number, body: unknown): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function runServiceTests(): Promise<void> {
  console.log("\n[TEST GROUP 1: server-side siteverify handling]");

  process.env.TURNSTILE_SECRET_KEY = "test-secret";

  // Missing token: rejected without calling Cloudflare.
  restoreFetch();
  check(
    (await verifyTurnstileToken(undefined)) === false,
    "Missing token is rejected"
  );
  check(
    (await verifyTurnstileToken("")) === false,
    "Empty token is rejected"
  );

  // Successful verification and correct form encoding.
  let capturedBody = "";
  let capturedUrl = "";
  mockFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = String(init?.body ?? "");
    return jsonResponse(200, { success: true, action: "login" });
  });
  check(
    (await verifyTurnstileToken("valid-token", { expectedAction: "login" })) === true,
    "Cloudflare success returns true"
  );
  check(
    capturedUrl === "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "Verification calls Cloudflare's siteverify endpoint"
  );
  check(
    capturedBody.includes("secret=test-secret") &&
      capturedBody.includes("response=valid-token"),
    "Verification posts the secret and token"
  );

  // Remote IP forwarding.
  mockFetch(async (_url, init) => {
    capturedBody = String(init?.body ?? "");
    return jsonResponse(200, { success: true, action: "login" });
  });
  await verifyTurnstileToken("valid-token", {
    expectedAction: "login",
    remoteIp: "203.0.113.9",
  });
  check(
    capturedBody.includes("remoteip=203.0.113.9"),
    "Verification forwards the client IP when provided"
  );

  // Action mismatch is rejected.
  mockFetch(async () => jsonResponse(200, { success: true, action: "register" }));
  check(
    (await verifyTurnstileToken("valid-token", { expectedAction: "login" })) === false,
    "Token minted for a different form action is rejected"
  );

  // Cloudflare says the token is invalid.
  mockFetch(async () =>
    jsonResponse(200, { success: false, "error-codes": ["invalid-input-response"] })
  );
  check(
    (await verifyTurnstileToken("used-token")) === false,
    "Cloudflare rejection returns false"
  );

  // Non-2xx response fails closed by default.
  process.env.TURNSTILE_FAIL_OPEN = "false";
  mockFetch(async () => jsonResponse(500, {}));
  check(
    (await verifyTurnstileToken("token")) === false,
    "Cloudflare HTTP error fails closed by default"
  );

  // Network error fails closed by default.
  mockFetch(async () => {
    throw new Error("network down");
  });
  check(
    (await verifyTurnstileToken("token")) === false,
    "Network error fails closed by default"
  );

  // Explicit emergency escape hatch.
  process.env.TURNSTILE_FAIL_OPEN = "true";
  mockFetch(async () => jsonResponse(500, {}));
  check(
    (await verifyTurnstileToken("token")) === true,
    "TURNSTILE_FAIL_OPEN=true fails open on Cloudflare HTTP error"
  );
  process.env.TURNSTILE_FAIL_OPEN = "false";

  // Missing secret is always rejected.
  delete process.env.TURNSTILE_SECRET_KEY;
  mockFetch(async () => jsonResponse(200, { success: true }));
  check(
    (await verifyTurnstileToken("token")) === false,
    "Missing TURNSTILE_SECRET_KEY is rejected"
  );
  check(fetchCalls === 0, "No Cloudflare request is made without a secret");

  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  restoreFetch();
}

interface HttpResponse {
  status: number;
  body: any;
}

function request(
  serverUrl: string,
  path: string,
  body?: unknown
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const headers: Record<string, string> = {};
    let payload = "";

    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const req = http.request(url, { method: "POST", headers }, (res) => {
      let resData = "";
      res.on("data", (chunk) => {
        resData += chunk;
      });
      res.on("end", () => {
        let parsed: any = null;
        try {
          parsed = resData ? JSON.parse(resData) : null;
        } catch {
          parsed = resData;
        }
        resolve({ status: res.statusCode || 500, body: parsed });
      });
    });

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runMiddlewareTests(): Promise<void> {
  console.log("\n[TEST GROUP 2: requireTurnstile middleware]");

  const app = express();
  app.use(express.json());
  app.post("/login", requireTurnstile("login"), (_req, res) => {
    res.json({ success: true });
  });
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    // Disabled: no token needed, no Cloudflare call.
    delete process.env.TURNSTILE_ENABLED;
    restoreFetch();
    let res = await request(serverUrl, "/login", { email: "a@example.com" });
    check(res.status === 200, "CAPTCHA disabled: request passes without a token");

    // Enabled + missing token.
    process.env.TURNSTILE_ENABLED = "true";
    mockFetch(async () => jsonResponse(200, { success: true }));
    res = await request(serverUrl, "/login", { email: "a@example.com" });
    check(res.status === 400, "CAPTCHA enabled: missing token returns HTTP 400");
    check(res.body?.code === "CAPTCHA_REQUIRED", "Missing token code is CAPTCHA_REQUIRED");
    check(fetchCalls === 0, "Missing token is rejected before contacting Cloudflare");

    // Enabled + valid token.
    mockFetch(async (_url, init) => {
      const body = String(init?.body ?? "");
      if (!body.includes("response=middleware-token")) {
        return jsonResponse(200, { success: false });
      }
      return jsonResponse(200, { success: true, action: "login" });
    });
    res = await request(serverUrl, "/login", {
      email: "a@example.com",
      captchaToken: "middleware-token",
    });
    check(res.status === 200, "CAPTCHA enabled: valid token lets the request through");
    check(fetchCalls === 1, "Valid token triggers exactly one Cloudflare verification");

    // Enabled + rejected token.
    mockFetch(async () =>
      jsonResponse(200, { success: false, "error-codes": ["invalid-input-response"] })
    );
    res = await request(serverUrl, "/login", {
      email: "a@example.com",
      captchaToken: "bad-token",
    });
    check(res.status === 400, "CAPTCHA enabled: rejected token returns HTTP 400");
    check(res.body?.code === "CAPTCHA_FAILED", "Rejected token code is CAPTCHA_FAILED");
  } finally {
    server.close();
  }
}

async function run(): Promise<void> {
  process.env.NODE_ENV = "test";
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  Cloudflare Turnstile CAPTCHA: verification + route protection    ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");

  try {
    await runServiceTests();
    await runMiddlewareTests();
  } finally {
    restoreFetch();
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  console.log(`\nTurnstile CAPTCHA Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Turnstile CAPTCHA test execution failed:", err);
  process.exit(1);
});
