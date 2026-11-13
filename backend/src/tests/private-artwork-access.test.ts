/**
 * Private customer-artwork access regression suite.
 *
 * Covers the upload/storage finding: customer artwork under
 * `samrat-fashion/custom-designs` or `custom-artwork` must never be reachable
 * through the public `/uploads` static mount, including encoded, double-encoded,
 * backslash or NUL traversal forms. Authenticated retrieval must verify design
 * ownership and keep public product images working.
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import http from "http";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { app } from "../index";
import { getPrivateArtwork } from "../controllers/uploadController";
import {
  decodeUploadPathSafely,
  isPrivateUploadPath,
  isPublicUploadPath,
  normalizeUploadRelativePath,
} from "../utils/uploadPathSecurity";
import { ImageService } from "../services/image/ImageService";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { connectSafeTestDb, createTestDesign, createTestProduct } from "./testHelpers";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, name: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = details ? `${name} — ${details}` : name;
    console.log(`  ❌ FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  sentFile?: string;
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
  setHeader(name: string, value: string): MockResponse;
  sendFile(file: string): MockResponse;
}

function createMockRes(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    sendFile(file: string) {
      this.sentFile = file;
      return this;
    },
  };
}

async function callArtwork(query: Record<string, unknown>, user?: { id: string; role?: string }) {
  const res = createMockRes();
  const req = { query, user } as unknown as Request;
  await getPrivateArtwork(req, res as unknown as Response);
  return res;
}

function httpGet(baseUrl: string, reqPath: string): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(new URL(reqPath, baseUrl), (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks), headers: res.headers })
        );
      })
      .on("error", reject);
  });
}

const stamp = Date.now();
const privateName = `private-artwork-${stamp}.png`;
const publicName = `public-product-${stamp}.png`;
const uploadsRoot = path.resolve(__dirname, "../../uploads");
const privateDir = path.join(uploadsRoot, "samrat-fashion", "custom-designs");
const publicDir = path.join(uploadsRoot, "samrat-fashion", "products");
const privateFile = path.join(privateDir, privateName);
const publicFile = path.join(publicDir, publicName);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let productId: string;
let victimDesignId: string;

async function runTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Private Artwork Access Boundary Test Suite                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();
  const attackerId = new mongoose.Types.ObjectId().toString();
  const victimId = new mongoose.Types.ObjectId().toString();

  await fs.promises.mkdir(privateDir, { recursive: true });
  await fs.promises.mkdir(publicDir, { recursive: true });
  await fs.promises.writeFile(privateFile, pngBytes);
  await fs.promises.writeFile(publicFile, pngBytes);

  try {
    const { product, productId: pid, variantIds } = await createTestProduct({
      name: "Artwork Access Tee",
      variants: [{ size: "M", color: "BLACK", stock: 10, isAvailable: true }],
    });
    productId = pid;

    const victimDesign = await createTestDesign({
      userId: victimId,
      productId: product._id,
      variantId: variantIds[0],
      name: "Victim Artwork Design",
    });
    victimDesignId = victimDesign.designId;
    const privatePublicId = `samrat-fashion/custom-designs/${privateName}`;
    await CustomDesign.updateOne(
      { _id: victimDesignId },
      {
        $set: {
          artwork: { url: `http://localhost:5000/uploads/${privatePublicId}`, publicId: privatePublicId },
          previewImage: { front: `http://localhost:5000/uploads/${privatePublicId}` },
        },
      }
    );

    // ─────────────────────────────────────────────────────────────
    console.log("[GROUP 1: Path classification]");
    {
      check(isPrivateUploadPath("samrat-fashion/custom-designs/a.png"), "1.1 raw private prefix is classified private");
      check(isPrivateUploadPath("samrat-fashion/%63ustom-designs/a.png"), "1.2 percent-encoded prefix is classified private");
      check(isPrivateUploadPath("samrat-fashion/custom-%64esigns/a.png"), "1.3 encoded directory character is classified private");
      check(isPrivateUploadPath("samrat-fashion/%2563ustom-designs/a.png"), "1.4 double-encoded prefix is classified private");
      check(isPrivateUploadPath("samrat-fashion/custom-designs/%2e%2e/%2e%2e/secrets.png"), "1.5 encoded traversal is classified private");
      check(isPrivateUploadPath("samrat-fashion/custom-designs/%252e%252e/%252e%252e/secrets.png"), "1.6 double-encoded traversal is classified private");
      check(isPrivateUploadPath("samrat-fashion\\custom-designs\\a.png"), "1.7 backslash separators fail closed");
      check(isPrivateUploadPath("samrat-fashion/custom-designs/a%00.png"), "1.8 NUL injection fails closed");
      check(isPrivateUploadPath("%"), "1.9 malformed percent-encoding fails closed");
      check(isPrivateUploadPath("samrat-fashion/products/../custom-designs/a.png"), "1.10 dot segments fail closed");

      check(isPublicUploadPath("samrat-fashion/products/a.png"), "1.11 product images remain public");
      check(isPublicUploadPath("samrat-fashion/banners/a.png"), "1.12 banner images remain public");
      check(isPublicUploadPath("samrat-fashion/custom-designs/a.png") === false, "1.13 custom designs are not public");
      check(isPublicUploadPath("samrat-fashion/%70roducts/a.png"), "1.14 encoded public prefix is recognized");
      check(normalizeUploadRelativePath("/samrat-fashion/products/a.png") === "samrat-fashion/products/a.png", "1.15 leading slash normalized");
      check(decodeUploadPathSafely("%252e%252e%252f") === "../", "1.16 repeated decoding reaches traversal form", String(decodeUploadPathSafely("%252e%252e%252f")));
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 2: Static /uploads guard over HTTP]");
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const publicRes = await httpGet(baseUrl, `/uploads/samrat-fashion/products/${publicName}`);
      check(publicRes.status === 200, "2.1 public product image is served", `status=${publicRes.status}`);
      check(publicRes.body.length === pngBytes.length, "2.2 public product image bytes are intact");

      const privateRes = await httpGet(baseUrl, `/uploads/samrat-fashion/custom-designs/${privateName}`);
      check(privateRes.status === 404, "2.3 raw private artwork path is blocked", `status=${privateRes.status}`);

      const encodedRes = await httpGet(baseUrl, `/uploads/samrat-fashion/%63ustom-designs/${privateName}`);
      check(encodedRes.status === 404, "2.4 encoded private directory is blocked", `status=${encodedRes.status}`);

      const doubleEncodedRes = await httpGet(baseUrl, `/uploads/samrat-fashion/%2563ustom-designs/${privateName}`);
      check(doubleEncodedRes.status === 404, "2.5 double-encoded private directory is blocked", `status=${doubleEncodedRes.status}`);

      const traversalRes = await httpGet(
        baseUrl,
        `/uploads/samrat-fashion/products/%2e%2e/custom-designs/${privateName}`
      );
      check(traversalRes.status === 404, "2.6 encoded traversal from public to private is blocked", `status=${traversalRes.status}`);

      const doubleTraversalRes = await httpGet(
        baseUrl,
        `/uploads/samrat-fashion/products/%252e%252e/%252e%252e/custom-designs/${privateName}`
      );
      check(doubleTraversalRes.status === 404, "2.7 double-encoded traversal is blocked", `status=${doubleTraversalRes.status}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 3: Authenticated artwork endpoint]");
    {
      const privatePublicId = `samrat-fashion/custom-designs/${privateName}`;

      const anonymous = await callArtwork({ publicId: privatePublicId });
      check(anonymous.statusCode === 401, "3.1 unauthenticated retrieval is rejected", `status=${anonymous.statusCode}`);

      const publicPath = await callArtwork(
        { publicId: `samrat-fashion/products/${publicName}` },
        { id: victimId, role: "CUSTOMER" }
      );
      check(publicPath.statusCode === 404, "3.2 the private endpoint refuses public asset paths", `status=${publicPath.statusCode}`);

      const traversal = await callArtwork(
        { publicId: `samrat-fashion/custom-designs/%2e%2e/%2e%2e/.env` },
        { id: victimId, role: "CUSTOMER" }
      );
      check(traversal.statusCode === 404, "3.3 traversal identifiers are rejected", `status=${traversal.statusCode}`);

      const crossUser = await callArtwork({ publicId: privatePublicId }, { id: attackerId, role: "CUSTOMER" });
      check(crossUser.statusCode === 404, "3.4 another customer cannot retrieve the artwork (404, no oracle)", `status=${crossUser.statusCode}`);

      const owner = await callArtwork({ publicId: privatePublicId }, { id: victimId, role: "CUSTOMER" });
      check(owner.statusCode === 200, "3.5 owner can retrieve their artwork", `status=${owner.statusCode}`);
      check(owner.sentFile === privateFile, "3.6 owner receives the contained private file", owner.sentFile);
      check(owner.headers["x-content-type-options"] === "nosniff", "3.7 nosniff header is set");
      check(/no-store/.test(owner.headers["cache-control"] || ""), "3.8 private artwork is never cached", owner.headers["cache-control"]);
      check(
        owner.headers["content-security-policy"] === "default-src 'none'; sandbox",
        "3.9 restrictive CSP is set on the response",
        owner.headers["content-security-policy"]
      );

      const ownerByUrl = await callArtwork(
        { url: `http://localhost:5000/uploads/${privatePublicId}` },
        { id: victimId, role: "CUSTOMER" }
      );
      check(ownerByUrl.statusCode === 200, "3.10 owner can retrieve by stored URL", `status=${ownerByUrl.statusCode}`);

      const admin = await callArtwork({ publicId: privatePublicId }, { id: attackerId, role: "ADMIN" });
      check(admin.statusCode === 200, "3.11 admin retrieval is allowed for support workflows", `status=${admin.statusCode}`);
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 4: Path resolution containment]");
    {
      const resolved = ImageService.resolvePrivateArtworkPath(`samrat-fashion/custom-designs/${privateName}`);
      check(resolved === privateFile, "4.1 private path resolves inside the uploads root", String(resolved));
      check(
        ImageService.resolvePrivateArtworkPath("samrat-fashion/custom-designs/../../../.env") === null,
        "4.2 traversal cannot escape the uploads root"
      );
      check(
        ImageService.resolvePrivateArtworkPath(`samrat-fashion/products/${publicName}`) === null,
        "4.3 public assets are not resolved through the private route"
      );
      check(
        ImageService.resolvePrivateArtworkPath("samrat-fashion/custom-%2564esigns/a.png") === null ||
          ImageService.resolvePrivateArtworkPath("samrat-fashion/custom-%2564esigns/a.png")!.startsWith(uploadsRoot),
        "4.4 encoded identifiers never resolve outside the uploads root"
      );
    }
  } finally {
    await CustomDesign.deleteMany({ userId: victimId });
    await Product.deleteMany({ _id: productId });
    await fs.promises.rm(privateFile, { force: true });
    await fs.promises.rm(publicFile, { force: true });
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});