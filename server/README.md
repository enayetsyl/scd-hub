# @scd/server

Node/Express + GraphQL Yoga + Pothos. See the root `AGENTS.md` for commands and
the repo map. This README holds **ops setup notes** only.

## Ops: Google Drive file store (GP-A, D-#70)

Homework question/answer attachments live in the **school's own Google Drive**
(the live store — Principal ruling D-#70). The server talks to Drive with an
**OAuth refresh token on the school's Google account** (chosen over a service
account: no key file to manage, and the files sit in the school account's own
storage quota). If Drive is unreachable or the credential is missing, file
attach/view shows a Bangla notice — homework declare/check itself never blocks.

### One-time setup (Principal/Office + a technical helper, ~15 min)

1. Sign in to the **school's Google account** (the one that will own the files).
2. In [Google Cloud Console](https://console.cloud.google.com/) create a project
   (e.g. `scd-hub`), enable the **Google Drive API**, and create an **OAuth
   client ID** of type *Desktop app*. Note the **client id** and **client secret**.
3. Mint a **refresh token** for the school account with the
   `https://www.googleapis.com/auth/drive.file` scope (one-off consent — e.g.
   via [OAuth playground](https://developers.google.com/oauthplayground) using
   "Use your own OAuth credentials", or any one-shot helper script).
4. Put the three values in the server's `.env` on the host (see `.env.example`):
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REFRESH_TOKEN`. **Never commit them** (the repo is public).
5. Restart the server. On first upload it creates the private folder tree
   `SCD-Hub-Files/<year>/hw/` in the account's My Drive.

### Rules (from the build contract, prd-guardian-portal §5)

- The folder tree is **never shared** — no link-sharing, ever. Files reach
  clients only through the server (`GET /files/:id`, authorization first).
- **Retention:** a year's folder may be deleted one year after that academic
  year closes (manual ops action in Drive).
- Revoking access: remove the app's access from the school account's
  [security page](https://myaccount.google.com/permissions) — uploads/views
  fail gracefully until a new refresh token is configured.
