/**
 * Homework file upload/view helpers (GP-A, D-#70).
 *
 * Upload: pick ONE jpeg/png/pdf ≤ 5 MB → POST /files/hw (multipart, bearer
 * auth) → { fileId }. The caller then binds it with an attach mutation.
 * Upload failure NEVER blocks declare/check — callers show the Bangla notice
 * and move on (GP-J8).
 *
 * View: fetch the bytes (with auth) from GET /files/:id and open them. Web-only
 * for now, mirroring lib/pdf.ts (native viewing needs expo-file-system +
 * expo-sharing). The server streams the bytes — no Drive URL ever appears here.
 */
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { REST_BASE } from "../graphql/client";
import { getToken } from "./tokenStore";

export const FILE_MIMES = ["image/jpeg", "image/png", "application/pdf"];
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_VIEW_SUPPORTED = Platform.OS === "web";

export class FileUploadError extends Error {}

export interface UploadedFile {
  fileId: string;
  originalName: string;
  mime: string;
}

/** Pick one allowed file and upload it; null when the picker is cancelled.
 *  Throws FileUploadError with a server Bangla message on rejection/failure. */
export async function pickAndUploadHomeworkFile(
  kind: "question" | "answer",
): Promise<UploadedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append(
      "file",
      new File([blob], asset.name, { type: asset.mimeType ?? blob.type }),
    );
  } else {
    // React Native FormData file part: { uri, name, type }
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }
  form.append("kind", kind);

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/hw`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as { fileId: string; originalName: string; mime: string };
  return { fileId: body.fileId, originalName: body.originalName, mime: body.mime };
}

// ---------------------------------------------------------------------------
// Chat attachments (M-5 → M-4 server: POST /files/chat). image/pdf/video/audio
// ≤ 10 MB; the server validates again + binds the file at sendMessage time.
// ---------------------------------------------------------------------------

export const CHAT_FILE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
];
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedChatFile {
  fileId: string;
  kind: string; // IMAGE | PDF | VIDEO | AUDIO
  originalName: string;
  mime: string;
  sizeBytes: number;
}

/** Pick one allowed attachment and upload it to a conversation; null if the
 *  picker is cancelled. Throws FileUploadError with the server's Bangla message
 *  on rejection/failure (the caller shows a notice and the send is never blocked). */
export async function pickAndUploadChatFile(
  conversationId: string,
): Promise<UploadedChatFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: CHAT_FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append("file", new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }
  form.append("conversationId", conversationId);

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/chat`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as UploadedChatFile;
  return body;
}

// ---------------------------------------------------------------------------
// Class-test uploaded papers (CT-1 server: POST /files/classtest). jpeg/png/pdf
// ≤ 5 MB; the teacher uploads their own paper, then files the print request with
// the returned fileId as questionFileId.
// ---------------------------------------------------------------------------

/** Pick one jpeg/png/pdf and upload it as a class-test question paper; null if the
 *  picker is cancelled. Throws FileUploadError with the server's Bangla message on
 *  rejection/failure (the caller shows a notice; the request is filed after). */
export async function pickAndUploadClassTestPaper(): Promise<UploadedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append("file", new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/classtest`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as { fileId: string; originalName: string; mime: string };
  return { fileId: body.fileId, originalName: body.originalName, mime: body.mime };
}

// ---------------------------------------------------------------------------
// Class-note attachments (server: POST /files/classnote). jpeg/png/pdf ≤ 10 MB,
// up to 5 per note (the cap is enforced when the fileIds are bound to the note).
// ---------------------------------------------------------------------------

export const CLASSNOTE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CLASSNOTE_MAX_FILES = 5;

/** Pick one jpeg/png/pdf and upload it as a class-note attachment; null if cancelled.
 *  Throws FileUploadError with the server's Bangla message on rejection/failure. */
export async function pickAndUploadClassNoteAttachment(): Promise<UploadedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append("file", new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/classnote`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as { fileId: string; originalName: string; mime: string };
  return { fileId: body.fileId, originalName: body.originalName, mime: body.mime };
}

// ---------------------------------------------------------------------------
// Print-request uploads (PQ-2 server: POST /files/print). jpeg/png/pdf ≤ 10 MB,
// ≤5 per request. Afterwards readable by the uploader and the Office only.
// ---------------------------------------------------------------------------

export const PRINT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const PRINT_MAX_FILES = 5;

/** Upload ONE picked asset to POST /files/print. */
async function uploadPrintAsset(asset: DocumentPicker.DocumentPickerAsset): Promise<UploadedFile> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append("file", new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/print`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as { fileId: string; originalName: string; mime: string };
  return { fileId: body.fileId, originalName: body.originalName, mime: body.mime };
}

/** Pick one jpeg/png/pdf and upload it as a print-request document; null if cancelled.
 *  Throws FileUploadError with the server's Bangla message on rejection/failure. */
export async function pickAndUploadPrintFile(): Promise<UploadedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  return uploadPrintAsset(picked.assets[0]);
}

export interface MultiUploadResult {
  uploaded: UploadedFile[];
  /** Per-file failures ("name: reason") — partial success keeps the good ones. */
  failures: string[];
}

/**
 * Pick SEVERAL jpeg/png/pdf files at once (D-#294 follow-up: one-at-a-time picking
 * was a chore) and upload each to /files/print. At most `maxFiles` are taken —
 * extras are reported as skipped, never silently dropped. Empty result when the
 * picker is cancelled.
 */
export async function pickAndUploadPrintFiles(maxFiles: number): Promise<MultiUploadResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: FILE_MIMES,
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.length) return { uploaded: [], failures: [] };

  const take = picked.assets.slice(0, Math.max(0, maxFiles));
  const skipped = picked.assets.slice(Math.max(0, maxFiles));
  const uploaded: UploadedFile[] = [];
  const failures: string[] = skipped.map((a) => `${a.name}: limit`);
  for (const asset of take) {
    try {
      uploaded.push(await uploadPrintAsset(asset));
    } catch (e) {
      failures.push(`${asset.name}: ${e instanceof FileUploadError ? e.message : String(e)}`);
    }
  }
  return { uploaded, failures };
}

// ---------------------------------------------------------------------------
// Student-comment attachments (CM-2 server: POST /files/comment). image/pdf/video/
// audio ≤ 10 MB (same CHAT_FILE_MIMES list); the comment must exist and be
// undelivered. The fileId is $addToSet'ed onto the comment's attachmentIds.
// ---------------------------------------------------------------------------

/** Pick one allowed attachment and upload it to a (undelivered) comment; null if the
 *  picker is cancelled. Throws FileUploadError with the server's Bangla message on
 *  rejection/failure (the caller shows a notice). */
export async function pickAndUploadCommentFile(
  commentId: string,
): Promise<UploadedChatFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: CHAT_FILE_MIMES,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append("file", new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as unknown as Blob);
  }
  form.append("commentId", commentId);

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/comment`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let message = `upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const body = (await res.json()) as UploadedChatFile;
  return body;
}

/** Fetch a stored file (with auth) and open it in a new browser tab. Web only. */
export async function openStoredFile(fileId: string): Promise<void> {
  if (Platform.OS !== "web") {
    throw new FileUploadError("File viewing is web-only in this build");
  }
  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/${encodeURIComponent(fileId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `file request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  if (typeof window !== "undefined") {
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}
