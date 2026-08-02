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

/** SCD-Hub-Files/<year>/<subfolder…> — the private folder for a year + use.
 *  `hw` is the GP-A homework store; `chat` is the M-4 attachment store.
 *
 *  `subfolder` may be a NESTED path ("books/C1-BAN/compliant", SB-2): each segment is
 *  found-or-created in turn. Book production needs the tree so a file identifies
 *  itself from the Drive side as well as from Mongo, which is the whole point of
 *  storing it under a path rather than a flat bucket (D-#409). */
async function ensureYearSubfolder(year: string, subfolder: string): Promise<string> {
  const rootId =
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? (await ensureFolder(ROOT_FOLDER_NAME, null));
  let parentId = await ensureFolder(year, rootId);
  for (const seg of subfolder.split("/").filter(Boolean)) {
    parentId = await ensureFolder(seg, parentId);
  }
  return parentId;
}

export interface DriveUploadInput {
  name: string;
  mime: string;
  data: Buffer;
  /** Academic-year folder, e.g. "2026". */
  year: string;
  /** Use-folder under the year (default "hw"; chat attachments pass "chat").
   *  May be a nested path, e.g. "books/C1-BAN/compliant". */
  subfolder?: string;
  /** Drive `appProperties` — small key/value metadata stored ON the Drive file, so a
   *  file found from the Drive side names its own book/lesson/slot/stage instead of
   *  being an opaque blob (SB-2, D-#409). Mongo stays the index; this is the label. */
  appProperties?: Record<string, string>;
}

/** What Google says about the storing account's space (SH-1, D-#414). `limit` is null on
 *  an account with no quota (some Workspace tiers report none) — the caller must render
 *  "no limit reported" rather than divide by it. */
export interface DriveQuota {
  usageBytes: number;
  /** Of `usageBytes`, the part that is Drive files (the rest is Gmail/Photos). */
  usageInDriveBytes: number | null;
  /** Trashed files. Still counted against the quota until the bin is emptied, so this is
   *  reclaimable space rather than space already gone (11.6 GB of it on the live account). */
  usageInDriveTrashBytes: number | null;
  limitBytes: number | null;
}

/**
 * The Drive account's storage quota, straight from Google — never a hardcoded ceiling.
 * Every uploaded byte lives in Drive (StoredFile holds only a handle), so this is the
 * quota that grows with usage; the DB only holds metadata.
 *
 * Deliberately NOT returning the account's email address: the health panel is infra
 * telemetry and has no reason to carry an identity.
 */
export async function driveQuota(): Promise<DriveQuota> {
  const res = await driveFetch(
    "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
    { method: "GET" },
  );
  if (!res.ok) throw new DriveUnavailableError(`Drive about.get failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    storageQuota?: {
      limit?: string;
      usage?: string;
      usageInDrive?: string;
      usageInDriveTrash?: string;
    };
  };
  const q = json.storageQuota ?? {};
  return {
    usageBytes: Number(q.usage ?? 0),
    usageInDriveBytes: q.usageInDrive === undefined ? null : Number(q.usageInDrive),
    usageInDriveTrashBytes:
      q.usageInDriveTrash === undefined ? null : Number(q.usageInDriveTrash),
    limitBytes: q.limit === undefined ? null : Number(q.limit),
  };
}

/** Stream a file into its private folder; returns the Drive file id
 *  (SERVER-INTERNAL — never expose it to a client). */
export async function uploadToDrive(input: DriveUploadInput): Promise<string> {
  const folderId = await ensureYearSubfolder(input.year, input.subfolder ?? "hw");
  const boundary = `scdhub-${Math.abs(Date.now() ^ input.data.length)}`;
  const meta = JSON.stringify({
    name: input.name,
    parents: [folderId],
    ...(input.appProperties ? { appProperties: input.appProperties } : {}),
  });
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
export interface DriveFileRef {
  id: string;
  name: string;
  createdTime: string;
  sizeBytes: number | null;
}

/**
 * Files in a folder found BY NAME anywhere in the account, newest first (SH-7, D-#425).
 *
 * The school's own backup cron writes to a top-level `SCD-Hub-Backups`, outside the
 * `SCD-Hub-Files` tree this module otherwise owns — so the health panel has to look the
 * folder up by name rather than construct a path. Read-only: this never creates the
 * folder, because a missing folder is a finding (no backups) and silently conjuring an
 * empty one would hide it.
 */
export async function listFolderByName(name: string): Promise<DriveFileRef[] | null> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
  const found = (await (
    await driveFetch(`${DRIVE_FILES_URL}?q=${q}&fields=files(id)&pageSize=1`, { method: "GET" })
  ).json()) as { files: Array<{ id: string }> };
  const folderId = found.files?.[0]?.id;
  if (!folderId) return null;

  const childQ = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const list = (await (
    await driveFetch(
      `${DRIVE_FILES_URL}?q=${childQ}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc&pageSize=100`,
      { method: "GET" },
    )
  ).json()) as { files: Array<{ id: string; name: string; createdTime: string; size?: string }> };
  return (list.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    createdTime: f.createdTime,
    sizeBytes: f.size === undefined ? null : Number(f.size),
  }));
}

/** Files in one year/subfolder, newest first. */
export async function listDriveFolder(year: string, subfolder: string): Promise<DriveFileRef[]> {
  const folderId = await ensureYearSubfolder(year, subfolder);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `${DRIVE_FILES_URL}?q=${q}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc&pageSize=100`;
  const json = (await (await driveFetch(url, { method: "GET" })).json()) as {
    files: Array<{ id: string; name: string; createdTime: string; size?: string }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    createdTime: f.createdTime,
    sizeBytes: f.size === undefined ? null : Number(f.size),
  }));
}

/** Permanently remove a Drive file. Only ever called by the backup retention sweep on a
 *  file the sweep itself created, in the backups folder — never on school content. */
export async function deleteFromDrive(driveFileId: string): Promise<void> {
  await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(driveFileId)}`, { method: "DELETE" });
}

export async function downloadFromDrive(driveFileId: string): Promise<Buffer> {
  const res = await driveFetch(
    `${DRIVE_FILES_URL}/${encodeURIComponent(driveFileId)}?alt=media`,
    { method: "GET" },
  );
  return Buffer.from(await res.arrayBuffer());
}
