/**
 * Trusted image source for the server-side canvas renderer.
 *
 * Security invariants:
 *  - The renderer never passes a customer string to Fabric/ jsdom. It first
 *    canonicalizes the reference with `parseArtworkReference`.
 *  - Local artwork is read from disk only after ownership and path containment
 *    checks (`ImageService.resolvePrivateArtworkPath` + realpath re-check).
 *  - Cloudinary artwork is fetched from a URL rebuilt by the parser, over
 *    HTTPS, to an allowlisted host, with DNS resolved once and pinned.
 *  - Every resolved address must be public. Redirects are revalidated (same
 *    host, HTTPS, public IPs) and capped.
 *  - Bodies are size-capped and time-capped, and bytes must decode as a raster
 *    image within the configured dimension/pixel budget.
 */

import dns from "dns";
import fs from "fs";
import https from "https";
import net from "net";
import path from "path";
import { Readable } from "stream";
import {
  ArtworkPolicyError,
  CLOUDINARY_HOSTNAME,
  parseArtworkReference,
  ResolvedArtworkReference,
} from "../../utils/artworkReference";
import { DESIGN_LIMITS } from "../../utils/designRenderPolicy";
import { isDisallowedHostname, isPrivateOrReservedIp } from "../../utils/networkSafety";
import { ImageService } from "../image/ImageService";

export type DesignImageErrorCode =
  | "ARTWORK_REFERENCE_REJECTED"
  | "ARTWORK_NOT_FOUND"
  | "ARTWORK_FETCH_REJECTED"
  | "ARTWORK_TOO_LARGE"
  | "ARTWORK_INVALID_CONTENT"
  | "ARTWORK_TIMEOUT"
  | "ARTWORK_DECODE_FAILED";

export class DesignImageError extends Error {
  public readonly code: DesignImageErrorCode;

  constructor(code: DesignImageErrorCode, message: string) {
    super(message);
    this.name = "DesignImageError";
    this.code = code;
  }
}

export interface LoadedDesignImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** Decoded node-canvas image, ready for `new fabric.Image(...)`. */
  image: any;
}

export interface PinnedRequestParams {
  hostname: string;
  address: string;
  family: number;
  path: string;
  timeoutMs: number;
}

export interface PinnedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  stream: NodeJS.ReadableStream & { destroy?: (error?: Error) => void };
}

export interface ImageFetchHooks {
  resolveHost?: (hostname: string) => Promise<string[]>;
  request?: (params: PinnedRequestParams) => Promise<PinnedResponse>;
}

export interface ImageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");
const RASTER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
const EXTENSION_FALLBACKS = ["png", "jpg", "jpeg", "webp"] as const;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function fail(code: DesignImageErrorCode, message: string): never {
  throw new DesignImageError(code, message);
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

function defaultRequest(params: PinnedRequestParams): Promise<PinnedResponse> {
  return new Promise<PinnedResponse>((resolve, reject) => {
    const options: https.RequestOptions = {
      protocol: "https:",
      hostname: params.hostname,
      port: 443,
      path: params.path,
      method: "GET",
      servername: params.hostname,
      agent: false,
      headers: {
        Host: params.hostname,
        Accept: "image/png,image/jpeg,image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "SamratFashion-Renderer/1.0",
      },
      // Pin the connection to the already-validated address. Node does not
      // resolve the hostname again, which closes the DNS-rebinding window.
      lookup: (_hostname, _options, callback) => {
        callback(null, params.address, params.family);
      },
    };

    const request = https.request(options, (response) => {
      resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers as Record<string, string | string[] | undefined>,
        stream: response,
      });
    });

    request.setTimeout(params.timeoutMs, () => {
      request.destroy(new Error("Image request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function assertAllowedRemoteUrl(url: URL): void {
  if (url.protocol !== "https:") {
    fail("ARTWORK_FETCH_REJECTED", "Remote artwork must use HTTPS.");
  }
  if (url.username || url.password) {
    fail("ARTWORK_FETCH_REJECTED", "Remote artwork must not contain credentials.");
  }
  if (url.port && url.port !== "443") {
    fail("ARTWORK_FETCH_REJECTED", "Remote artwork must use the default HTTPS port.");
  }
  if (url.hostname.toLowerCase() !== CLOUDINARY_HOSTNAME) {
    fail("ARTWORK_FETCH_REJECTED", "Remote artwork host is not approved.");
  }
  if (isDisallowedHostname(url.hostname)) {
    fail("ARTWORK_FETCH_REJECTED", "Remote artwork host is not allowed.");
  }
}

function readBody(
  stream: NodeJS.ReadableStream & { destroy?: (error?: Error) => void },
  maxBytes: number,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (error: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value as Buffer);
    };

    const timer = setTimeout(() => {
      stream.destroy?.();
      finish(new DesignImageError("ARTWORK_TIMEOUT", "Artwork download timed out."));
    }, timeoutMs);

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy?.();
        finish(new DesignImageError("ARTWORK_TOO_LARGE", "Artwork exceeds the maximum download size."));
        return;
      }
      chunks.push(buffer);
    });
    stream.on("end", () => finish(null, Buffer.concat(chunks)));
    stream.on("error", () => {
      finish(new DesignImageError("ARTWORK_FETCH_REJECTED", "Artwork download failed."));
    });
  });
}

function sniffRasterMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function decodeRasterImage(buffer: Buffer): Promise<{ image: any; width: number; height: number; mimeType: string }> {
  if (buffer.length === 0) {
    fail("ARTWORK_INVALID_CONTENT", "Artwork is empty.");
  }
  if (buffer.length > DESIGN_LIMITS.MAX_IMAGE_BYTES) {
    fail("ARTWORK_TOO_LARGE", "Artwork exceeds the maximum size.");
  }

  const mimeType = sniffRasterMime(buffer);
  if (!mimeType) {
    fail("ARTWORK_INVALID_CONTENT", "Artwork is not a supported raster image.");
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadImage } = require("canvas");

  const image = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DesignImageError("ARTWORK_TIMEOUT", "Artwork decoding timed out."));
    }, DESIGN_LIMITS.IMAGE_DECODE_TIMEOUT_MS);

    Promise.resolve()
      .then(() => loadImage(buffer))
      .then((decoded: any) => {
        clearTimeout(timer);
        resolve(decoded);
      })
      .catch(() => {
        clearTimeout(timer);
        reject(new DesignImageError("ARTWORK_DECODE_FAILED", "Artwork could not be decoded."));
      });
  });

  const width = Number(image?.width);
  const height = Number(image?.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    fail("ARTWORK_INVALID_CONTENT", "Artwork dimensions are invalid.");
  }
  if (
    width > DESIGN_LIMITS.MAX_IMAGE_DIMENSION_PX ||
    height > DESIGN_LIMITS.MAX_IMAGE_DIMENSION_PX ||
    width * height > DESIGN_LIMITS.MAX_IMAGE_PIXELS
  ) {
    fail("ARTWORK_TOO_LARGE", "Artwork dimensions exceed the allowed limits.");
  }

  return { image, width, height, mimeType };
}

/**
 * Hardened fetch used for remote (Cloudinary) artwork. Public for tests so the
 * resolver/transport can be injected without touching any real network.
 */
export class SafeImageFetcher {
  private readonly resolveHost: (hostname: string) => Promise<string[]>;
  private readonly request: (params: PinnedRequestParams) => Promise<PinnedResponse>;

  constructor(hooks: ImageFetchHooks = {}) {
    this.resolveHost = hooks.resolveHost || defaultResolveHost;
    this.request = hooks.request || defaultRequest;
  }

  async fetch(rawUrl: string, options: ImageFetchOptions = {}): Promise<{
    buffer: Buffer;
    mimeType: string;
    width: number;
    height: number;
    image: any;
  }> {
    let currentUrl: URL;
    try {
      currentUrl = new URL(rawUrl);
    } catch {
      fail("ARTWORK_FETCH_REJECTED", "Artwork URL is invalid.");
    }

    const timeoutMs = options.timeoutMs ?? DESIGN_LIMITS.IMAGE_FETCH_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DESIGN_LIMITS.MAX_IMAGE_BYTES;
    const maxRedirects = options.maxRedirects ?? DESIGN_LIMITS.MAX_IMAGE_REDIRECTS;

    const originHostname = currentUrl.hostname.toLowerCase();
    const deadline = Date.now() + timeoutMs;
    let redirects = 0;

    for (;;) {
      assertAllowedRemoteUrl(currentUrl);

      if (currentUrl.hostname.toLowerCase() !== originHostname) {
        fail("ARTWORK_FETCH_REJECTED", "Artwork redirect changed host.");
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        fail("ARTWORK_TIMEOUT", "Artwork download timed out.");
      }

      const addresses = await this.resolveHost(currentUrl.hostname).catch(() => {
        fail("ARTWORK_FETCH_REJECTED", "Artwork host could not be resolved.");
      });
      if (!addresses || addresses.length === 0) {
        fail("ARTWORK_FETCH_REJECTED", "Artwork host could not be resolved.");
      }
      // Every address in the answer must be public. A mixed answer is rejected
      // rather than "picking the safe one", which prevents rebinding tricks.
      for (const address of addresses) {
        if (net.isIP(address) === 0 || isPrivateOrReservedIp(address)) {
          fail("ARTWORK_FETCH_REJECTED", "Artwork host resolves to a disallowed address.");
        }
      }

      const pinnedAddress = addresses[0];
      const family = net.isIP(pinnedAddress);

      const response = await this.request({
        hostname: currentUrl.hostname,
        address: pinnedAddress,
        family,
        path: `${currentUrl.pathname}${currentUrl.search}`,
        timeoutMs: Math.max(1, deadline - Date.now()),
      });

      if (REDIRECT_STATUSES.has(response.statusCode)) {
        const location = headerValue(response.headers, "location");
        response.stream.destroy?.();
        if (!location) {
          fail("ARTWORK_FETCH_REJECTED", "Artwork redirect had no destination.");
        }
        if (redirects >= maxRedirects) {
          fail("ARTWORK_FETCH_REJECTED", "Artwork exceeded the redirect limit.");
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          fail("ARTWORK_FETCH_REJECTED", "Artwork redirect destination is invalid.");
        }

        // Validate before following and never allow an HTTPS downgrade.
        assertAllowedRemoteUrl(nextUrl);
        if (nextUrl.hostname.toLowerCase() !== originHostname) {
          fail("ARTWORK_FETCH_REJECTED", "Artwork redirect changed host.");
        }
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.stream.destroy?.();
        fail("ARTWORK_FETCH_REJECTED", "Artwork could not be downloaded.");
      }

      const contentType = headerValue(response.headers, "content-type");
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        response.stream.destroy?.();
        fail("ARTWORK_INVALID_CONTENT", "Artwork response was not an image.");
      }

      const declaredLength = Number(headerValue(response.headers, "content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.stream.destroy?.();
        fail("ARTWORK_TOO_LARGE", "Artwork exceeds the maximum download size.");
      }

      const body = await readBody(response.stream, maxBytes, Math.max(1, deadline - Date.now()));
      return decodeRasterImage(body);
    }
  }
}

function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

async function statSafeFile(absolutePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertContainedRealPath(candidate: string): string {
  let realPath: string;
  try {
    realPath = fs.realpathSync(candidate);
  } catch {
    fail("ARTWORK_NOT_FOUND", "Artwork file was not found.");
  }
  if (realPath !== UPLOADS_ROOT && !realPath.startsWith(`${UPLOADS_ROOT}${path.sep}`)) {
    fail("ARTWORK_FETCH_REJECTED", "Artwork path escaped the uploads root.");
  }
  return realPath;
}

async function resolveLocalArtworkFile(relativePublicId: string): Promise<{ absolutePath: string; buffer: Buffer; mimeType: string }> {
  const direct = ImageService.resolvePrivateArtworkPath(relativePublicId);
  if (!direct) {
    fail("ARTWORK_REFERENCE_REJECTED", "Artwork path is not allowed.");
  }

  const directExtension = extensionOf(direct);
  const candidates: string[] = [];
  if (directExtension) {
    if (!(RASTER_EXTENSIONS as readonly string[]).includes(directExtension)) {
      fail("ARTWORK_INVALID_CONTENT", "Artwork format is not supported for rendering.");
    }
    candidates.push(direct);
  } else {
    for (const extension of EXTENSION_FALLBACKS) {
      candidates.push(`${direct}.${extension}`);
    }
  }

  for (const candidate of candidates) {
    const stat = await statSafeFile(candidate);
    if (!stat || !stat.isFile()) continue;

    if (stat.size > DESIGN_LIMITS.MAX_IMAGE_BYTES) {
      fail("ARTWORK_TOO_LARGE", "Artwork exceeds the maximum size.");
    }

    const realPath = assertContainedRealPath(candidate);
    // Re-run the containment guard against the real path so a symlink cannot
    // redirect the read outside the private artwork tree.
    if (!ImageService.resolvePrivateArtworkPath(realPath) && realPath !== UPLOADS_ROOT) {
      fail("ARTWORK_FETCH_REJECTED", "Artwork path escaped the uploads root.");
    }

    const buffer = await fs.promises.readFile(realPath);
    if (buffer.length > DESIGN_LIMITS.MAX_IMAGE_BYTES) {
      fail("ARTWORK_TOO_LARGE", "Artwork exceeds the maximum size.");
    }
    const mimeType = sniffRasterMime(buffer);
    if (!mimeType) {
      fail("ARTWORK_INVALID_CONTENT", "Artwork is not a supported raster image.");
    }
    return { absolutePath: realPath, buffer, mimeType };
  }

  fail("ARTWORK_NOT_FOUND", "Artwork file was not found.");
}

async function loadReference(reference: ResolvedArtworkReference, hooks?: ImageFetchHooks): Promise<LoadedDesignImage> {
  if (reference.kind === "local") {
    if (!reference.localRelativePath) {
      fail("ARTWORK_REFERENCE_REJECTED", "Local artwork reference is incomplete.");
    }
    const { buffer, mimeType } = await resolveLocalArtworkFile(reference.localRelativePath);
    const decoded = await decodeRasterImage(buffer);
    return { buffer, mimeType, width: decoded.width, height: decoded.height, image: decoded.image };
  }

  if (!reference.remoteUrl) {
    fail("ARTWORK_REFERENCE_REJECTED", "Remote artwork reference is incomplete.");
  }
  const fetcher = new SafeImageFetcher(hooks);
  const fetched = await fetcher.fetch(reference.remoteUrl);
  return {
    buffer: fetched.buffer,
    mimeType: fetched.mimeType,
    width: fetched.width,
    height: fetched.height,
    image: fetched.image,
  };
}

/**
 * Canonicalizes a customer reference for `ownerId` and loads it safely.
 * Throws `ArtworkPolicyError` or `DesignImageError` with generic messages that
 * never include filesystem paths or attacker-controlled URLs.
 */
export async function loadDesignImage(
  rawReference: unknown,
  ownerId: unknown,
  hooks?: ImageFetchHooks
): Promise<LoadedDesignImage> {
  let reference: ResolvedArtworkReference;
  try {
    reference = parseArtworkReference(rawReference, ownerId);
  } catch (error) {
    if (error instanceof ArtworkPolicyError) {
      throw new DesignImageError("ARTWORK_REFERENCE_REJECTED", "Artwork reference was rejected.");
    }
    throw error;
  }
  return loadReference(reference, hooks);
}

export { Readable };