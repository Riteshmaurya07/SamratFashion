/**
 * Artwork reference parsing and design-policy validation.
 *
 * This module intentionally performs NO I/O. It turns an untrusted reference
 * (the value a customer stored in `properties.imageUrl`/`publicId`) into a
 * canonical, owner-scoped asset descriptor, or rejects it. The renderer then
 * loads the descriptor through `DesignImageSource`; it never fetches the raw
 * customer-supplied string.
 *
 * Two reference shapes are supported:
 *  - Local private artwork: `samrat-fashion/custom-designs/<owner>/<file>`,
 *    `/uploads/samrat-fashion/custom-designs/<owner>/<file>` or any http(s)
 *    URL that carries that `/uploads/` path. The host is ignored because the
 *    file is read from disk (never fetched).
 *  - Cloudinary: `https://res.cloudinary.com/<cloud>/image/upload/...` where
 *    the canonical publicId is still owner-scoped. The fetch URL is rebuilt
 *    from the validated publicId, not from the customer string.
 */

import { AppError } from "./AppError";
import { DESIGN_LIMITS, isFiniteNumber } from "./designRenderPolicy";
import {
  parseOwnedArtworkPublicId,
  sanitizeOwnerSegment,
} from "./uploadPathSecurity";

export type ArtworkReferenceKind = "local" | "cloudinary";

export interface ResolvedArtworkReference {
  kind: ArtworkReferenceKind;
  /** Canonical owner-scoped publicId. */
  publicId: string;
  ownerSegment: string;
  /** Present for local references; file name with or without extension. */
  localRelativePath?: string;
  /** Present for Cloudinary references; constructed from the canonical id. */
  remoteUrl?: string;
  remoteHostname?: string;
}

export type ArtworkPolicyErrorCode =
  | "ARTWORK_REFERENCE_REJECTED"
  | "DESIGN_LIMIT_EXCEEDED"
  | "DESIGN_PROPERTY_REJECTED";

export class ArtworkPolicyError extends AppError {
  public readonly code: ArtworkPolicyErrorCode;

  constructor(code: ArtworkPolicyErrorCode, message: string) {
    super(message, 400, code);
    this.name = "ArtworkPolicyError";
    this.code = code;
  }
}

export const CLOUDINARY_HOSTNAME = "res.cloudinary.com";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const CLOUD_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_UPLOADS_MARKER = "/uploads/";

function reject(message: string): never {
  throw new ArtworkPolicyError("ARTWORK_REFERENCE_REJECTED", message);
}

function stripQueryAndHash(value: string): string {
  const index = value.search(/[?#]/);
  return index >= 0 ? value.slice(0, index) : value;
}

function safeDecodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function extractLocalPublicId(raw: string): string | null {
  let value = stripQueryAndHash(raw).trim();
  const lower = value.toLowerCase();
  const markerIndex = lower.indexOf(LOCAL_UPLOADS_MARKER);
  if (markerIndex >= 0) {
    value = value.slice(markerIndex + LOCAL_UPLOADS_MARKER.length);
  } else if (lower.startsWith("uploads/")) {
    value = value.slice("uploads/".length);
  }
  value = value.replace(/^\/+/, "");
  return value.length > 0 ? value : null;
}

function resolveLocal(raw: string, ownerId: unknown): ResolvedArtworkReference {
  const candidate = extractLocalPublicId(raw);
  if (!candidate) reject("Artwork reference is not a supported local asset path.");

  const owned = parseOwnedArtworkPublicId(candidate, ownerId);
  if (!owned) reject("Artwork reference is not owned by the design owner.");

  return {
    kind: "local",
    publicId: owned.publicId,
    ownerSegment: owned.ownerSegment,
    localRelativePath: owned.publicId,
  };
}

function resolveCloudinary(url: URL, ownerId: unknown): ResolvedArtworkReference {
  if (url.protocol !== "https:") {
    reject("Remote artwork references must use HTTPS.");
  }
  if (url.username || url.password) {
    reject("Artwork references must not contain credentials.");
  }
  if (url.port && url.port !== "443") {
    reject("Artwork references must use the default HTTPS port.");
  }
  if (url.hostname.toLowerCase() !== CLOUDINARY_HOSTNAME) {
    reject("Artwork host is not an approved image provider.");
  }

  const rawSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (rawSegments.length < 5 || rawSegments[1] !== "image" || rawSegments[2] !== "upload") {
    reject("Artwork reference is not a supported image URL.");
  }

  const segments = rawSegments.map(safeDecodeSegment);
  if (segments.some((segment) => segment === null)) {
    reject("Artwork reference contains malformed encoding.");
  }
  const decoded = segments as string[];

  const cloudName = decoded[0];
  if (!CLOUD_NAME_PATTERN.test(cloudName)) {
    reject("Artwork reference has an invalid provider account.");
  }

  const configuredCloud = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  if (configuredCloud && cloudName !== configuredCloud) {
    reject("Artwork reference belongs to a different provider account.");
  }

  // Drop Cloudinary transformation/version segments and locate our canonical
  // owner-scoped publicId. We rebuild the URL afterwards, so anything before
  // the publicId is ignored.
  const rest = decoded.slice(3);
  let start = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "samrat-fashion" && rest[i + 1] === "custom-designs") {
      start = i;
      break;
    }
  }
  if (start < 0) reject("Artwork reference is not a managed customer asset.");

  const publicId = rest.slice(start).join("/");
  const owned = parseOwnedArtworkPublicId(publicId, ownerId);
  if (!owned) reject("Artwork reference is not owned by the design owner.");

  return {
    kind: "cloudinary",
    publicId: owned.publicId,
    ownerSegment: owned.ownerSegment,
    remoteUrl: `https://${CLOUDINARY_HOSTNAME}/${cloudName}/image/upload/${owned.publicId}`,
    remoteHostname: CLOUDINARY_HOSTNAME,
  };
}

/**
 * Parses a customer-supplied artwork reference for a specific owner.
 * Throws `ArtworkPolicyError` for every unsupported or foreign reference.
 */
export function parseArtworkReference(
  rawReference: unknown,
  ownerId: unknown
): ResolvedArtworkReference {
  if (!sanitizeOwnerSegment(ownerId)) {
    reject("Design owner is invalid.");
  }
  if (typeof rawReference !== "string") {
    reject("Artwork reference is missing or malformed.");
  }

  const raw = rawReference.trim();
  if (raw.length === 0 || raw.length > DESIGN_LIMITS.MAX_IMAGE_REFERENCE_LENGTH) {
    reject("Artwork reference length is not allowed.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(raw) || raw.includes("\\")) {
    reject("Artwork reference contains unsupported characters.");
  }

  if (!SCHEME_PATTERN.test(raw)) {
    return resolveLocal(raw, ownerId);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject("Artwork reference is not a valid URL.");
  }

  // Local files are read from disk, never fetched. Only http(s) URLs that
  // carry our private upload path are treated as local references.
  if (url.protocol === "http:" || url.protocol === "https:") {
    const path = `${url.pathname}${url.search}`;
    if (path.toLowerCase().includes(LOCAL_UPLOADS_MARKER)) {
      return resolveLocal(path, ownerId);
    }
    if (url.protocol === "https:") {
      return resolveCloudinary(url, ownerId);
    }
    reject("Remote artwork references must use HTTPS.");
  }

  // file:, data:, ftp:, javascript:, blob:, etc.
  reject("Artwork reference uses an unsupported URL scheme.");
}

const SIDE_KEYS = ["front", "back", "leftSleeve", "rightSleeve"] as const;

function policyReject(code: ArtworkPolicyErrorCode, message: string): never {
  throw new ArtworkPolicyError(code, message);
}

function validateElementProperties(
  type: string,
  properties: Record<string, unknown>,
  ownerId: unknown
): void {
  if (type === "IMAGE") {
    const reference = properties.imageUrl ?? properties.publicId;
    if (reference === undefined || reference === null || reference === "") {
      policyReject("DESIGN_PROPERTY_REJECTED", "Image element is missing a trusted artwork reference.");
    }
    parseArtworkReference(reference, ownerId);
    if (properties.publicId !== undefined && properties.imageUrl !== undefined) {
      // Both fields are allowed, but they must canonicalize to the same asset.
      const fromUrl = parseArtworkReference(properties.imageUrl, ownerId);
      const fromId = parseArtworkReference(properties.publicId, ownerId);
      if (fromUrl.publicId !== fromId.publicId) {
        policyReject("ARTWORK_REFERENCE_REJECTED", "Image element references two different assets.");
      }
    }
    return;
  }

  if (type === "TEXT") {
    if (properties.text !== undefined) {
      if (typeof properties.text !== "string") {
        policyReject("DESIGN_PROPERTY_REJECTED", "Text element content must be a string.");
      }
      if (properties.text.length > DESIGN_LIMITS.MAX_TEXT_LENGTH) {
        policyReject("DESIGN_LIMIT_EXCEEDED", "Text element exceeds the maximum length.");
      }
    }
    if (properties.fontSize !== undefined) {
      if (
        !isFiniteNumber(properties.fontSize) ||
        properties.fontSize < DESIGN_LIMITS.MIN_FONT_SIZE ||
        properties.fontSize > DESIGN_LIMITS.MAX_FONT_SIZE
      ) {
        policyReject("DESIGN_LIMIT_EXCEEDED", "Text element font size is out of range.");
      }
    }
    for (const colorKey of ["color", "fill"] as const) {
      if (properties[colorKey] !== undefined && !isSafeCanvasColor(properties[colorKey])) {
        policyReject("DESIGN_PROPERTY_REJECTED", "Text element colour is invalid.");
      }
    }
    return;
  }

  if (type === "SHAPE") {
    if (properties.shapeType !== undefined) {
      if (!["rectangle", "circle", "ellipse"].includes(String(properties.shapeType))) {
        policyReject("DESIGN_PROPERTY_REJECTED", "Shape type is not supported.");
      }
    }
    for (const colorKey of ["fillColor", "strokeColor"] as const) {
      if (properties[colorKey] !== undefined && !isSafeCanvasColor(properties[colorKey])) {
        policyReject("DESIGN_PROPERTY_REJECTED", "Shape colour is invalid.");
      }
    }
    if (properties.strokeWidth !== undefined) {
      if (
        !isFiniteNumber(properties.strokeWidth) ||
        properties.strokeWidth < 0 ||
        properties.strokeWidth > DESIGN_LIMITS.MAX_STROKE_WIDTH
      ) {
        policyReject("DESIGN_LIMIT_EXCEEDED", "Shape stroke width is out of range.");
      }
    }
  }
}

const SAFE_COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\(\s*[0-9.,%/\s-]+\)|transparent|currentColor)$/;

function isSafeCanvasColor(value: unknown): boolean {
  return typeof value === "string" && SAFE_COLOR_PATTERN.test(value.trim());
}

/**
 * Validates a full design layout against render limits and artwork ownership.
 * Used at production time (and safe to call at write time) so a hostile or
 * legacy layout fails closed before the renderer allocates resources.
 */
export function validateDesignArtworkPolicy(layout: unknown, ownerId: unknown): void {
  if (!sanitizeOwnerSegment(ownerId)) {
    policyReject("DESIGN_PROPERTY_REJECTED", "Design owner is invalid.");
  }
  if (!layout || typeof layout !== "object") {
    policyReject("DESIGN_PROPERTY_REJECTED", "Design layout is missing.");
  }

  const candidate = layout as Record<string, unknown>;
  let totalElements = 0;

  for (const sideKey of SIDE_KEYS) {
    const side = candidate[sideKey];
    if (side === undefined || side === null) continue;
    if (typeof side !== "object") {
      policyReject("DESIGN_PROPERTY_REJECTED", `Design side ${sideKey} is malformed.`);
    }

    const elements = (side as Record<string, unknown>).elements;
    if (elements === undefined) continue;
    if (!Array.isArray(elements)) {
      policyReject("DESIGN_PROPERTY_REJECTED", `Design side ${sideKey} has no element list.`);
    }
    if (elements.length > DESIGN_LIMITS.MAX_ELEMENTS_PER_SIDE) {
      policyReject("DESIGN_LIMIT_EXCEEDED", `Design side ${sideKey} contains too many elements.`);
    }

    totalElements += elements.length;
    if (totalElements > DESIGN_LIMITS.MAX_ELEMENTS_PER_DESIGN) {
      policyReject("DESIGN_LIMIT_EXCEEDED", "Design contains too many elements.");
    }

    for (const element of elements) {
      if (!element || typeof element !== "object") {
        policyReject("DESIGN_PROPERTY_REJECTED", "Design contains a malformed element.");
      }
      const el = element as Record<string, unknown>;
      const type = el.type;
      if (type !== "TEXT" && type !== "IMAGE" && type !== "SHAPE") {
        policyReject("DESIGN_PROPERTY_REJECTED", "Design contains an unsupported element type.");
      }

      const scaleX = isFiniteNumber(el.scaleX) ? el.scaleX : 1;
      const scaleY = isFiniteNumber(el.scaleY) ? el.scaleY : 1;
      if (scaleX < 0.01 || scaleY < 0.01 || scaleX > 50 || scaleY > 50) {
        policyReject("DESIGN_LIMIT_EXCEEDED", "Element scale is out of range.");
      }

      for (const key of ["width", "height"] as const) {
        const value = el[key];
        const scale = key === "width" ? scaleX : scaleY;
        if (!isFiniteNumber(value) || value <= 0) {
          policyReject("DESIGN_PROPERTY_REJECTED", "Element dimensions are invalid.");
        }
        if (value > DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION) {
          policyReject("DESIGN_LIMIT_EXCEEDED", "Element dimensions exceed the allowed size.");
        }
        if (value * scale > DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION) {
          policyReject("DESIGN_LIMIT_EXCEEDED", "Scaled element dimensions exceed the allowed size.");
        }
      }

      for (const key of ["x", "y"] as const) {
        const value = el[key];
        if (!isFiniteNumber(value)) {
          policyReject("DESIGN_PROPERTY_REJECTED", "Element position is invalid.");
        }
        if (Math.abs(value) > DESIGN_LIMITS.MAX_ELEMENT_OFFSET_PX) {
          policyReject("DESIGN_LIMIT_EXCEEDED", "Element position is out of printable bounds.");
        }
      }

      const properties = el.properties ?? {};
      if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
        policyReject("DESIGN_PROPERTY_REJECTED", "Element properties are malformed.");
      }
      validateElementProperties(type, properties as Record<string, unknown>, ownerId);
    }
  }
}