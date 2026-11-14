import path from "path";

/** Prefixes that may be served by the public `/uploads` static mount. */
export const PUBLIC_UPLOAD_PREFIXES = [
  "samrat-fashion/products",
  "samrat-fashion/banners",
  "samrat-fashion/reviews",
] as const;

/**
 * Customer artwork. These paths must never be reachable through the public
 * static mount, regardless of URL encoding.
 */
export const PRIVATE_UPLOAD_PREFIXES = [
  "samrat-fashion/custom-designs",
  "samrat-fashion/custom-artwork",
] as const;

export const CUSTOM_ARTWORK_PREFIX = "samrat-fashion/custom-designs";

const MAX_DECODE_PASSES = 3;
const OWNER_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Repeatedly percent-decodes a request path so `%252e%252e` and deeper encoded
 * forms cannot smuggle a traversal or private directory past the guard.
 * Returns null for malformed encodings and NUL/backslash injection.
 */
export function decodeUploadPathSafely(rawPath: string): string | null {
  if (typeof rawPath !== "string" || rawPath.length === 0) return null;

  let decoded = rawPath;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }

  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  return decoded;
}

/**
 * Normalizes a path relative to the uploads root. Any dot segment, encoded
 * separator or absolute path is rejected rather than normalized away, which
 * keeps the guard and `express.static` looking at the same logical file.
 */
export function normalizeUploadRelativePath(rawPath: string): string | null {
  const decoded = decodeUploadPathSafely(rawPath);
  if (decoded === null) return null;

  const relative = decoded.replace(/^\/+/, "");
  if (relative.length === 0) return null;

  const segments = relative.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
    return null;
  }

  const normalized = path.posix.normalize(relative);
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
}

function matchesPrefix(relativePath: string, prefixes: readonly string[]): boolean {
  const lower = relativePath.toLowerCase();
  return prefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

export function isPrivateUploadPath(rawPath: string): boolean {
  const relative = normalizeUploadRelativePath(rawPath);
  // Fail closed: an unparseable path must never fall through to public static.
  if (relative === null) return true;
  return matchesPrefix(relative, PRIVATE_UPLOAD_PREFIXES);
}

export function isPublicUploadPath(rawPath: string): boolean {
  const relative = normalizeUploadRelativePath(rawPath);
  if (relative === null) return false;
  return matchesPrefix(relative, PUBLIC_UPLOAD_PREFIXES);
}

export function isPrivateUploadId(publicId: string): boolean {
  return isPrivateUploadPath(publicId);
}

export interface OwnedArtworkPath {
  /** Canonical relative path below the uploads root, e.g. samrat-fashion/custom-designs/<owner>/asset.png */
  publicId: string;
  ownerSegment: string;
  filename: string;
}

/**
 * Normalizes a caller identifier into a single, filesystem-safe folder
 * segment. Returns null for anything that is not a short alphanumeric id so a
 * malformed id can never be used to select an arbitrary directory.
 */
export function sanitizeOwnerSegment(ownerId: unknown): string | null {
  if (typeof ownerId !== "string") return null;
  const candidate = ownerId.trim().toLowerCase();
  if (!OWNER_SEGMENT_PATTERN.test(candidate)) return null;
  return candidate;
}

/**
 * Canonical, user-scoped artwork folder for newly uploaded customer artwork.
 * Scoping by owner is what makes ownership verifiable from the publicId alone,
 * without trusting in-memory provider state.
 */
export function customArtworkFolder(ownerId: unknown): string | null {
  const ownerSegment = sanitizeOwnerSegment(ownerId);
  return ownerSegment ? `${CUSTOM_ARTWORK_PREFIX}/${ownerSegment}` : null;
}

/**
 * Parses a customer-artwork publicId and verifies that it belongs to `ownerId`.
 *
 * The layout is strictly `samrat-fashion/custom-designs/<owner>/<file>`.
 * Extra directory levels, traversal, dot files and malformed owners all fail
 * closed (null) so a caller can never select another customer's artwork by
 * passing a crafted path.
 */
export function parseOwnedArtworkPublicId(
  rawPublicId: string,
  ownerId: unknown
): OwnedArtworkPath | null {
  if (typeof rawPublicId !== "string") return null;
  const ownerSegment = sanitizeOwnerSegment(ownerId);
  if (!ownerSegment) return null;

  const normalized = normalizeUploadRelativePath(rawPublicId);
  if (!normalized) return null;

  const segments = normalized.split("/");
  if (segments.length !== 4) return null;
  if (segments[0] !== "samrat-fashion" || segments[1] !== "custom-designs") return null;
  if (segments[2].toLowerCase() !== ownerSegment) return null;

  const filename = segments[3];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename)) return null;
  if (filename.includes("..")) return null;

  return {
    publicId: `${CUSTOM_ARTWORK_PREFIX}/${ownerSegment}/${filename}`,
    ownerSegment,
    filename,
  };
}
