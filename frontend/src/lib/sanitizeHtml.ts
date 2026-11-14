import DOMPurify from "isomorphic-dompurify";

/**
 * Storefront-side defense in depth for merchant-authored product descriptions.
 *
 * The backend sanitizes on write with the same allowlist, but existing rows and
 * any future import path must not be trusted. Rendering therefore re-sanitizes
 * before injecting HTML into the PDP.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "hr",
];

const ALLOWED_ATTR = ["href", "title", "colspan", "rowspan"];

const SAFE_LINK_PROTOCOL = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

const FORBID_TAGS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "template",
];

const FORBID_ATTR = [
  "style",
  "src",
  "srcset",
  "srcdoc",
  "formaction",
  "xlink:href",
  "xmlns",
];

export function sanitizeProductDescriptionHtml(html: string): string {
  if (!html) return "";

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_LINK_PROTOCOL,
    // See the backend sanitizer: without this, DOMPurify validates numeric
    // table attributes against the URL regexp and strips colspan/rowspan.
    ADD_URI_SAFE_ATTR: ["colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOW_SELF_CLOSE_IN_ATTR: false,
    FORBID_TAGS,
    FORBID_ATTR,
    KEEP_CONTENT: true,
  });
}
