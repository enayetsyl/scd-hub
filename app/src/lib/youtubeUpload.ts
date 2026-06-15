/**
 * YouTube-unlisted upload — NATIVE / default stub (CO-2).
 *
 * The client upload path uses Google Identity Services, which is browser-only, so
 * file upload is WEB-ONLY (the real adapter is youtubeUpload.web.ts; Metro picks it
 * on web). On native this stub reports unsupported, and the Record-Session screen
 * falls back to the "paste an already-uploaded YouTube link" mode — which works on
 * every platform because watching an unlisted video needs only its id.
 */
import { YouTubeUploadError, type YouTubeUploadMeta, type YouTubeUploadResult } from "./youtubeUpload.types";

export * from "./youtubeUpload.types";

/** Client-side upload is web-only — false on native. */
export function isYouTubeUploadSupported(): boolean {
  return false;
}

const unsupported = (): never => {
  throw new YouTubeUploadError("YouTube upload is available on the web app only");
};

export async function ensureYouTubeReady(): Promise<void> {
  unsupported();
}

export function isYouTubeAuthorized(): boolean {
  return false;
}

export async function authorizeYouTube(): Promise<void> {
  unsupported();
}

export async function pickVideoFile(): Promise<File | null> {
  return unsupported();
}

export async function uploadVideoFile(_file: File, _meta: YouTubeUploadMeta): Promise<YouTubeUploadResult> {
  return unsupported();
}
