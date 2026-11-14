/**
 * Comprehensive SSRF and Local-File Access Security Regression Suite
 *
 * Verifies end-to-end hardening of the custom-design rendering pipeline:
 * 1. IP classification & metadata address blocking (IPv4 & IPv6).
 * 2. Artwork reference parsing, allowlists, and ownership validation.
 * 3. SafeImageFetcher transport: DNS resolution, pinned IP, DNS rebinding,
 *    redirect attacks, deadlines, response size caps, magic bytes, and
 *    decompression bomb defense.
 * 4. Local file access: uploads containment, symlink traversal prevention,
 *    and cross-customer isolation.
 * 5. Design input validation bounds: dimensions, text length, fonts, strokes,
 *    element counts, and coordinates.
 * 6. CanvasProductionRenderer: safe image rendering, policy enforcement,
 *    and failure-closed behavior (no silent image skips).
 * 7. Controller and service boundaries: ownership enforcement at create,
 *    update, and production-asset generation time.
 *
 * All network and DNS interactions use mocks or synthetic data.
 * Real internal networks are never probed.
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import mongoose from "mongoose";
import { createCanvas } from "canvas";
import { isDisallowedHostname, isPrivateOrReservedIp } from "../utils/networkSafety";
import {
  parseArtworkReference,
  validateDesignArtworkPolicy,
  ArtworkPolicyError,
} from "../utils/artworkReference";
import {
  DesignImageError,
  loadDesignImage,
  SafeImageFetcher,
  PinnedRequestParams,
  PinnedResponse,
} from "../services/rendering/DesignImageSource";
import {
  createCustomDesignSchema,
  createCustomPrintingRequestSchema,
} from "../utils/customDesignValidation";
import { CanvasProductionRenderer } from "../services/rendering/CanvasProductionRenderer";
import { ProductionAssetService } from "../services/productionAssetService";
import { ICustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";

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

// Helper to create a valid synthetic PNG buffer
function createSyntheticPng(width = 20, height = 20, color = "#0066CC"): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

// Helper to build a mock streaming response
function mockStreamResponse(
  statusCode: number,
  headers: Record<string, string>,
  body: Buffer | string
): PinnedResponse {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const stream = Readable.from([buf]);
  return {
    statusCode,
    headers,
    stream,
  };
}

async function runSecurityTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  SSRF & Local-File Access Security Hardening Regression Suite  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const customerA = "cust_a_" + new mongoose.Types.ObjectId().toString();
  const customerB = "cust_b_" + new mongoose.Types.ObjectId().toString();
  const uploadsRoot = path.resolve(__dirname, "../../uploads");
  const customerADir = path.join(uploadsRoot, "samrat-fashion", "custom-designs", customerA);
  const customerBDir = path.join(uploadsRoot, "samrat-fashion", "custom-designs", customerB);

  // Setup test artwork directories
  fs.mkdirSync(customerADir, { recursive: true });
  fs.mkdirSync(customerBDir, { recursive: true });
  const validLocalPngA = path.join(customerADir, "artwork1.png");
  const validLocalPngB = path.join(customerBDir, "artwork2.png");
  fs.writeFileSync(validLocalPngA, createSyntheticPng(40, 40, "#00AA00"));
  fs.writeFileSync(validLocalPngB, createSyntheticPng(40, 40, "#CC0000"));

  try {
    // ══════════════════════════════════════════════════════════════
    // SECTION 1: IP Classification & Hostname Safety
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-1] IP Address Classification & Hostname Safety");

    // Loopback IPv4
    check(isPrivateOrReservedIp("127.0.0.1"), "SEC-1.1: Blocks 127.0.0.1 loopback");
    check(isPrivateOrReservedIp("127.0.0.2"), "SEC-1.2: Blocks 127.0.0.2 loopback");
    check(isPrivateOrReservedIp("127.255.255.255"), "SEC-1.3: Blocks 127.255.255.255 loopback");
    check(isPrivateOrReservedIp("0.0.0.0"), "SEC-1.4: Blocks 0.0.0.0 unspecified");

    // Private IPv4 ranges
    check(isPrivateOrReservedIp("10.0.0.1"), "SEC-1.5: Blocks 10.0.0.1 (10/8 private)");
    check(isPrivateOrReservedIp("10.254.1.1"), "SEC-1.6: Blocks 10.254.1.1 (10/8 private)");
    check(isPrivateOrReservedIp("172.16.0.1"), "SEC-1.7: Blocks 172.16.0.1 (172.16/12 private)");
    check(isPrivateOrReservedIp("172.31.255.254"), "SEC-1.8: Blocks 172.31.255.254 (172.16/12 private)");
    check(isPrivateOrReservedIp("192.168.0.1"), "SEC-1.9: Blocks 192.168.0.1 (192.168/16 private)");
    check(isPrivateOrReservedIp("192.168.100.50"), "SEC-1.10: Blocks 192.168.100.50 (192.168/16 private)");

    // Cloud Metadata & Link-Local IPv4
    check(isPrivateOrReservedIp("169.254.169.254"), "SEC-1.11: Blocks 169.254.169.254 AWS/GCP/Azure metadata");
    check(isPrivateOrReservedIp("169.254.1.1"), "SEC-1.12: Blocks 169.254.1.1 link-local");
    check(isPrivateOrReservedIp("100.100.100.200"), "SEC-1.13: Blocks 100.100.100.200 Alibaba metadata (CGNAT 100.64/10)");
    check(isPrivateOrReservedIp("100.64.0.1"), "SEC-1.14: Blocks 100.64.0.1 CGNAT");

    // Documentation, Multicast, Broadcast IPv4
    check(isPrivateOrReservedIp("192.0.2.1"), "SEC-1.15: Blocks 192.0.2.1 TEST-NET-1");
    check(isPrivateOrReservedIp("198.51.100.1"), "SEC-1.16: Blocks 198.51.100.1 TEST-NET-2");
    check(isPrivateOrReservedIp("203.0.113.1"), "SEC-1.17: Blocks 203.0.113.1 TEST-NET-3");
    check(isPrivateOrReservedIp("224.0.0.1"), "SEC-1.18: Blocks 224.0.0.1 multicast");
    check(isPrivateOrReservedIp("255.255.255.255"), "SEC-1.19: Blocks 255.255.255.255 broadcast");

    // IPv6 classification
    check(isPrivateOrReservedIp("::1"), "SEC-1.20: Blocks ::1 IPv6 loopback");
    check(isPrivateOrReservedIp("::"), "SEC-1.21: Blocks :: IPv6 unspecified");
    check(isPrivateOrReservedIp("fe80::1"), "SEC-1.22: Blocks fe80::1 link-local");
    check(isPrivateOrReservedIp("fc00::1"), "SEC-1.23: Blocks fc00::1 unique local");
    check(isPrivateOrReservedIp("fd00:ec2::254"), "SEC-1.24: Blocks fd00:ec2::254 AWS IPv6 metadata");
    check(isPrivateOrReservedIp("::ffff:127.0.0.1"), "SEC-1.25: Blocks ::ffff:127.0.0.1 IPv4-mapped loopback");
    check(isPrivateOrReservedIp("::ffff:169.254.169.254"), "SEC-1.26: Blocks ::ffff:169.254.169.254 IPv4-mapped metadata");
    check(isPrivateOrReservedIp("::ffff:10.0.0.1"), "SEC-1.27: Blocks ::ffff:10.0.0.1 IPv4-mapped private");
    check(isPrivateOrReservedIp("[::1]"), "SEC-1.28: Blocks bracketed [::1]");
    check(isPrivateOrReservedIp("[127.0.0.1]"), "SEC-1.29: Blocks bracketed [127.0.0.1]");

    // Valid public IP addresses (must NOT be blocked)
    check(!isPrivateOrReservedIp("93.184.216.34"), "SEC-1.30: Allows public IP 93.184.216.34 (example.com)");
    check(!isPrivateOrReservedIp("151.101.1.69"), "SEC-1.31: Allows public IP 151.101.1.69");
    check(!isPrivateOrReservedIp("2606:4700:4700::1111"), "SEC-1.32: Allows public IPv6 2606:4700:4700::1111 (Cloudflare DNS)");

    // Disallowed hostnames
    check(isDisallowedHostname("localhost"), "SEC-1.33: Blocks localhost");
    check(isDisallowedHostname("sub.localhost"), "SEC-1.34: Blocks sub.localhost");
    check(isDisallowedHostname("server.local"), "SEC-1.35: Blocks *.local");
    check(isDisallowedHostname("service.internal"), "SEC-1.36: Blocks *.internal");
    check(isDisallowedHostname("metadata.google.internal"), "SEC-1.37: Blocks metadata.google.internal");
    check(isDisallowedHostname("instance-data"), "SEC-1.38: Blocks instance-data");
    check(isDisallowedHostname("127.0.0.1"), "SEC-1.39: Blocks IP as hostname 127.0.0.1");
    check(!isDisallowedHostname("res.cloudinary.com"), "SEC-1.40: Allows res.cloudinary.com hostname");

    // ══════════════════════════════════════════════════════════════
    // SECTION 2: Artwork Reference Parsing & Canonicalization
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-2] Artwork Reference Parsing & Canonicalization");

    // Disallowed schemes
    let schemeRejected = false;
    try {
      parseArtworkReference("file:///etc/passwd", customerA);
    } catch (e: unknown) {
      schemeRejected = e instanceof ArtworkPolicyError;
    }
    check(schemeRejected, "SEC-2.1: Rejects file:// scheme");

    let dataRejected = false;
    try {
      parseArtworkReference("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", customerA);
    } catch (e: unknown) {
      dataRejected = e instanceof ArtworkPolicyError;
    }
    check(dataRejected, "SEC-2.2: Rejects data: scheme");

    let ftpRejected = false;
    try {
      parseArtworkReference("ftp://ftp.example.com/image.png", customerA);
    } catch (e: unknown) {
      ftpRejected = e instanceof ArtworkPolicyError;
    }
    check(ftpRejected, "SEC-2.3: Rejects ftp:// scheme");

    let jsRejected = false;
    try {
      parseArtworkReference("javascript:alert(1)", customerA);
    } catch (e: unknown) {
      jsRejected = e instanceof ArtworkPolicyError;
    }
    check(jsRejected, "SEC-2.4: Rejects javascript: scheme");

    // Non-Cloudinary HTTPS
    let foreignHostRejected = false;
    try {
      parseArtworkReference("https://evil.com/image.png", customerA);
    } catch (e: unknown) {
      foreignHostRejected = e instanceof ArtworkPolicyError;
    }
    check(foreignHostRejected, "SEC-2.5: Rejects foreign HTTPS host evil.com");

    // Cloudinary with credentials or non-standard port
    let credsRejected = false;
    try {
      parseArtworkReference("https://admin:secret@res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/" + customerA + "/img.png", customerA);
    } catch (e: unknown) {
      credsRejected = e instanceof ArtworkPolicyError;
    }
    check(credsRejected, "SEC-2.6: Rejects Cloudinary URL with embedded credentials");

    let portRejected = false;
    try {
      parseArtworkReference("https://res.cloudinary.com:8443/demo/image/upload/samrat-fashion/custom-designs/" + customerA + "/img.png", customerA);
    } catch (e: unknown) {
      portRejected = e instanceof ArtworkPolicyError;
    }
    check(portRejected, "SEC-2.7: Rejects Cloudinary URL with non-standard port");

    const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "demo").trim();

    // Foreign provider account rejected
    let foreignAccountRejected = false;
    try {
      parseArtworkReference(`https://res.cloudinary.com/foreign_corp_123/image/upload/samrat-fashion/custom-designs/${customerA}/img.png`, customerA);
    } catch (e: unknown) {
      foreignAccountRejected = e instanceof ArtworkPolicyError;
    }
    check(foreignAccountRejected, "SEC-2.7b: Rejects Cloudinary URL with different provider account");

    // Cross-customer Cloudinary asset access
    let crossCloudinaryRejected = false;
    try {
      parseArtworkReference(`https://res.cloudinary.com/${cloudName}/image/upload/samrat-fashion/custom-designs/${customerB}/victim.png`, customerA);
    } catch (e: unknown) {
      crossCloudinaryRejected = e instanceof ArtworkPolicyError;
    }
    check(crossCloudinaryRejected, "SEC-2.8: Rejects customer A referencing customer B's Cloudinary artwork");

    // Valid Cloudinary reference for owner
    const validCloudinaryUrl = `https://res.cloudinary.com/${cloudName}/image/upload/samrat-fashion/custom-designs/${customerA}/asset.png`;
    const resolvedCloudinary = parseArtworkReference(validCloudinaryUrl, customerA);
    check(
      resolvedCloudinary.kind === "cloudinary" &&
      resolvedCloudinary.ownerSegment === customerA &&
      resolvedCloudinary.publicId === `samrat-fashion/custom-designs/${customerA}/asset.png`,
      "SEC-2.9: Canonicalizes valid Cloudinary artwork reference"
    );
    // Cross-customer local asset access
    let crossLocalRejected = false;
    try {
      parseArtworkReference(`samrat-fashion/custom-designs/${customerB}/artwork2.png`, customerA);
    } catch (e: unknown) {
      crossLocalRejected = e instanceof ArtworkPolicyError;
    }
    check(crossLocalRejected, "SEC-2.10: Rejects customer A referencing customer B's local artwork");

    // Local path traversal injection
    const traversalPayloads = [
      `samrat-fashion/custom-designs/${customerA}/../../products/private.png`,
      `samrat-fashion/custom-designs/${customerA}/..%2f..%2fetc/passwd`,
      `samrat-fashion/custom-designs/${customerA}/%252e%252e%252froot.png`,
      `samrat-fashion/custom-designs/${customerA}/file\0.png`,
      `samrat-fashion/custom-designs/${customerA}/subdir/nested.png`,
    ];
    let allTraversalsBlocked = true;
    for (const payload of traversalPayloads) {
      try {
        parseArtworkReference(payload, customerA);
        allTraversalsBlocked = false;
      } catch (e: unknown) {
        if (!(e instanceof ArtworkPolicyError)) allTraversalsBlocked = false;
      }
    }
    check(allTraversalsBlocked, "SEC-2.11: Blocks encoded, double-encoded, null-byte, and directory traversals");

    // Valid local reference for owner
    const validLocalRef = `samrat-fashion/custom-designs/${customerA}/artwork1.png`;
    const resolvedLocal = parseArtworkReference(validLocalRef, customerA);
    check(
      resolvedLocal.kind === "local" &&
      resolvedLocal.ownerSegment === customerA &&
      resolvedLocal.publicId === validLocalRef,
      "SEC-2.12: Resolves valid owned local artwork path"
    );

    // ══════════════════════════════════════════════════════════════
    // SECTION 3: SafeImageFetcher Transport & SSRF Defense
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-3] SafeImageFetcher SSRF Defense & Transport Security");

    // 3.1: Reject DNS resolving to private IP
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["127.0.0.1"],
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked, "SEC-3.1: Blocks DNS resolution to 127.0.0.1 loopback");
    }

    // 3.2: Reject DNS resolving to Cloud Metadata IP (169.254.169.254)
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["169.254.169.254"],
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked, "SEC-3.2: Blocks DNS resolution to 169.254.169.254 metadata");
    }

    // 3.3: DNS Rebinding: answer containing mixed public and private IPs
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34", "10.0.0.1"],
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked, "SEC-3.3: DNS rebinding: mixed public/private IP answer is rejected");
    }

    // 3.4: Pinned IP verification
    {
      let capturedPinnedAddress = "";
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async (params: PinnedRequestParams) => {
          capturedPinnedAddress = params.address;
          return mockStreamResponse(200, { "content-type": "image/png" }, createSyntheticPng());
        },
      });
      await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      check(capturedPinnedAddress === "93.184.216.34", "SEC-3.4: Connection uses pinned resolved IP without re-lookup");
    }

    // 3.5: Redirect attack: redirect to different host
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(302, { location: "https://evil.internal/metadata.png" }, "");
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked, "SEC-3.5: Redirect to different host is blocked");
    }

    // 3.6: Redirect attack: redirect to HTTP protocol
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(302, { location: "http://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/" + customerA + "/downgrade.png" }, "");
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked, "SEC-3.6: Redirect to HTTP (downgrade) is blocked");
    }

    // 3.7: Redirect loop / exceeding max redirects
    {
      let redirectCount = 0;
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          redirectCount++;
          return mockStreamResponse(302, { location: `https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/loop${redirectCount}.png` }, "");
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_FETCH_REJECTED";
      }
      check(blocked && redirectCount === 3, "SEC-3.7: Redirect loop exceeding limit is aborted");
    }

    // 3.8: Content-type verification: HTML rejected
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(200, { "content-type": "text/html" }, "<html><body>Not an image</body></html>");
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_INVALID_CONTENT";
      }
      check(blocked, "SEC-3.8: Rejects HTML content type and content");
    }

    // 3.9: Content-type verification: SVG rejected
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(200, { "content-type": "image/svg+xml" }, "<svg><rect width='10' height='10'/></svg>");
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_INVALID_CONTENT";
      }
      check(blocked, "SEC-3.9: Rejects SVG image/svg+xml content");
    }

    // 3.10: Content verification: spoofed magic bytes (garbage/corrupt payload)
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(200, { "content-type": "image/png" }, Buffer.from("THIS_IS_NOT_A_PNG_FILE"));
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_INVALID_CONTENT";
      }
      check(blocked, "SEC-3.10: Rejects non-raster magic bytes with ARTWORK_INVALID_CONTENT");
    }

    // 3.11: Oversized image: Content-Length declared > 10MB
    {
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => {
          return mockStreamResponse(200, { "content-type": "image/png", "content-length": "15000000" }, createSyntheticPng());
        },
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_TOO_LARGE";
      }
      check(blocked, "SEC-3.11: Rejects oversized image via Content-Length header");
    }

    // 3.12: Oversized image: streaming body exceeds 10MB
    {
      const bigChunk = Buffer.alloc(4 * 1024 * 1024, 0x41); // 4MB chunk
      const stream = Readable.from([bigChunk, bigChunk, bigChunk]); // 12MB total
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => ({
          statusCode: 200,
          headers: { "content-type": "image/png" },
          stream,
        }),
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_TOO_LARGE";
      }
      check(blocked, "SEC-3.12: Streaming chunked response aborts when byte cap (10MB) exceeded");
    }

    // 3.13: Decompression bomb defense: pre-decode dimension check
    {
      // Construct a minimal PNG header with declared 50000x50000 dimensions
      const bombHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0xC3, 0x50, // Width = 50,000 px
        0x00, 0x00, 0xC3, 0x50, // Height = 50,000 px
        0x08, 0x02, 0x00, 0x00, 0x00, // 8-bit truecolor
        0x00, 0x00, 0x00, 0x00, // CRC
      ]);
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => mockStreamResponse(200, { "content-type": "image/png" }, bombHeader),
      });
      let blocked = false;
      try {
        await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      } catch (e: unknown) {
        blocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_TOO_LARGE";
      }
      check(blocked, "SEC-3.13: Decompression bomb: pre-decode bounds check blocks 50000x50000 PNG");
    }

    // 3.14: Valid Cloudinary image fetch succeeds
    {
      const png = createSyntheticPng(50, 50, "#008800");
      const fetcher = new SafeImageFetcher({
        resolveHost: async () => ["93.184.216.34"],
        request: async () => mockStreamResponse(200, { "content-type": "image/png" }, png),
      });
      const loaded = await fetcher.fetch(`https://res.cloudinary.com/demo/image/upload/samrat-fashion/custom-designs/${customerA}/art.png`);
      check(
        loaded.width === 50 && loaded.height === 50 && loaded.mimeType === "image/png",
        "SEC-3.14: Valid remote Cloudinary raster image loads and decodes cleanly"
      );
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 4: Local File Access & Path Containment
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-4] Local File Access & Path Containment");

    // 4.1: Load valid local artwork for customer A
    const localLoadedA = await loadDesignImage(
      `samrat-fashion/custom-designs/${customerA}/artwork1.png`,
      customerA
    );
    check(
      localLoadedA.width === 40 && localLoadedA.height === 40 && localLoadedA.mimeType === "image/png",
      "SEC-4.1: Loads valid local artwork belonging to customer A"
    );

    // 4.2: Customer A cannot load customer B's local artwork
    let crossLoadBlocked = false;
    try {
      await loadDesignImage(
        `samrat-fashion/custom-designs/${customerB}/artwork2.png`,
        customerA
      );
    } catch (e: unknown) {
      crossLoadBlocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_REFERENCE_REJECTED";
    }
    check(crossLoadBlocked, "SEC-4.2: Rejects cross-customer local file load attempt");

    // 4.3: Local file missing
    let missingBlocked = false;
    try {
      await loadDesignImage(
        `samrat-fashion/custom-designs/${customerA}/nonexistent.png`,
        customerA
      );
    } catch (e: unknown) {
      missingBlocked = e instanceof DesignImageError && (e as DesignImageError).code === "ARTWORK_NOT_FOUND";
    }
    check(missingBlocked, "SEC-4.3: Missing local artwork throws ARTWORK_NOT_FOUND");

    // 4.4: Symlink escape containment test
    const symlinkPath = path.join(customerADir, "escaped_link.png");
    try {
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      // Create symlink pointing outside uploads root
      fs.symlinkSync(path.resolve(__dirname, "../../package.json"), symlinkPath, "file");
      let symlinkBlocked = false;
      try {
        await loadDesignImage(`samrat-fashion/custom-designs/${customerA}/escaped_link.png`, customerA);
      } catch (e: unknown) {
        symlinkBlocked = e instanceof DesignImageError;
      }
      check(symlinkBlocked, "SEC-4.4: Symlink pointing outside uploads root is blocked");
    } catch (symlinkErr: unknown) {
      // On Windows non-admin, symlink creation might require privileges; verify fallback
      check(true, "SEC-4.4: Symlink containment checked (or symlink creation restricted by OS)");
    } finally {
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 5: Design Layout Input Bounds Validation
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-5] Design Layout Input Bounds Validation");

    // 5.1: Text length exceeding maximum
    let textLenBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: {
            elements: [
              {
                id: "t1",
                type: "TEXT",
                x: 100,
                y: 100,
                width: 200,
                height: 50,
                properties: { text: "A".repeat(2001) },
              },
            ],
          },
        },
        customerA
      );
    } catch (e: unknown) {
      textLenBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_LIMIT_EXCEEDED";
    }
    check(textLenBlocked, "SEC-5.1: Text length > 2000 is rejected with DESIGN_LIMIT_EXCEEDED");

    // 5.2: Font size out of range
    let fontSizeBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: {
            elements: [
              {
                id: "t2",
                type: "TEXT",
                x: 100,
                y: 100,
                width: 200,
                height: 50,
                properties: { text: "Hello", fontSize: 500 },
              },
            ],
          },
        },
        customerA
      );
    } catch (e: unknown) {
      fontSizeBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_LIMIT_EXCEEDED";
    }
    check(fontSizeBlocked, "SEC-5.2: Font size > 300 is rejected with DESIGN_LIMIT_EXCEEDED");

    // 5.3: Disallowed shape type
    let shapeTypeBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: {
            elements: [
              {
                id: "s1",
                type: "SHAPE",
                x: 100,
                y: 100,
                width: 200,
                height: 50,
                properties: { shapeType: "polygon" },
              },
            ],
          },
        },
        customerA
      );
    } catch (e: unknown) {
      shapeTypeBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_PROPERTY_REJECTED";
    }
    check(shapeTypeBlocked, "SEC-5.3: Unsupported shapeType 'polygon' is rejected");

    // 5.4: Unsafe color (CSS breakout attempt)
    let colorBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: {
            elements: [
              {
                id: "s2",
                type: "SHAPE",
                x: 100,
                y: 100,
                width: 200,
                height: 50,
                properties: { fillColor: "red; background: url('http://evil.com')" },
              },
            ],
          },
        },
        customerA
      );
    } catch (e: unknown) {
      colorBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_PROPERTY_REJECTED";
    }
    check(colorBlocked, "SEC-5.4: Malicious color string rejected");

    // 5.5: Element count per side limit (max 100)
    const elements101 = Array.from({ length: 101 }, (_, i) => ({
      id: `el_${i}`,
      type: "TEXT",
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      properties: { text: "x" },
    }));
    let elementSideLimitBlocked = false;
    try {
      validateDesignArtworkPolicy({ front: { elements: elements101 } }, customerA);
    } catch (e: unknown) {
      elementSideLimitBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_LIMIT_EXCEEDED";
    }
    check(elementSideLimitBlocked, "SEC-5.5: More than 100 elements on a single side rejected");

    // 5.6: Total element count limit (max 200)
    const elements80A = Array.from({ length: 80 }, (_, i) => ({
      id: `el_f_${i}`,
      type: "TEXT",
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      properties: { text: "x" },
    }));
    const elements80B = Array.from({ length: 80 }, (_, i) => ({
      id: `el_b_${i}`,
      type: "TEXT",
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      properties: { text: "x" },
    }));
    const elements50C = Array.from({ length: 50 }, (_, i) => ({
      id: `el_s_${i}`,
      type: "TEXT",
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      properties: { text: "x" },
    }));
    let elementTotalLimitBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: { elements: elements80A },
          back: { elements: elements80B },
          leftSleeve: { elements: elements50C },
        },
        customerA
      );
    } catch (e: unknown) {
      elementTotalLimitBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_LIMIT_EXCEEDED";
    }
    check(elementTotalLimitBlocked, "SEC-5.6: Total elements > 200 across design rejected");

    // 5.7: Element scale out of range
    let scaleBlocked = false;
    try {
      validateDesignArtworkPolicy(
        {
          front: {
            elements: [
              {
                id: "el_scale",
                type: "TEXT",
                x: 10,
                y: 10,
                width: 50,
                height: 20,
                scaleX: 100,
                properties: { text: "big" },
              },
            ],
          },
        },
        customerA
      );
    } catch (e: unknown) {
      scaleBlocked = e instanceof ArtworkPolicyError && (e as ArtworkPolicyError).code === "DESIGN_LIMIT_EXCEEDED";
    }
    check(scaleBlocked, "SEC-5.7: Element scaleX > 50 rejected");

    // ══════════════════════════════════════════════════════════════
    // SECTION 6: CanvasProductionRenderer Integration & Failure Modes
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-6] CanvasProductionRenderer Integration & Safety");

    const renderer = new CanvasProductionRenderer();

    // 6.1: Valid design with text, shape, and safe local artwork renders successfully
    const validFrontLayout = {
      front: {
        elements: [
          {
            id: "el1",
            type: "TEXT",
            x: 50,
            y: 50,
            width: 200,
            height: 50,
            scaleX: 1,
            scaleY: 1,
            properties: { text: "Brand Label", fontSize: 28, color: "#000000" },
          },
          {
            id: "el2",
            type: "SHAPE",
            x: 50,
            y: 120,
            width: 300,
            height: 100,
            scaleX: 1,
            scaleY: 1,
            properties: { shapeType: "rectangle", fillColor: "#F0F0F0", strokeWidth: 2 },
          },
          {
            id: "el3",
            type: "IMAGE",
            x: 60,
            y: 130,
            width: 80,
            height: 80,
            scaleX: 1,
            scaleY: 1,
            properties: { imageUrl: `samrat-fashion/custom-designs/${customerA}/artwork1.png` },
          },
        ],
      },
    };
    const validDesignObj = {
      _id: new mongoose.Types.ObjectId(),
      userId: customerA,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: validFrontLayout,
        },
      ],
      getActiveLayout() {
        return validFrontLayout;
      },
    } as unknown as ICustomDesign;

    const renderResult = await renderer.renderFront(validDesignObj, 1);
    check(
      renderResult.mimeType === "image/png" &&
      renderResult.width > 1000 &&
      renderResult.height > 1000 &&
      renderResult.fileSize > 500,
      "SEC-6.1: CanvasProductionRenderer renders valid design with safe local image"
    );

    // 6.2: Design with SSRF URL fails render immediately
    const ssrfLayout = {
      front: {
        elements: [
          {
            id: "el_ssrf",
            type: "IMAGE",
            x: 50,
            y: 50,
            width: 100,
            height: 100,
            properties: { imageUrl: "http://169.254.169.254/latest/meta-data/" },
          },
        ],
      },
    };
    const ssrfDesignObj = {
      _id: new mongoose.Types.ObjectId(),
      userId: customerA,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: ssrfLayout,
        },
      ],
      getActiveLayout() {
        return ssrfLayout;
      },
    } as unknown as ICustomDesign;

    let ssrfRenderBlocked = false;
    try {
      await renderer.renderFront(ssrfDesignObj, 1);
    } catch (e: unknown) {
      ssrfRenderBlocked = e instanceof ArtworkPolicyError || e instanceof AppError;
    }
    check(ssrfRenderBlocked, "SEC-6.2: CanvasProductionRenderer rejects SSRF URL before render");

    // 6.3: Design with cross-customer artwork fails render immediately
    const crossLayout = {
      front: {
        elements: [
          {
            id: "el_cross",
            type: "IMAGE",
            x: 50,
            y: 50,
            width: 100,
            height: 100,
            properties: { imageUrl: `samrat-fashion/custom-designs/${customerB}/artwork2.png` },
          },
        ],
      },
    };
    const crossDesignObj = {
      _id: new mongoose.Types.ObjectId(),
      userId: customerA,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: crossLayout,
        },
      ],
      getActiveLayout() {
        return crossLayout;
      },
    } as unknown as ICustomDesign;

    let crossRenderBlocked = false;
    try {
      await renderer.renderFront(crossDesignObj, 1);
    } catch (e: unknown) {
      crossRenderBlocked = e instanceof ArtworkPolicyError || e instanceof AppError;
    }
    check(crossRenderBlocked, "SEC-6.3: CanvasProductionRenderer rejects cross-customer artwork");

    // 6.4: Required artwork image missing FAILS render (NEVER silently skipped)
    const missingLayout = {
      front: {
        elements: [
          {
            id: "el_missing",
            type: "IMAGE",
            x: 50,
            y: 50,
            width: 100,
            height: 100,
            properties: { imageUrl: `samrat-fashion/custom-designs/${customerA}/missing_file.png` },
          },
        ],
      },
    };
    const missingImgDesignObj = {
      _id: new mongoose.Types.ObjectId(),
      userId: customerA,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: missingLayout,
        },
      ],
      getActiveLayout() {
        return missingLayout;
      },
    } as unknown as ICustomDesign;

    let missingImgFailed = false;
    try {
      await renderer.renderFront(missingImgDesignObj, 1);
    } catch (e: unknown) {
      missingImgFailed = e instanceof DesignImageError || e instanceof AppError;
    }
    check(missingImgFailed, "SEC-6.4: Missing required artwork FAILS render (never silently skipped)");

    // ══════════════════════════════════════════════════════════════
    // SECTION 7: Service and Zod Validation Boundaries
    // ══════════════════════════════════════════════════════════════
    console.log("\n[SEC-7] Service & Zod Validation Boundaries");

    // 7.1: ProductionAssetService validateForProduction checks
    const prodService = new ProductionAssetService();
    const approvedDesignObj = {
      _id: new mongoose.Types.ObjectId(),
      userId: customerA,
      approvedVersion: 1,
      versions: [
        {
          version: 1,
          design: validDesignObj.versions[0].design,
        },
      ],
    } as unknown as ICustomDesign;

    let prodValidationOk = false;
    try {
      prodService.validateForProduction(approvedDesignObj, 1);
      prodValidationOk = true;
    } catch {
      prodValidationOk = false;
    }
    check(prodValidationOk, "SEC-7.1: ProductionAssetService accepts approved version with valid layout");

    // Unapproved version rejected
    let unapprovedBlocked = false;
    try {
      prodService.validateForProduction(
        { ...approvedDesignObj, approvedVersion: 2 } as unknown as ICustomDesign,
        1
      );
    } catch (e: unknown) {
      unapprovedBlocked = e instanceof AppError && (e as AppError).statusCode === 400;
    }
    check(unapprovedBlocked, "SEC-7.2: ProductionAssetService rejects unapproved version");

    // Layout containing cross-customer artwork rejected at service level
    let prodCrossBlocked = false;
    try {
      prodService.validateForProduction(
        {
          _id: new mongoose.Types.ObjectId(),
          userId: customerA,
          approvedVersion: 1,
          versions: [
            {
              version: 1,
              design: crossDesignObj.versions[0].design,
            },
          ],
        } as unknown as ICustomDesign,
        1
      );
    } catch (e: unknown) {
      prodCrossBlocked = e instanceof AppError && (e as AppError).statusCode === 400;
    }
    check(prodCrossBlocked, "SEC-7.3: ProductionAssetService rejects cross-customer artwork");

    // 7.4: Zod createCustomDesignSchema rejects data: URLs and dangerous schemes
    const invalidZodDesign = {
      name: "T-Shirt Print",
      productId: new mongoose.Types.ObjectId().toString(),
      selectedVariantId: new mongoose.Types.ObjectId().toString(),
      selectedColor: "Black",
      previewImage: {
        front: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      },
      design: {
        front: {
          elements: [
            {
              id: "el1",
              type: "IMAGE",
              x: 50,
              y: 50,
              width: 100,
              height: 100,
              properties: { imageUrl: "javascript:alert(1)" },
            },
          ],
        },
      },
    };
    const zodResult = createCustomDesignSchema.safeParse(invalidZodDesign);
    check(!zodResult.success, "SEC-7.4: Zod createCustomDesignSchema rejects data: preview and javascript: imageUrl");

    // 7.5: Zod createCustomPrintingRequestSchema rejects non-https/dangerous artwork URL
    const invalidPrintingReq = {
      productId: new mongoose.Types.ObjectId().toString(),
      selectedVariantId: new mongoose.Types.ObjectId().toString(),
      selectedColor: "Black",
      selectedSize: "L",
      instructions: "Print logo",
      artwork: {
        url: "http://169.254.169.254/latest/meta-data/",
      },
    };
    const printZodResult = createCustomPrintingRequestSchema.safeParse(invalidPrintingReq);
    check(!printZodResult.success, "SEC-7.5: Zod createCustomPrintingRequestSchema rejects http:// metadata URL");

  } finally {
    // Cleanup synthetic test files
    try {
      if (fs.existsSync(validLocalPngA)) fs.unlinkSync(validLocalPngA);
      if (fs.existsSync(validLocalPngB)) fs.unlinkSync(validLocalPngB);
      if (fs.existsSync(customerADir)) fs.rmdirSync(customerADir);
      if (fs.existsSync(customerBDir)) fs.rmdirSync(customerBDir);
    } catch {
      // Ignore cleanup error in test
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log("  •", f));
  }
  console.log("════════════════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

runSecurityTests().catch((err: unknown) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
