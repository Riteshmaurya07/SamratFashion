/**
 * Authentication Redirect URL Validator & Sanitizer
 *
 * Enforces strict origin and relative-path validation for post-login redirects:
 * - Accepts safe relative paths on the local origin (e.g. "/account", "/checkout", "/shop?cat=men#top")
 * - Strictly rejects external URLs (e.g. "https://evil.com", "http://attacker.com", "ftp://evil.com")
 * - Strictly rejects protocol-relative URLs (e.g. "//evil.com", "///evil.com", "////evil.com")
 * - Strictly rejects backslash / evasion URLs (e.g. "/\\evil.com", "\\evil.com", "\\\\evil.com")
 * - Strictly rejects dangerous schemes (e.g. "javascript:", "data:", "vbscript:")
 * - Strictly rejects malformed or unparseable URLs (e.g. "https://%", "http://")
 * - Falls back safely to defaultPath (default "/account")
 */
export function sanitizeLoginRedirect(
  redirect: string | null | undefined,
  defaultPath = "/account"
): string {
  if (!redirect || typeof redirect !== "string") {
    return defaultPath;
  }

  const trimmed = redirect.trim();
  if (!trimmed) {
    return defaultPath;
  }

  // Must be an internal path starting with a single '/'
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.startsWith("/\t") ||
    trimmed.startsWith("/\n") ||
    trimmed.includes("://")
  ) {
    return defaultPath;
  }

  try {
    const baseOrigin = "https://samratfashion.invalid";
    const url = new URL(trimmed, baseOrigin);

    // Must match the dummy base origin and HTTPS scheme
    if (url.origin !== baseOrigin || url.protocol !== "https:") {
      return defaultPath;
    }

    // Path must start with a single slash and not double slashes
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
      return defaultPath;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return defaultPath;
  }
}
