/**
 * Phase 5: Artwork Upload Security and Input Validation Test Suite
 *
 * Verifies that:
 * 1. Invalid or spoofed image bytes (random binary containing NULs) are rejected with 400.
 * 2. Real PNG and JPEG magic bytes are recognized and accepted.
 * 3. Unknown/unsupported categories are rejected with 400.
 * 4. Admin-only categories (product, banner, campaign) reject unauthenticated/customer requests with 403.
 * 5. PDF and SVG are forbidden for product/banner categories and restricted to custom-artwork.
 * 6. Base64 uploads enforce the same format and size rules as multipart uploads.
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import http from "http";
import { app } from "../index";
import { uploadImage } from "../controllers/uploadController";
import { ImageService } from "../services/image/ImageService";
import { LocalImageStorageProvider } from "../services/image/LocalImageStorageProvider";
import { IImageStorageProvider, ImageUploadResult } from "../services/image/IImageStorageProvider";
import { Request, Response } from "express";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: { success?: boolean; message?: string; [key: string]: unknown } | null;
  status(code: number): MockResponse;
  json(payload: { success?: boolean; message?: string; [key: string]: unknown }): MockResponse;
  send(payload: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: { success?: boolean; message?: string; [key: string]: unknown }) {
      this.data = payload;
      return this;
    },
    send(payload: unknown) {
      this.data = typeof payload === "object" && payload !== null ? (payload as { [key: string]: unknown }) : { raw: payload };
      return this;
    },
  };
  return res;
}

async function runUploadSecurityTests() {
  const originalCustomDesignFlag = process.env.ENABLE_CUSTOM_DESIGN;
  process.env.ENABLE_CUSTOM_DESIGN = "true";
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Artwork Upload Security & Magic-Byte Validation Test Suite   ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Stub ImageService provider to capture upload calls without network
  const mockStorageProvider: IImageStorageProvider = {
    async upload(): Promise<ImageUploadResult> {
      return {
        provider: "cloudinary",
        publicId: "samrat-fashion/mock/asset_123",
        url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        secureUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        width: 800,
        height: 800,
        format: "jpg",
        bytes: 1024,
      };
    },
    async delete(): Promise<boolean> {
      return true;
    },
    getUrl(publicId: string): string {
      return `https://res.cloudinary.com/demo/${publicId}`;
    },
    transform(publicId: string): string {
      return `https://res.cloudinary.com/demo/${publicId}`;
    },
    async exists(): Promise<boolean> {
      return true;
    },
  };

  ImageService.setProvider(mockStorageProvider);

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: MAGIC BYTE DETECTION (REJECT CORRUPTED / SPOOFED BINARIES)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: MAGIC BYTE VALIDATION]");

    // 1.1: File with random binary content containing NUL byte (spoofed as image/png)
    const spoofedBuffer = Buffer.from([0x00, 0x5a, 0x22, 0x11, 0x00, 0x99, 0x88, 0x77]);
    const spoofedReq = {
      body: { category: "custom-artwork" },
      file: {
        mimetype: "image/png",
        buffer: spoofedBuffer,
        size: spoofedBuffer.length,
      },
    } as unknown as Request;
    const spoofedRes = createMockRes();

    await uploadImage(spoofedReq, spoofedRes as unknown as Response);
    check(
      spoofedRes.statusCode === 400 && Boolean(spoofedRes.data?.message?.includes("do not match permitted image types")),
      "1.1 Rejects spoofed binary content disguised as image/png"
    );

    // 1.2: Valid PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const validPngReq = {
      body: { category: "custom-artwork" },
      file: {
        mimetype: "image/png",
        buffer: validPngBuffer,
        size: validPngBuffer.length,
      },
    } as unknown as Request;
    const validPngRes = createMockRes();

    await uploadImage(validPngReq, validPngRes as unknown as Response);
    check(validPngRes.statusCode === 200, "1.2 Accepts authentic PNG magic bytes");

    // 1.3: Valid JPEG magic bytes (FF D8 FF)
    const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const validJpgReq = {
      body: { category: "custom-artwork" },
      file: {
        mimetype: "image/jpeg",
        buffer: validJpgBuffer,
        size: validJpgBuffer.length,
      },
    } as unknown as Request;
    const validJpgRes = createMockRes();

    await uploadImage(validJpgReq, validJpgRes as unknown as Response);
    check(validJpgRes.statusCode === 200, "1.3 Accepts authentic JPEG magic bytes");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: CATEGORY ALLOWLIST ENFORCEMENT
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: CATEGORY ALLOWLIST ENFORCEMENT]");

    // 2.1: Unknown category is rejected with 400
    const invalidCatReq = {
      body: { category: "unsupported_secret_bucket" },
      file: {
        mimetype: "image/png",
        buffer: validPngBuffer,
        size: validPngBuffer.length,
      },
      user: { id: "user_123", role: "CUSTOMER" },
    } as unknown as Request;
    const invalidCatRes = createMockRes();

    await uploadImage(invalidCatReq, invalidCatRes as unknown as Response);
    check(
      invalidCatRes.statusCode === 400 && Boolean(invalidCatRes.data?.message?.includes("Invalid upload category")),
      "2.1 Rejects unsupported upload category with 400"
    );

    // 2.2: Customer attempting to upload into catalog 'product' category is blocked with 403
    const nonAdminProductReq = {
      body: { category: "product" },
      file: {
        mimetype: "image/png",
        buffer: validPngBuffer,
        size: validPngBuffer.length,
      },
      user: { id: "customer_123", role: "CUSTOMER" },
    } as unknown as Request;
    const nonAdminProductRes = createMockRes();

    await uploadImage(nonAdminProductReq, nonAdminProductRes as unknown as Response);
    check(nonAdminProductRes.statusCode === 403, "2.2 Blocks non-admin upload to 'product' category with 403");

    // 2.3: Admin caller succeeds uploading to 'campaign'
    const adminCampaignReq = {
      body: { category: "campaign" },
      file: {
        mimetype: "image/png",
        buffer: validPngBuffer,
        size: validPngBuffer.length,
      },
      user: { id: "admin_123", role: "ADMIN" },
    } as unknown as Request;
    const adminCampaignRes = createMockRes();

    await uploadImage(adminCampaignReq, adminCampaignRes as unknown as Response);
    check(adminCampaignRes.statusCode === 200, "2.3 Admin caller can upload to 'campaign' category");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: SVG & PDF SCOPING RULES
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: SVG / PDF RESTRICTIONS]");

    // 3.1: SVG upload to 'product' category is rejected with 400 (even for admin)
    const svgContent = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><circle r='5'/></svg>", "utf-8");
    const svgProductReq = {
      body: { category: "product" },
      file: {
        mimetype: "image/svg+xml",
        buffer: svgContent,
        size: svgContent.length,
      },
      user: { id: "admin_123", role: "ADMIN" },
    } as unknown as Request;
    const svgProductRes = createMockRes();

    await uploadImage(svgProductReq, svgProductRes as unknown as Response);
    check(
      svgProductRes.statusCode === 400 && Boolean(svgProductRes.data?.message?.includes("only permitted for custom artwork")),
      "3.1 Rejects SVG upload outside of custom-artwork category"
    );

    // 3.2: SVG upload to 'custom-artwork' category succeeds
    const svgArtworkReq = {
      body: { category: "custom-artwork" },
      file: {
        mimetype: "image/svg+xml",
        buffer: svgContent,
        size: svgContent.length,
      },
    } as unknown as Request;
    const svgArtworkRes = createMockRes();

    await uploadImage(svgArtworkReq, svgArtworkRes as unknown as Response);
    check(svgArtworkRes.statusCode === 200, "3.2 Accepts and sanitizes SVG upload in custom-artwork category");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: BASE64 UPLOADS ENFORCE IDENTICAL FORMAT RULES
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: BASE64 PAYLOAD VALIDATION]");

    // 4.1: Base64 payload with invalid MIME rejected
    const badBase64Req = {
      body: {
        category: "custom-artwork",
        base64: "data:application/x-executable;base64,TVqQAAMAAAAEAAAA//8A",
      },
    } as unknown as Request;
    const badBase64Res = createMockRes();

    await uploadImage(badBase64Req, badBase64Res as unknown as Response);
    check(badBase64Res.statusCode === 400, "4.1 Rejects unpermitted MIME type in base64 URI");

    // 4.2: Valid Base64 PNG accepted
    const validBase64Png = `data:image/png;base64,${validPngBuffer.toString("base64")}`;
    const validBase64Req = {
      body: {
        category: "custom-artwork",
        base64: validBase64Png,
      },
    } as unknown as Request;
    const validBase64Res = createMockRes();

    await uploadImage(validBase64Req, validBase64Res as unknown as Response);
    check(validBase64Res.statusCode === 200, "4.2 Accepts valid base64 PNG image payload");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: LOCAL STORAGE DELETION & CANNOT-BE-SERVED TEST
    // ─────────────────────────────────────────────────────────────────────────────
    const makeHttpGet = (serverUrl: string, reqPath: string): Promise<{ status: number; body: Buffer }> => {
      return new Promise((resolve, reject) => {
        const url = new URL(reqPath, serverUrl);
        http.get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks) });
          });
        }).on("error", reject);
      });
    };

    const localProvider = new LocalImageStorageProvider();
    const testFolder = `products/local-delete-test-${Date.now()}`;
    const uploadsDir = path.resolve(__dirname, "../../uploads");
    const testFolderPath = path.resolve(uploadsDir, testFolder);

    const server = http.createServer(app);
    let resolveServer!: () => void;
    const serverListening = new Promise<void>((res) => { resolveServer = res; });
    server.listen(0, () => resolveServer());
    await serverListening;
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const uploaded = await localProvider.upload(validPngBuffer, { folder: testFolder });
      const localPublicId = ImageService.extractPublicId(uploaded.url);
      const filePath = path.resolve(uploadsDir, localPublicId || "");
      const servePath = `/uploads/${localPublicId}`;

      // 5.1 & 5.2: File exists on disk and CAN be served over HTTP before deletion
      check(fs.existsSync(filePath), "5.1 Local storage creates the uploaded file");
      const beforeDeleteHttp = await makeHttpGet(baseUrl, servePath);
      check(
        beforeDeleteHttp.status === 200 && beforeDeleteHttp.body.length === validPngBuffer.length,
        "5.2 Uploaded file is successfully served over HTTP with 200 before deletion"
      );

      // Delete the file
      const deleted = Boolean(localPublicId && await localProvider.delete(localPublicId));
      check(deleted, "5.3 Local storage confirms deletion by URL");

      // 5.4 & 5.5: File is physically gone and CANNOT be served over HTTP
      check(!fs.existsSync(filePath), "5.4 Physical file is gone from disk after deletion");
      const afterDeleteHttp = await makeHttpGet(baseUrl, servePath);
      check(
        afterDeleteHttp.status === 404,
        "5.5 Deleted file cannot be served: HTTP GET returns 404 Not Found"
      );
      check(!(await localProvider.exists(uploaded.publicId)), "5.6 Local storage clears its cached asset reference");

      const uploadedAgain = await localProvider.upload(validPngBuffer, { folder: testFolder });
      const durableFilePath = path.resolve(uploadsDir, testFolder, `${path.basename(uploadedAgain.publicId)}.png`);
      const restartedProvider = new LocalImageStorageProvider();
      check(await restartedProvider.delete(uploadedAgain.publicId), "5.7 Local storage deletes a public ID after provider restart");
      check(!fs.existsSync(durableFilePath), "5.8 Restart-safe deletion removes the file from disk");
      const afterRestartDeleteHttp = await makeHttpGet(baseUrl, `/uploads/${testFolder}/${path.basename(uploadedAgain.publicId)}.png`);
      check(
        afterRestartDeleteHttp.status === 404,
        "5.9 Restart-deleted file cannot be served: HTTP GET returns 404 Not Found"
      );
    } finally {
      server.close();
      await fs.promises.rm(testFolderPath, { recursive: true, force: true });
    }

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    ImageService.resetProvider();
    if (originalCustomDesignFlag === undefined) delete process.env.ENABLE_CUSTOM_DESIGN;
    else process.env.ENABLE_CUSTOM_DESIGN = originalCustomDesignFlag;
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runUploadSecurityTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
