import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeLoginRedirect } from "../lib/authRedirect.ts";

test("authRedirect: allows safe relative paths and preserves query/hash", () => {
  assert.strictEqual(sanitizeLoginRedirect("/account"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("/checkout"), "/checkout");
  assert.strictEqual(sanitizeLoginRedirect("/shop?category=kurtas&page=2"), "/shop?category=kurtas&page=2");
  assert.strictEqual(sanitizeLoginRedirect("/orders/12345#tracking"), "/orders/12345#tracking");
  assert.strictEqual(sanitizeLoginRedirect("/"), "/");
  assert.strictEqual(sanitizeLoginRedirect("  /cart?step=shipping  "), "/cart?step=shipping");
});

test("authRedirect: falls back to default on empty, whitespace, or non-string values", () => {
  assert.strictEqual(sanitizeLoginRedirect(null), "/account");
  assert.strictEqual(sanitizeLoginRedirect(undefined), "/account");
  assert.strictEqual(sanitizeLoginRedirect(""), "/account");
  assert.strictEqual(sanitizeLoginRedirect("   "), "/account");
  assert.strictEqual(sanitizeLoginRedirect(null, "/custom-fallback"), "/custom-fallback");
  assert.strictEqual(sanitizeLoginRedirect("", "/custom-fallback"), "/custom-fallback");
});

test("authRedirect: rejects external URLs and redirects safely to default", () => {
  assert.strictEqual(sanitizeLoginRedirect("https://evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("http://evil.com/phishing"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("https://attacker.org/login"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("ftp://files.evil.com/malware"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("https://samratfashion.invalid.evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("http://192.168.1.1:8080/admin"), "/account");
});

test("authRedirect: rejects protocol-relative URLs (//) and multi-slash evasions", () => {
  assert.strictEqual(sanitizeLoginRedirect("//evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("//evil.com/account"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("//attacker.org/steal"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("///evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("////evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("//localhost:3000/account"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("  //evil.com  "), "/account");
});

test("authRedirect: rejects backslash, tab, and control character evasions", () => {
  assert.strictEqual(sanitizeLoginRedirect("/\\evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("\\evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("\\\\evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("/\\/evil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("/\tevil.com"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("/\nevil.com"), "/account");
});

test("authRedirect: rejects dangerous schemes (javascript, data, vbscript)", () => {
  assert.strictEqual(sanitizeLoginRedirect("javascript:alert(1)"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("javascript:alert(document.cookie)"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("data:text/html,<script>window.location='https://evil.com'</script>"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("vbscript:MsgBox('XSS')"), "/account");
});

test("authRedirect: rejects malformed and unparseable URLs", () => {
  assert.strictEqual(sanitizeLoginRedirect("http://"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("https://"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("https://%"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("http:///"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("ht tp://bad-url"), "/account");
  assert.strictEqual(sanitizeLoginRedirect(":::invalid-url:::"), "/account");
  assert.strictEqual(sanitizeLoginRedirect("http://[invalid-ipv6"), "/account");
});

