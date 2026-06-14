/**
 * Shared types for the CO-2 client YouTube-unlisted upload. Platform-neutral so the
 * web adapter (youtubeUpload.web.ts) and the native stub (youtubeUpload.ts) agree.
 */
export interface YouTubeUploadMeta {
  /** YouTube video title (derived from the session anchor). */
  title: string;
  description?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  /** A youtu.be watch URL for the new video. */
  url: string;
}

export class YouTubeUploadError extends Error {}
