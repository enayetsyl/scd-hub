/**
 * YouTube-unlisted upload — WEB adapter (CO-2, D-#219). An Expo port of the ClassEcho
 * Next.js Google-Identity-Services (GIS) flow, simplified to the minimum the browser
 * upload actually needs:
 *
 *   1. load GIS (accounts.google.com/gsi/client)
 *   2. google.accounts.oauth2.initTokenClient({ client_id, scope youtube.upload })
 *   3. requestAccessToken() → OAuth popup → access token
 *   4. multipart fetch POST to the Data API (privacyStatus "unlisted",
 *      selfDeclaredMadeForKids false) with the bearer token → returns the video id
 *
 * NOTE (vs the original ClassEcho demo): the upload is a raw `fetch` with the OAuth
 * bearer token, so it needs NEITHER the GAPI client (`apis.google.com/js/api.js` +
 * `gapi.client.init`) NOR an API key — those only powered the unused discovery doc.
 * The ONLY credential required is the Web OAuth client id in
 * `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (.env, NEVER committed — §CO-2). A client id is not
 * a secret; the client_secret is never used here (and must never reach the browser).
 * GIS is browser-only, hence this `.web.ts`.
 */
import { YouTubeUploadError, type YouTubeUploadMeta, type YouTubeUploadResult } from "./youtubeUpload.types";

export * from "./youtubeUpload.types";

// --- minimal subset of the GIS global we call (cf. ClassEcho google-client.d.ts) ---
interface TokenClient {
  requestAccessToken(params?: { prompt?: "" | "none" | "consent" }): void;
}
interface GoogleOAuth2 {
  initTokenClient(init: {
    client_id: string;
    scope: string;
    callback: (resp: { access_token?: string; error?: string }) => void;
  }): TokenClient;
  revoke(token: string, done: () => void): void;
}
interface YtWindow extends Window {
  google?: { accounts: { oauth2: GoogleOAuth2 } };
}

const w = (): YtWindow => window as unknown as YtWindow;

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart";

let readyPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let pendingAuth: { resolve: () => void; reject: (e: Error) => void } | null = null;

/** Web + the Google Web OAuth client id present in the environment. */
export function isYouTubeUploadSupported(): boolean {
  return typeof window !== "undefined" && !!CLIENT_ID;
}

/** Inject a <script> once and resolve when it has loaded. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = w().document;
    const existing = doc.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new YouTubeUploadError(`Failed to load ${src}`)));
      return;
    }
    const el = doc.createElement("script");
    el.src = src;
    el.async = true;
    el.addEventListener("load", () => {
      el.dataset.loaded = "1";
      resolve();
    });
    el.addEventListener("error", () => reject(new YouTubeUploadError(`Failed to load ${src}`)));
    doc.head.appendChild(el);
  });
}

/** Idempotently load GIS and create the token client. */
export function ensureYouTubeReady(): Promise<void> {
  if (!isYouTubeUploadSupported()) {
    return Promise.reject(
      new YouTubeUploadError("YouTube upload is not configured (set EXPO_PUBLIC_GOOGLE_CLIENT_ID)"),
    );
  }
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await loadScript("https://accounts.google.com/gsi/client");
    const oauth2 = w().google?.accounts?.oauth2;
    if (!oauth2) throw new YouTubeUploadError("Google Identity Services failed to load");
    tokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID as string,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          pendingAuth?.reject(new YouTubeUploadError(`Authorization failed: ${resp.error ?? "no token"}`));
        } else {
          accessToken = resp.access_token;
          pendingAuth?.resolve();
        }
        pendingAuth = null;
      },
    });
  })().catch((e) => {
    readyPromise = null; // allow a retry after a transient script/init failure
    throw e;
  });
  return readyPromise;
}

export function isYouTubeAuthorized(): boolean {
  return !!accessToken;
}

/** Trigger the OAuth consent popup; resolves once an access token is held. */
export async function authorizeYouTube(): Promise<void> {
  await ensureYouTubeReady();
  if (!tokenClient) throw new YouTubeUploadError("Authorization client not ready");
  await new Promise<void>((resolve, reject) => {
    pendingAuth = { resolve, reject };
    (tokenClient as TokenClient).requestAccessToken({ prompt: "" });
  });
}

/** Open a native file picker for a video and return the chosen File (or null). */
export function pickVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const doc = w().document;
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const f = input.files && input.files[0] ? input.files[0] : null;
      doc.body.removeChild(input);
      resolve(f);
    });
    doc.body.appendChild(input);
    input.click();
  });
}

/** Multipart-upload the file to YouTube as unlisted; returns the new video id + url. */
export async function uploadVideoFile(file: File, meta: YouTubeUploadMeta): Promise<YouTubeUploadResult> {
  if (!accessToken) throw new YouTubeUploadError("You must authorize YouTube before uploading");

  const metadata = {
    snippet: { title: meta.title, description: meta.description ?? "" },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    throw new YouTubeUploadError(`YouTube upload failed: ${data.error?.message ?? res.statusText}`);
  }
  return { videoId: data.id, url: `https://youtu.be/${data.id}` };
}
