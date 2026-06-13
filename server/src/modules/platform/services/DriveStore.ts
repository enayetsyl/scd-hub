/**
 * DriveStore — the Google Drive adapter (GP-A, D-#70: Drive is the LIVE store,
 * the app's SECOND live external dependency after D-#24).
 *
 * AUTH MECHANISM (the §5 "Claude Code picks" decision): an **OAuth refresh
 * token on the school's own Google account**, NOT a service account. Why:
 *   - mechanically simpler on the Oracle host — three env strings + plain
 *     HTTPS token refresh; no RS256 key file to provision/rotate;
 *   - the files land in the school account's OWN My Drive storage quota
 *     (service accounts have no usable My Drive quota of their own, which
 *     makes them the WRONG tool for a my-drive folder tree);
 *   - revocable by the school at any time from the Google account page.
 * Credential env (server secrets ONLY — repo is public, §3.5):
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID (optional pin; else SCD-Hub-Files is found/created)
 *
 * Folder tree: SCD-Hub-Files/<year>/hw/ — never shared, no link-sharing, ever.
 * Retention (year + 1) is an OPS action on the Drive folder, not server code.
 *
 * Failure posture (GP-J8): any Drive/credential problem throws
 * `DriveUnavailableError` — callers surface a Bangla notice and persist
 * NOTHING; homework declare/check itself never blocks on a file operation.
 *
 * Plain `fetch` (Node 20+) — no googleapis dependency. Jest mocks this module
 * entirely (no live Google in CI); live verification needs the credential.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const ROOT_FOLDER_NAME = "SCD-Hub-Files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveUnavailableError extends Error {
  constructor(msg = "Google Drive unreachable") {
    super(msg);
    this.name = "DriveUnavailableError";
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new DriveUnavailableError("Drive credential not configured (GOOGLE_OAUTH_* env)");
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (e) {
    throw new DriveUnavailableError(`Drive token refresh unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new DriveUnavailableError(`Drive token refresh failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function driveFetch(url: string, init: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new DriveUnavailableError(`Drive unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new DriveUnavailableError(`Drive request failed: HTTP ${res.status}`);
  return res;
}

// Folder ids are stable; cache per process.
const folderCache = new Map<string, string>();

/** Find-or-create a folder by name under a parent (null = My Drive root). */
async function ensureFolder(name: string, parentId: string | null): Promise<string> {
  const cacheKey = `${parentId ?? "root"}/${name}`;
  const hit = folderCache.get(cacheKey);
  if (hit) return hit;

  const qParts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);
  const searchUrl = `${DRIVE_FILES_URL}?q=${encodeURIComponent(qParts.join(" and "))}&fields=files(id)&pageSize=1`;
  const found = (await (await driveFetch(searchUrl, { method: "GET" })).json()) as {
    files: Array<{ id: string }>;
  };
  let id = found.files[0]?.id;

  if (!id) {
    const created = (await (
      await driveFetch(`${DRIVE_FILES_URL}?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      })
    ).json()) as { id: string };
    id = created.id;
  }
  folderCache.set(cacheKey, id);
  return id;
}

/** SCD-Hub-Files/<year>/<subfolder> — the private folder for a year + use.
 *  `hw` is the GP-A homework store; `chat` is the M-4 attachment store. */
async function ensureYearSubfolder(year: string, subfolder: string): Promise<string> {
  const rootId =
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? (await ensureFolder(ROOT_FOLDER_NAME, null));
  const yearId = await ensureFolder(year, rootId);
  return ensureFolder(subfolder, yearId);
}

export interface DriveUploadInput {
  name: string;
  mime: string;
  data: Buffer;
  /** Academic-year folder, e.g. "2026". */
  year: string;
  /** Use-folder under the year (default "hw"; chat attachments pass "chat"). */
  subfolder?: string;
}

/** Stream a file into its private folder; returns the Drive file id
 *  (SERVER-INTERNAL — never expose it to a client). */
export async function uploadToDrive(input: DriveUploadInput): Promise<string> {
  const folderId = await ensureYearSubfolder(input.year, input.subfolder ?? "hw");
  const boundary = `scdhub-${Math.abs(Date.now() ^ input.data.length)}`;
  const meta = JSON.stringify({ name: input.name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.mime}\r\n\r\n`,
    ),
    input.data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Fetch a file's bytes from Drive (the server streams them on to the client). */
export async function downloadFromDrive(driveFileId: string): Promise<Buffer> {
  const res = await driveFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(driveFileId)}?alt=media`,
    { method: "GET" },
  );
  return Buffer.from(await res.arrayBuffer());
}
