#!/usr/bin/env node
/**
 * Serve a prebuilt web export and pass the API through to a local server
 * (prd-help-centre §5, for local capture runs).
 *
 * Build the web app ONCE with no EXPO_PUBLIC_API_URL, so the web build calls
 * "/graphql" on its own origin:
 *   cd app && npx expo export --platform web --clear --output-dir <dir>
 * Then any number of capture runs share that build, each with its own server:
 *   node scripts/help/serve-web.cjs --dir <dir> --port 8301 --api 4301
 * The REST surfaces the app calls are proxied; every other path serves the file or the
 * single-page index.html.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const DIR = path.resolve(opt("dir", "C:/w/hc-web"));
const PORT = Number(opt("port", "8301"));
const API = Number(opt("api", "4301"));
const PROXY = /^\/(graphql|files|pdf|export|events|book-builds|triggers|healthz|readyz)(\/|\?|$)/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".ico": "image/x-icon", ".map": "application/json" };

http
  .createServer((req, res) => {
    if (PROXY.test(req.url)) {
      const up = http.request({ host: "127.0.0.1", port: API, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.on("error", () => res.destroy());
        r.pipe(res);
      });
      up.on("error", (e) => {
        // The API restarted mid-response: the headers are already out, so just drop this one.
        if (res.headersSent) return void res.destroy();
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`api ${API} unreachable: ${e.message}`);
      });
      req.pipe(up);
      return;
    }
    const clean = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(DIR, clean);
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIR, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`web ${DIR} on http://localhost:${PORT} → api :${API}`));
