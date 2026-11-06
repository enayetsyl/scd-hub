/**
 * The local API server for a help-guide capture run, with Google Drive replaced by a folder
 * on disk (prd-help-centre §5). Areas whose walk uploads files (storybook PDFs, activity-bank
 * PDFs) need it: an upload lands in the folder and later reads come back from it, so covers,
 * previews and print PDFs work without ever touching the school's Drive.
 *
 *   $env:PORT='4330'; $env:TZ='Asia/Dhaka'; $env:MONGODB_URI='mongodb://127.0.0.1:27930/hc'
 *   npx tsx scripts/help/fake-drive-server.ts            # files go to %TEMP%/help-fake-drive
 *
 * Every other googleapis.com call is refused, so a run can never reach a real Google account.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.HELP_FAKE_DRIVE || path.join(os.tmpdir(), "help-fake-drive");
fs.mkdirSync(DIR, { recursive: true });
process.env.GOOGLE_OAUTH_CLIENT_ID = "dummy";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "dummy";
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "dummy";
delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const realFetch = globalThis.fetch;
let seq = 0;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  if (url.startsWith("https://oauth2.googleapis.com/")) return json({ access_token: "fake", expires_in: 3600 });
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
    // Multipart upload: the second part is the file's bytes.
    const ct = String((init?.headers as Record<string, string>)?.["Content-Type"] ?? "");
    const boundary = ct.split("boundary=")[1];
    const body = Buffer.from(init?.body as Buffer);
    const start = body.indexOf("\r\n\r\n", body.indexOf(`--${boundary}\r\nContent-Type`, 10)) + 4;
    const end = body.lastIndexOf(`\r\n--${boundary}--`);
    seq += 1;
    const id = `fake-${Date.now()}-${seq}`;
    fs.writeFileSync(path.join(DIR, id), body.subarray(start, end));
    return json({ id });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
    const m = url.match(/files\/([^?/]+)/);
    if (m && method === "DELETE") {
      fs.rmSync(path.join(DIR, decodeURIComponent(m[1])), { force: true });
      return new Response(null, { status: 204 });
    }
    if (m && url.includes("alt=media")) return new Response(fs.readFileSync(path.join(DIR, decodeURIComponent(m[1]))), { status: 200 });
    if (method === "POST") return json({ id: "fake-folder" });
    return json({ files: [{ id: "fake-folder" }] });
  }
  if (url.includes("googleapis.com")) throw new Error(`fake-drive-server refused a Google call: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

process.argv[1] = path.resolve(__dirname, "../../src/index.ts");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("module").runMain();
