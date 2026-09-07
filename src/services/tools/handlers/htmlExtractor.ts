import * as cheerio from "cheerio";

/**
 * Result from extracting readable text from an HTML page
 */
export interface ExtractedPage {
  title: string;
  content: string;
  word_count: number;
  truncated: boolean;
}

/**
 * Tags to remove entirely (including content) before extracting text
 */
const REMOVE_TAGS = [
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "svg",
  "canvas",
  "video",
  "audio",
  "figure",
  "figcaption",
];

/**
 * Extract clean readable text from an HTML string.
 *
 * Removes boilerplate elements (nav, footer, scripts, styles) and returns
 * plain text up to maxLength characters.
 */
export function extractTextFromHtml(
  html: string,
  options: { selector?: string; maxLength?: number } = {},
): ExtractedPage {
  const { selector = "body", maxLength = 5000 } = options;

  const $ = cheerio.load(html);

  // Extract the page title
  const title = $("title").text().trim() || $("h1").first().text().trim() || "";

  // Remove noise elements
  $(REMOVE_TAGS.join(",")).remove();

  // Focus on the requested selector
  let root = $(selector);
  if (!root.length) {
    root = $("body");
  }

  // Extract and normalise text: collapse whitespace, remove empty lines
  let text = root
    .text()
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n") // at most two consecutive newlines
    .replace(/^\s+|\s+$/gm, "") // trim each line
    .trim();

  const word_count = text.split(/\s+/).filter(Boolean).length;

  let truncated = false;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength).trimEnd() + "…";
    truncated = true;
  }

  return { title, content: text, word_count, truncated };
}

/**
 * Validate that a URL is safe to fetch (blocks private networks, only http/https).
 * Mirrors the validation in httpRequestTool — keep in sync if that changes.
 */
export function validateFetchUrl(
  urlString: string,
): { valid: true } | { valid: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: `Invalid URL: ${urlString}` };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      valid: false,
      error: `Invalid protocol: ${parsed.protocol}. Only http and https are allowed.`,
    };
  }

  const host = parsed.hostname;

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return { valid: false, error: "Requests to localhost are not allowed." };
  }

  if (host.endsWith(".local")) {
    return {
      valid: false,
      error: "Requests to .local domains are not allowed.",
    };
  }

  if (isPrivateIP(host)) {
    return {
      valid: false,
      error: "Requests to private IP addresses are not allowed.",
    };
  }

  return { valid: true };
}

function isPrivateIP(hostname: string): boolean {
  const ipv4Patterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
  ];
  return ipv4Patterns.some((p) => p.test(hostname));
}
