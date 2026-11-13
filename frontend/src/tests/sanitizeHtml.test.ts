import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeProductDescriptionHtml } from "../lib/sanitizeHtml.ts";

test("sanitizeHtml: removes script elements and their payloads", () => {
  const cleaned = sanitizeProductDescriptionHtml('<p>Hello</p><script>alert("xss")</script>');
  assert.doesNotMatch(cleaned, /<script/i);
  assert.doesNotMatch(cleaned, /alert\(/);
  assert.match(cleaned, /<p>Hello<\/p>/);
});

test("sanitizeHtml: removes image event-handler payloads", () => {
  const cleaned = sanitizeProductDescriptionHtml('<p>Photo</p><img src=x onerror="alert(1)">');
  assert.doesNotMatch(cleaned, /<img/i);
  assert.doesNotMatch(cleaned, /onerror/i);
});

test("sanitizeHtml: strips inline event handlers and style attributes", () => {
  const cleaned = sanitizeProductDescriptionHtml(
    '<p onclick="alert(1)" style="background:url(javascript:alert(1))">Clickable</p>'
  );
  assert.doesNotMatch(cleaned, /onclick/i);
  assert.doesNotMatch(cleaned, /style=/i);
  assert.doesNotMatch(cleaned, /javascript:/i);
  assert.match(cleaned, /Clickable/);
});

test("sanitizeHtml: blocks javascript:, data: and protocol-relative links", () => {
  const cases = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    '<a href="//evil.example">x</a>',
  ];
  for (const payload of cases) {
    const cleaned = sanitizeProductDescriptionHtml(payload);
    assert.doesNotMatch(cleaned, /javascript:|data:|href="\/\//i);
  }
});

test("sanitizeHtml: removes iframe, svg, math, object, embed, form and meta payloads", () => {
  const payloads = [
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload="alert(1)"><circle r="5"></circle></svg>',
    '<math><mtext><script>alert(1)</script></mtext></math>',
    '<object data="evil.swf"></object>',
    '<embed src="evil.swf">',
    '<form action="https://evil.example"><input name="x"></form>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example">',
  ];
  for (const payload of payloads) {
    const cleaned = sanitizeProductDescriptionHtml(`<p>Safe</p>${payload}`);
    assert.doesNotMatch(cleaned, /<iframe|<svg|<math|<object|<embed|<form|<input|<meta|<base/i, payload);
    assert.match(cleaned, /<p>Safe<\/p>/);
  }
});

test("sanitizeHtml: neutralizes nested/encoded script reconstruction", () => {
  const cleaned = sanitizeProductDescriptionHtml("<scr<script>ipt>alert(1)</script>");
  assert.doesNotMatch(cleaned, /<script|onerror|javascript:/i);
});

test("sanitizeHtml: preserves safe formatting and specification tables", () => {
  const html =
    "<p>Premium <strong>cotton</strong> tee.</p>" +
    "<ul><li>Soft</li><li>Breathable</li></ul>" +
    '<table><thead><tr><th colspan="2">Size</th></tr></thead><tbody><tr><td>M</td><td>38</td></tr></tbody></table>';
  const cleaned = sanitizeProductDescriptionHtml(html);
  assert.match(cleaned, /<strong>cotton<\/strong>/);
  assert.match(cleaned, /<ul><li>Soft<\/li>/);
  assert.match(cleaned, /colspan="2"/);
});

test("sanitizeHtml: preserves safe https, mailto, tel and same-origin links", () => {
  const cleaned = sanitizeProductDescriptionHtml(
    '<p><a href="https://example.com/spec" title="Spec">Spec</a>' +
      '<a href="mailto:support@example.com">Mail</a>' +
      '<a href="tel:+919876543210">Call</a>' +
      '<a href="/size-guide">Size guide</a></p>'
  );
  assert.match(cleaned, /href="https:\/\/example.com\/spec"/);
  assert.match(cleaned, /href="mailto:support@example.com"/);
  assert.match(cleaned, /href="tel:\+919876543210"/);
  assert.match(cleaned, /href="\/size-guide"/);
});

test("sanitizeHtml: empty input returns an empty string", () => {
  assert.strictEqual(sanitizeProductDescriptionHtml(""), "");
});