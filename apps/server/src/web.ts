import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Scripts come from this origin only. Styles may also be set through the style attribute, which the dialog
// library uses for positioning. Images may also come from other sites over HTTPS: the content of a feed
// article has them. The page may not be framed, and links and images of other sites carry no referrer.
const PAGE_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "cache-control": "no-cache",
};

const NOT_BUILT = `The web app is not built yet. Run this in the repository, then reload:

  pnpm build

The API and the feeds work without it.
`;

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);
/** Compressed bodies by path and modification time: the files are few and change only on a new build. */
const gzipCache = new Map<string, Buffer>();

/** The file's bytes, gzipped for text formats when the browser accepts that. */
function body(path: string, acceptEncoding: string): { bytes: Buffer; gzip: boolean } {
  if (!COMPRESSIBLE.has(extname(path)) || !/\bgzip\b/.test(acceptEncoding)) return { bytes: readFileSync(path), gzip: false };
  const key = `${path}:${statSync(path).mtimeMs}`;
  let bytes = gzipCache.get(key);
  if (!bytes) {
    bytes = gzipSync(readFileSync(path));
    gzipCache.set(key, bytes);
  }
  return { bytes, gzip: true };
}

function file(path: string, cacheControl: string, acceptEncoding: string, extra: Record<string, string> = {}): Response {
  const { bytes, gzip } = body(path, acceptEncoding);
  // The cast bridges Node's Buffer and the DOM's BodyInit, which the web app's type check applies to this file.
  return new Response(bytes as unknown as ConstructorParameters<typeof Response>[0], {
    headers: {
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      ...(gzip ? { "content-encoding": "gzip", vary: "Accept-Encoding" } : {}),
      ...extra,
    },
  });
}

/**
 * Answers a GET that no API or feed route took: a built file, or the page itself for any path the app
 * routes on its own. Returns null when the path is not found.
 */
export function serveWeb(webDir: string | undefined, pathname: string, acceptEncoding = ""): Response | null {
  const indexPath = webDir ? join(webDir, "index.html") : null;
  if (!webDir || !indexPath || !existsSync(indexPath)) {
    return new Response(NOT_BUILT, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = resolve(webDir);
  const target = resolve(root, `.${decoded}`);
  const inside = target === root || target.startsWith(root + sep);
  const isFile = inside && existsSync(target) && statSync(target).isFile();

  if (decoded.startsWith("/assets/")) {
    // Asset names carry a content hash, so a browser may keep them for a year.
    return isFile ? file(target, "public, max-age=31536000, immutable", acceptEncoding) : null;
  }
  if (isFile && target !== indexPath) return file(target, "no-cache", acceptEncoding);
  return file(indexPath, PAGE_HEADERS["cache-control"], acceptEncoding, PAGE_HEADERS);
}
