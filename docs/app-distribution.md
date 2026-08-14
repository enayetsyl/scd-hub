# App distribution — self-hosted Android (no Play Store)

The Android app is distributed from our own website: the login page links to
`/downloads/scd-hub-latest.apk`, served by Caddy from `/opt/scdhub/downloads/`
on the VM. iOS stays web-only (Apple does not allow sideloading from a website).

Two update lanes, both enforced at app launch by `app/src/components/UpdateGate.tsx`:

| Lane | When | How it reaches phones |
|---|---|---|
| **OTA (EAS Update)** | JS-only change (screens, logic, labels) — most releases | `eas update` publishes to the `production` channel; the app checks at launch, fetches, and reloads itself. No user action. |
| **APK** | Native change (new native module, permission, Expo SDK upgrade) | New APK on the VM + bumped `version.json`; the app **walls** (mandatory) until the user downloads + installs. The APK downloads into the app cache — nothing piles up in the phone's Downloads folder — and the installer replaces the app in place. |

**Fail-open:** if `version.json` can't be fetched (offline phone, server down),
the app opens normally. Only a successfully fetched, strictly newer
`versionCode` blocks.

## Version bookkeeping (single source: `app/app.json`)

| Field | Meaning | Bump when |
|---|---|---|
| `expo.android.versionCode` | integer install-ordering key; gradle reads it at build time | **every APK release** |
| `expo.version` | human version shown to users | user-visible releases (with the versionCode) |
| `expo.runtimeVersion` **and** `android/app/src/main/res/values/strings.xml` `expo_runtime_version` | OTA compatibility contract — an OTA only reaches binaries with the same runtime version. The two values must stay identical. | **only on native changes** (then an APK release is required, and OTAs target the new runtime) |

`android/app/build.gradle` reads versionCode/versionName from app.json via
JsonSlurper — never edit versions in gradle.

## OTA release (JS-only) — the routine one

> ⚠️ **Check `app/.env` first — `eas update` will NOT check it for you.**
> `release-apk.mjs` refuses a localhost `EXPO_PUBLIC_API_URL` (step 3 below); the OTA
> lane has no such guard, and it is the lane that ships to every phone at once.
> `client.ts` resolves `EXPO_PUBLIC_API_URL ?? (web ? "/graphql" : "http://localhost:4000/graphql")`,
> so on native a **missing** `.env` is exactly as fatal as a local-dev one — both bake
> localhost and cut every phone off from the server. A fresh worktree has no `app/.env`,
> and the day-to-day one points at localhost. Before publishing:
>
> ```sh
> grep '^EXPO_PUBLIC' app/.env   # API_URL must be the PROD https URL, not localhost
> ```
>
> Keep the real `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_ENV=production` while you
> override the URL — dropping the DSN silently ends crash reporting for that build.

```sh
cd app
npx eas update --channel production --platform android --message "<what changed>"
SENTRY_AUTH_TOKEN=<token> npx sentry-expo-upload-sourcemaps dist
```

Phones apply it on their next cold start (UpdateGate: check → fetch → reload).

## APK release (native change)

1. Native deps changed? Bump `runtimeVersion` in **both** `app/app.json` and
   `android/.../values/strings.xml`.
2. Bump `expo.android.versionCode` (always) and `expo.version` (if user-facing).
3. Check `app/.env` has the **prod** `EXPO_PUBLIC_API_URL` — `EXPO_PUBLIC_*`
   values bake into the bundle at build time (the release script refuses
   localhost).
4. Build + publish:
   ```sh
   SENTRY_AUTH_TOKEN=<token> node scripts/release-apk.mjs --upload deploy@<VM_IP>
   ```
   The Sentry gradle plugin uploads the release source maps during the build
   when `SENTRY_AUTH_TOKEN` is set; without it the script skips the upload
   (crash stacks for that APK stay unsymbolicated) and warns.
   (Build-only without `--upload`. SSH key defaults to `~/.ssh/scdhub_vm`.)
   The script uploads the APK **before** `version.json`, so the gate never
   points at a file that isn't there yet; a dated copy
   `scd-hub-<version>-c<code>.apk` is kept beside `scd-hub-latest.apk`.
5. Publish an OTA for the new runtime (step above) so fresh installs also get
   the latest JS.

Phones wall on next launch: "নতুন ভার্সন এসেছে" → download (in-app progress) →
Android installer replaces the app. First time only, Android asks to allow
"install unknown apps" for SCD Hub — Allow, come back, tap again. Login/data
survive the update. Stale cached APKs are deleted on the next normal launch.

## Signing — read this twice

- Release key: `app/android/app/scd-hub-release.jks` + credentials in
  `app/android/keystore.properties`. **Both are gitignored and exist only on
  the build machine.**
- **Back them up off-machine now** (password manager + the school Drive).
  Android only installs updates signed by the same key — a lost keystore means
  every phone must manually uninstall/reinstall.
- Machines without `keystore.properties` fall back to the debug key (fine for
  dev APKs, never for release).
- One-time migration note: installs older than the first keystore-signed
  release (v1.0.0 / versionCode 2) were debug-signed and must be uninstalled
  manually once — the in-app updater cannot cross a signature change.

## VM / Caddy (one-time setup)

```
mkdir -p /opt/scdhub/downloads
```

Prod vhost in the Caddyfile (before the SPA/static handler):

```caddy
handle_path /downloads/* {
    root * /opt/scdhub/downloads
    header /scd-hub-latest.apk Content-Type application/vnd.android.package-archive
    header /scd-hub-latest.apk Content-Disposition "attachment; filename=scd-hub.apk"
    header /version.json Cache-Control "no-store"
    file_server
}
```

then `sudo systemctl reload caddy`. `/downloads/` lives outside the deploy
dirs, so `deploy.sh` / rollbacks never touch it, and `version.json` is not in
git, so publishing a release never triggers a redeploy.

## EAS project

- Expo account `rahman365`, project `scd-hub`
  (`ef69db4d-e518-4334-955f-d0abf69ec8d9`), channel/branch `production`.
- Config lives in `app/app.json` (`updates.url`, `runtimeVersion`) and, for
  the installed binary, in `android/app/src/main/AndroidManifest.xml`
  meta-data (kept in sync by hand — we build locally with gradlew, not EAS
  Build).
