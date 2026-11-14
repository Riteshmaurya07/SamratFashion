/**
 * Stored-XSS regression suite for merchant-authored product descriptions.
 *
 * Covers SF-005: descriptions are rich text rendered on the storefront, so any
 * executable markup that survives validation becomes stored XSS. The allowlist
 * must keep safe formatting while stripping scripts, event handlers, dangerous
 * URL schemes, embedded documents and SVG/MathML.
 */

import { sanitizeProductDescription, createProductSchema } from "../utils/catalogValidation";

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

function runTests(): void {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Product Description Stored-XSS Test Suite                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("[GROUP 1: Script and handler removal]");
  {
    const script = sanitizeProductDescription(`<p>Hello</p><script>alert("xss")</script>`);
    check(!/script/i.test(script), "1.1 <script> is removed", script);
    check(script.includes("Hello"), "1.2 surrounding readable text survives", script);

    const img = sanitizeProductDescription(`<p>Photo</p><img src=x onerror="alert(1)">`);
    check(!/<img/i.test(img) && !/onerror/i.test(img), "1.3 <img onerror> is removed entirely", img);

    const handler = sanitizeProductDescription(`<p onclick="alert(1)">Clickable</p>`);
    check(!/onclick/i.test(handler) && handler.includes("Clickable"), "1.4 inline event handlers are stripped", handler);

    const style = sanitizeProductDescription(`<p style="background:url(javascript:alert(1))">Styled</p>`);
    check(!/style=/i.test(style) && !/javascript:/i.test(style), "1.5 style attributes / CSS URLs are stripped", style);

    const nested = sanitizeProductDescription(`<div><span><b>Nested</b></span></div>`);
    check(!/<div|<span/i.test(nested) && /<b>Nested<\/b>/.test(nested), "1.6 disallowed wrappers are removed, safe bold kept", nested);

    const encoded = sanitizeProductDescription(`<scr<script>ipt>alert(1)</script>`);
    check(!/<script|onerror|javascript:/i.test(encoded), "1.7 nested/encoded input cannot reconstruct an executable element", encoded);
  }

  console.log("\n[GROUP 2: Embedded documents and vectors]");
  {
    const iframe = sanitizeProductDescription(`<iframe src="https://evil.example"></iframe><p>Safe</p>`);
    check(!/<iframe/i.test(iframe) && iframe.includes("Safe"), "2.1 <iframe> is removed", iframe);

    const svg = sanitizeProductDescription(`<svg onload="alert(1)"><circle r="5"></circle></svg><p>Safe</p>`);
    check(!/<svg/i.test(svg) && !/onload/i.test(svg), "2.2 SVG payloads are removed", svg);

    const math = sanitizeProductDescription(`<math><mtext><script>alert(1)</script></mtext></math>`);
    check(!/<math|<script/i.test(math), "2.3 MathML script payload is removed", math);

    const object = sanitizeProductDescription(`<object data="evil.swf"></object><embed src="evil.swf">`);
    check(!/<object|<embed/i.test(object), "2.4 object/embed payloads are removed", object);

    const form = sanitizeProductDescription(`<form action="https://evil.example"><input name="x"></form>`);
    check(!/<form|<input/i.test(form), "2.5 forms and inputs are removed", form);

    const meta = sanitizeProductDescription(`<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example">`);
    check(!/<meta|<base/i.test(meta), "2.6 meta/base tags are removed", meta);
  }

  console.log("\n[GROUP 3: URL scheme allowlist]");
  {
    const jsHref = sanitizeProductDescription(`<a href="javascript:alert(1)">Click</a>`);
    check(!/javascript:/i.test(jsHref) && jsHref.includes("Click"), "3.1 javascript: href is removed", jsHref);

    const dataHref = sanitizeProductDescription(`<a href="data:text/html;base64,PHNjcmlwdD4=">Data</a>`);
    check(!/data:/i.test(dataHref), "3.2 data: href is removed", dataHref);

    const protocolRelative = sanitizeProductDescription(`<a href="//evil.example">Evil</a>`);
    check(!/href="\/\//i.test(protocolRelative), "3.3 protocol-relative href is removed", protocolRelative);

    const safeHttps = sanitizeProductDescription(`<a href="https://example.com/spec" title="Spec">Spec</a>`);
    check(
      safeHttps.includes('href="https://example.com/spec"') && safeHttps.includes('title="Spec"'),
      "3.4 https links and title attributes are preserved",
      safeHttps
    );

    const safeRelative = sanitizeProductDescription(`<a href="/size-guide">Size guide</a>`);
    check(safeRelative.includes('href="/size-guide"'), "3.5 same-origin relative links are preserved", safeRelative);

    const mailto = sanitizeProductDescription(`<a href="mailto:support@example.com">Mail</a>`);
    check(mailto.includes('href="mailto:support@example.com"'), "3.6 mailto links are preserved", mailto);
  }

  console.log("\n[GROUP 4: Safe formatting preserved]");
  {
    const safe =
      `<p>Premium <strong>cotton</strong> tee.</p>` +
      `<ul><li>Soft</li><li>Breathable</li></ul>` +
      `<table><thead><tr><th colspan="2">Size</th></tr></thead><tbody><tr><td>M</td><td>38</td></tr></tbody></table>`;
    const cleaned = sanitizeProductDescription(safe);
    check(cleaned.includes("<strong>cotton</strong>"), "4.1 bold text preserved", cleaned);
    check(cleaned.includes("<ul><li>Soft</li>"), "4.2 lists preserved", cleaned);
    check(cleaned.includes('colspan="2"'), "4.3 table structure and colspan preserved", cleaned);
    check(cleaned.includes("<h2>") === false, "4.4 absent heading is not invented", cleaned);
  }

  console.log("\n[GROUP 5: Schema integration]");
  {
    const base = {
      name: "Sanitized Tee",
      slug: "sanitized-tee",
      images: ["https://example.com/tee.jpg"],
      categoryId: "0123456789abcdef01234567",
      basePrice: 499,
      variants: [{ sku: "SKU-1", stock: 5 }],
    };

    const parsed = createProductSchema.parse({
      ...base,
      description: `<p>Safe description</p><script>alert(1)</script><img src=x onerror=alert(1)>`,
    });
    check(
      typeof parsed.description === "string" &&
        parsed.description.includes("Safe description") &&
        !/<script|onerror|<img/i.test(parsed.description),
      "5.1 createProductSchema returns a sanitized description",
      parsed.description
    );

    let markupOnlyRejected = false;
    try {
      createProductSchema.parse({ ...base, description: `<script></script><style></style>` });
    } catch {
      markupOnlyRejected = true;
    }
    check(markupOnlyRejected, "5.2 markup-only description is rejected as unreadable");

    const plain = createProductSchema.parse({ ...base, description: "Plain text description" });
    check(plain.description === "Plain text description", "5.3 plain text description is unchanged", plain.description);
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("══════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

try {
  runTests();
} catch (err) {
  console.error("Fatal test runner error:", err);
  process.exit(1);
}