// Upload a backup archive to the school Drive (SCD-Hub-Backups) and apply
// tiered rotation: keep all from the last 7 days, the newest per week for the
// last 4 weeks, and the newest per month for the last 3 months — delete the
// rest. Only files with a YYYY-MM-DD date in their name are considered/deleted;
// anything else in the folder is left untouched. Plain fetch, no deps.
//
//   node scripts/drive-backup.mjs <archive-file> [folder-name]
//
// [folder-name] defaults to "SCD-Hub-Backups" (the prod Mongo archives). Pass a
// distinct folder (e.g. "SCD-Hub-Backups-GlitchTip", MON-1) to keep a separate
// rotation pool so unrelated backups never rotate against each other.
//
// Reads GOOGLE_OAUTH_* from /opt/scdhub/prod/.env.
import fs from "fs";
import path from "path";

const ENVF = "/opt/scdhub/prod/.env";
const FOLDER = process.argv[3] || "SCD-Hub-Backups";
const DAY = 86400000;

const FILE = process.argv[2];
if (!FILE || !fs.existsSync(FILE)) { console.error("usage: drive-backup.mjs <file>"); process.exit(1); }

const env = fs.readFileSync(ENVF, "utf8");
const v = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };
const CID = v("GOOGLE_OAUTH_CLIENT_ID"), CSEC = v("GOOGLE_OAUTH_CLIENT_SECRET"), CREF = v("GOOGLE_OAUTH_REFRESH_TOKEN");
if (!CID || !CSEC || !CREF) { console.error("missing GOOGLE_OAUTH_* in .env"); process.exit(1); }

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: CREF, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
async function ensureFolder(t) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const f = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: "Bearer " + t } })).json();
  if (f.files && f.files[0]) return f.files[0].id;
  const c = await (await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  })).json();
  return c.id;
}
async function upload(t, folderId) {
  const data = fs.readFileSync(FILE);
  const name = path.basename(FILE);
  const boundary = "scdhubbk" + data.length;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  if (!r.ok) throw new Error("upload " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
const weekKey = (d) => {
  const x = new Date(d), day = (x.getUTCDay() + 6) % 7;
  const th = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - day + 3));
  const y0 = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
  return th.getUTCFullYear() + "-W" + String(1 + Math.round((th - y0) / (7 * DAY))).padStart(2, "0");
};
const monthKey = (d) => { const x = new Date(d); return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0"); };

function toDelete(files, now) {
  const keep = new Set();
  const sorted = [...files].sort((a, b) => b.date - a.date);
  for (const f of sorted) if (now - f.date <= 7 * DAY) keep.add(f.id);     // daily: last 7 days
  const wk = new Map(); for (const f of sorted) if (!wk.has(weekKey(f.date))) wk.set(weekKey(f.date), f);
  [...wk.values()].sort((a, b) => b.date - a.date).slice(0, 4).forEach((f) => keep.add(f.id)); // weekly x4
  const mo = new Map(); for (const f of sorted) if (!mo.has(monthKey(f.date))) mo.set(monthKey(f.date), f);
  [...mo.values()].sort((a, b) => b.date - a.date).slice(0, 3).forEach((f) => keep.add(f.id)); // monthly x3
  return sorted.filter((f) => !keep.has(f.id)).map((f) => f.id);
}

(async () => {
  const t = await token();
  const folderId = await ensureFolder(t);
  const up = await upload(t, folderId);
  console.log("uploaded " + up.name + " (" + up.id + ")");
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const list = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`, { headers: { Authorization: "Bearer " + t } })).json();
  const files = (list.files || [])
    .map((f) => { const m = f.name.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? { id: f.id, name: f.name, date: Date.parse(m[0] + "T00:00:00Z") } : null; })
    .filter(Boolean);
  const del = toDelete(files, Date.now());
  for (const id of del) await fetch("https://www.googleapis.com/drive/v3/files/" + id, { method: "DELETE", headers: { Authorization: "Bearer " + t } });
  console.log("rotation: " + files.length + " backups, kept " + (files.length - del.length) + ", deleted " + del.length);
})().catch((e) => { console.error("drive-backup ERR", e.message); process.exit(1); });
