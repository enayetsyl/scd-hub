// Email an ops alert to ALERT_EMAIL (comma list) through ALERT_SMTP_URL, both read from
// /opt/scdhub/prod/.env. Used by backup.sh and host-alert.sh (DB-on-VM plan, Phase 2).
//
//   node scripts/send-alert.mjs "<subject>" "<body>"
//
// ALERT_SMTP_URL is the same account GlitchTip sends with, e.g.
//   smtp+ssl://user%40domain:app-password@smtp.gmail.com:465   (implicit TLS)
//   smtp://user%40domain:app-password@smtp.gmail.com:587       (STARTTLS)
// Sent with curl (no npm deps). The password goes to curl through a mode-600 config file,
// never on the command line, so it does not show in `ps`. Exit 0 when not configured:
// a missing mailer must never turn a backup into a failed cron run.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const ENVF = "/opt/scdhub/prod/.env";
const [subject = "[scdhub] alert", body = ""] = process.argv.slice(2);

const env = fs.existsSync(ENVF) ? fs.readFileSync(ENVF, "utf8") : "";
const v = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const to = v("ALERT_EMAIL").split(",").map((s) => s.trim()).filter(Boolean);
const smtp = v("ALERT_SMTP_URL");
if (to.length === 0 || !smtp) {
  console.log("[send-alert] ALERT_EMAIL / ALERT_SMTP_URL not set - not emailed: " + subject);
  process.exit(0);
}

let u;
try { u = new URL(smtp); } catch { console.error("[send-alert] ALERT_SMTP_URL is not a URL"); process.exit(1); }
const implicitTls = u.protocol === "smtp+ssl:" || u.protocol === "smtps:";
const port = u.port || (implicitTls ? "465" : "587");
const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);
const curlUrl = `${implicitTls ? "smtps" : "smtp"}://${u.hostname}:${port}`;

const message = [
  `From: SCD Hub alerts <${user}>`,
  `To: ${to.join(", ")}`,
  `Subject: ${subject}`,
  `Date: ${new Date().toUTCString()}`,
  "Content-Type: text/plain; charset=UTF-8",
  "",
  body,
  "",
  `-- sent by ${os.hostname()} at ${new Date().toISOString()}`,
].join("\r\n");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alert-"));
const cfg = path.join(dir, "curl.cfg");
try {
  fs.writeFileSync(cfg, `user = "${user.replace(/"/g, '\\"')}:${pass.replace(/"/g, '\\"')}"\n`, { mode: 0o600 });
  const args = ["-sS", "--ssl-reqd", "--max-time", "30", "--url", curlUrl, "-K", cfg,
    "--mail-from", user, ...to.flatMap((r) => ["--mail-rcpt", r]), "--upload-file", "-"];
  const r = spawnSync("curl", args, { input: message, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`[send-alert] curl failed (${r.status}): ${(r.stderr || "").trim().slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`[send-alert] sent to ${to.length} recipient(s): ${subject}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
