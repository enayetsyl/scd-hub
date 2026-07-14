// Build the self-hosted Android release APK and (optionally) publish it to the
// VM's /opt/scdhub/downloads/ where Caddy serves /downloads/* (see
// docs/app-distribution.md). Versions are read from app/app.json — the single
// source (android/app/build.gradle reads the same file at build time).
//
//   node scripts/release-apk.mjs                       # build only (default)
//   node scripts/release-apk.mjs --upload user@host    # build + scp APK & version.json
//        [--key <ssh-key-path>]                        # ssh identity (default: ~/.ssh/scdhub_vm)
//
// The SSH destination is passed on the command line and NEVER committed
// (deployment §0: domain/IP stay out of the repo). Upload order is APK first,
// version.json last — clients only see the new versionCode once the APK behind
// it is already in place. Both land via a temp name + mv (atomic swap).
//
// Requires: JDK + Android SDK (same setup used for local gradlew builds), and
// app/.env carrying the PROD EXPO_PUBLIC_API_URL — EXPO_PUBLIC_* values bake
// into the JS bundle at build time.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const APP = path.join(ROOT, "app");
const ANDROID = path.join(APP, "android");
const APK_OUT = path.join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
const REMOTE_DIR = "/opt/scdhub/downloads";

const args = process.argv.slice(2);
const uploadIx = args.indexOf("--upload");
const DEST = uploadIx >= 0 ? args[uploadIx + 1] : null;
const keyIx = args.indexOf("--key");
const KEY = keyIx >= 0 ? args[keyIx + 1] : path.join(os.homedir(), ".ssh", "scdhub_vm");
if (uploadIx >= 0 && !DEST) { console.error("usage: release-apk.mjs [--upload user@host] [--key path]"); process.exit(1); }

// --- versions from app.json (single source) ---
const expo = JSON.parse(fs.readFileSync(path.join(APP, "app.json"), "utf8")).expo;
const versionCode = expo.android?.versionCode;
const versionName = expo.version;
if (!Number.isInteger(versionCode) || !versionName) {
  console.error("app.json must carry expo.android.versionCode (int) and expo.version"); process.exit(1);
}
console.log(`Building SCD Hub v${versionName} (versionCode ${versionCode}, runtimeVersion ${expo.runtimeVersion})`);

// --- sanity: the bundle must point at prod, not localhost ---
const envFile = path.join(APP, ".env");
const appEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
const apiUrl = (appEnv.match(/^EXPO_PUBLIC_API_URL=(.*)$/m) || [])[1]?.trim();
if (!apiUrl || /localhost|127\.0\.0\.1/.test(apiUrl)) {
  console.error(`app/.env EXPO_PUBLIC_API_URL is "${apiUrl ?? "(unset)"}" — set the PROD GraphQL URL before a release build.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(ANDROID, "keystore.properties"))) {
  console.error("app/android/keystore.properties missing — the build would fall back to the DEBUG key. Aborting.");
  process.exit(1);
}

// --- build ---
// The Sentry gradle plugin uploads release source maps when SENTRY_AUTH_TOKEN is
// set; without it the upload task FAILS the build, so explicitly skip it (crash
// stacks for that release are then unsymbolicated — prefer exporting the token).
const env = { ...process.env };
if (!env.SENTRY_AUTH_TOKEN) {
  console.warn("WARN: SENTRY_AUTH_TOKEN not set — skipping Sentry source-map upload for this build.");
  env.SENTRY_DISABLE_AUTO_UPLOAD = "true";
}
const gradlew = path.join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const build = spawnSync(gradlew, ["assembleRelease"], { cwd: ANDROID, stdio: "inherit", shell: true, env });
if (build.status !== 0) { console.error("gradlew assembleRelease failed"); process.exit(1); }
if (!fs.existsSync(APK_OUT)) { console.error(`expected APK not found: ${APK_OUT}`); process.exit(1); }
const mb = (fs.statSync(APK_OUT).size / 1048576).toFixed(1);
console.log(`APK built: ${APK_OUT} (${mb} MB)`);

// --- version.json manifest (what UpdateGate polls) ---
const manifest = path.join(ANDROID, "app", "build", "outputs", "apk", "release", "version.json");
fs.writeFileSync(manifest, JSON.stringify({
  versionCode, versionName, apkUrl: "/downloads/scd-hub-latest.apk",
}, null, 2) + "\n");
console.log(`Manifest written: ${manifest}`);

if (!DEST) { console.log("Build-only run. Re-run with --upload user@host to publish."); process.exit(0); }

// --- publish: APK first, version.json last, each via temp-name + mv ---
const ssh = (cmd) => spawnSync("ssh", ["-i", KEY, DEST, cmd], { stdio: "inherit" });
const scp = (src, dst) => spawnSync("scp", ["-i", KEY, src, `${DEST}:${dst}`], { stdio: "inherit" });
const step = (label, r) => { if (r.status !== 0) { console.error(`${label} failed`); process.exit(1); } };

step("mkdir", ssh(`mkdir -p ${REMOTE_DIR}`));
step("scp apk", scp(APK_OUT, `${REMOTE_DIR}/scd-hub-latest.apk.new`));
step("swap apk", ssh(`mv -f ${REMOTE_DIR}/scd-hub-latest.apk.new ${REMOTE_DIR}/scd-hub-latest.apk && cp -f ${REMOTE_DIR}/scd-hub-latest.apk ${REMOTE_DIR}/scd-hub-${versionName}-c${versionCode}.apk`));
step("scp manifest", scp(manifest, `${REMOTE_DIR}/version.json.new`));
step("swap manifest", ssh(`mv -f ${REMOTE_DIR}/version.json.new ${REMOTE_DIR}/version.json`));
console.log(`Published v${versionName} (c${versionCode}) to ${DEST}:${REMOTE_DIR} — phones will wall on next launch.`);
