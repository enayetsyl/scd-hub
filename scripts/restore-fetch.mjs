// Download a backup archive from the school Drive (SCD-Hub-Backups) for a
// restore. Uses the GOOGLE_OAUTH_* creds in /opt/scdhub/prod/.env. Plain fetch.
//
//   node scripts/restore-fetch.mjs [latest|<filename>] [outPath]
//     default: latest -> /tmp/restore.archive.gz
//
// Then restore with mongorestore (see scripts/restore.md).
import fs from "fs";

const ENVF = "/opt/scdhub/prod/.env";
const FOLDER = "SCD-Hub-Backups";
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
  const fq = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const fol = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${fq}&fields=files(id)`, { headers: { Authorization: "Bearer " + t } })).json();
  if (!fol.files || !fol.files[0]) throw new Error("backup folder not found");
  const folderId = fol.files[0].id;
  let file;
  if (WHICH === "latest") {
    const lq = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const list = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${lq}&fields=files(id,name)&orderBy=createdTime desc&pageSize=1`, { headers: { Authorization: "Bearer " + t } })).json();
    file = list.files && list.files[0];
  } else {
    const nq = encodeURIComponent(`'${folderId}' in parents and name='${WHICH}' and trashed=false`);
    const list = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${nq}&fields=files(id,name)`, { headers: { Authorization: "Bearer " + t } })).json();
    file = list.files && list.files[0];
  }
  if (!file) throw new Error("no backup matching: " + WHICH);
  const dl = await fetch("https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media", { headers: { Authorization: "Bearer " + t } });
  if (!dl.ok) throw new Error("download " + dl.status);
  fs.writeFileSync(OUT, Buffer.from(await dl.arrayBuffer()));
  console.log("downloaded " + file.name + " -> " + OUT + " (" + fs.statSync(OUT).size + " bytes)");
})().catch((e) => { console.error("restore-fetch ERR", e.message); process.exit(1); });
