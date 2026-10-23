// Download a backup archive from the school Drive for a restore. Looks in BOTH pools —
// the hourly one (SCD-Hub-Backups-Hourly, D-#818) and the nightly one (SCD-Hub-Backups) —
// so `latest` is the newest copy that exists anywhere. Uses the GOOGLE_OAUTH_* creds in
// /opt/scdhub/prod/.env. Plain fetch.
//
//   node scripts/restore-fetch.mjs [latest|<filename>] [outPath]
//     default: latest -> /tmp/restore.archive.gz
//
// Then restore with mongorestore (see scripts/restore.md, docs/runbook-vm-rebuild.md).
import fs from "fs";

const ENVF = "/opt/scdhub/prod/.env";
const FOLDERS = ["SCD-Hub-Backups-Hourly", "SCD-Hub-Backups"];
const WHICH = process.argv[2] || "latest";
const OUT = process.argv[3] || "/tmp/restore.archive.gz";

const env = fs.readFileSync(ENVF, "utf8");
const v = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: v("GOOGLE_OAUTH_CLIENT_ID"), client_secret: v("GOOGLE_OAUTH_CLIENT_SECRET"), refresh_token: v("GOOGLE_OAUTH_REFRESH_TOKEN"), grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
(async () => {
  const t = await token();
  const get = async (q, fields) =>
    (await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(${fields})&orderBy=createdTime desc&pageSize=1`, { headers: { Authorization: "Bearer " + t } })).json()).files || [];
  const candidates = [];
  for (const name of FOLDERS) {
    const [folder] = await get(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, "id");
    if (!folder) continue;
    const q = WHICH === "latest"
      ? `'${folder.id}' in parents and trashed=false`
      : `'${folder.id}' in parents and name='${WHICH}' and trashed=false`;
    const [f] = await get(q, "id,name,createdTime");
    if (f) candidates.push({ ...f, folder: name });
  }
  if (candidates.length === 0) throw new Error("no backup matching: " + WHICH + " (looked in " + FOLDERS.join(", ") + ")");
  const file = candidates.sort((a, b) => b.createdTime.localeCompare(a.createdTime))[0];
  console.log("newest match: " + file.name + " in " + file.folder + " (created " + file.createdTime + ")");
  const dl = await fetch("https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media", { headers: { Authorization: "Bearer " + t } });
  if (!dl.ok) throw new Error("download " + dl.status);
  fs.writeFileSync(OUT, Buffer.from(await dl.arrayBuffer()));
  console.log("downloaded " + file.name + " -> " + OUT + " (" + fs.statSync(OUT).size + " bytes)");
})().catch((e) => { console.error("restore-fetch ERR", e.message); process.exit(1); });
