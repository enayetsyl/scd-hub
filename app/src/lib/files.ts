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

/** Maximum declare-form attachments per homework item (mirrors the server cap). */
export const HW_MAX_ATTACHMENTS = 5;

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
  return uploadHomeworkAsset(picked.assets[0], kind);
}

/**
 * Pick SEVERAL jpeg/png/pdf files at once and upload each as a homework QUESTION
 * file (the print multi-pick pattern). At most `maxFiles` are taken — extras are
 * reported as skipped, never silently dropped. Empty result when cancelled.
 */
export async function pickAndUploadHomeworkFiles(maxFiles: number): Promise<MultiUploadResult> {
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
      uploaded.push(await uploadHomeworkAsset(asset, "question"));
    } catch (e) {
      failures.push(`${asset.name}: ${e instanceof FileUploadError ? e.message : String(e)}`);
    }
  }
  return { uploaded, failures };
}

/** Upload ONE picked asset to POST /files/hw. */
async function uploadHomeworkAsset(
  asset: DocumentPicker.DocumentPickerAsset,
  kind: "question" | "answer",
): Promise<UploadedFile> {
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

/** Class-test papers additionally accept Word documents (D-#342 — the office
 *  authors papers in Word); the server enforces the same list. */
export const CLASSTEST_FILE_MIMES = [
  ...FILE_MIMES,
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Pick one jpeg/png/pdf/doc/docx and upload it as a class-test question paper; null
 *  if the picker is cancelled. Throws FileUploadError with the server's Bangla message
 *  on rejection/failure (the caller shows a notice; the request is filed after). */
export async function pickAndUploadClassTestPaper(): Promise<UploadedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: CLASSTEST_FILE_MIMES,
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
// Assignment attachments (D-#298 server: POST /files/assignment). jpeg/png/pdf
// ≤ 10 MB, ≤5 per item (cap enforced when the ids are bound at deliver).
// ---------------------------------------------------------------------------

export const AS_MAX_ATTACHMENTS = 5;

/** Upload ONE picked asset to POST /files/assignment. */
async function uploadAssignmentAsset(asset: DocumentPicker.DocumentPickerAsset): Promise<UploadedFile> {
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
  const res = await fetch(`${REST_BASE}/files/assignment`, {
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

/**
 * Pick SEVERAL jpeg/png/pdf files at once and upload each as an assignment
 * attachment (the print multi-pick pattern). At most `maxFiles` are taken —
 * extras are reported as skipped, never silently dropped. Empty when cancelled.
 */
export async function pickAndUploadAssignmentFiles(maxFiles: number): Promise<MultiUploadResult> {
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
      uploaded.push(await uploadAssignmentAsset(asset));
    } catch (e) {
      failures.push(`${asset.name}: ${e instanceof FileUploadError ? e.message : String(e)}`);
    }
  }
  return { uploaded, failures };
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

// ---------------------------------------------------------------------------
// English Drive binary documents (owner 2026-07-25 server: POST /files/english-drive).
// PDF or Word (DOC/DOCX) only, ≤ 10 MB; Office/Principal upload. The returned fileId
// is carried into uploadEnglishDriveDoc with format=PDF|DOCX.
// ---------------------------------------------------------------------------

export const ENGLISH_DRIVE_BINARY_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Map a picked binary's mime/name to the doc format (PDF | DOCX). */
export function englishDriveFormatOf(mime: string, name: string): "PDF" | "DOCX" | null {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "PDF";
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx?$/i.test(name)
  ) {
    return "DOCX";
  }
  return null;
}

/** English Drive upload result — a DOCX also carries the server-converted PDF. */
export interface UploadedEnglishDriveFile extends UploadedFile {
  /** DOCX: the LibreOffice-converted PDF StoredFile id; null for PDF / on failure. */
  pdfFileId: string | null;
}

/** Upload ONE picked binary to POST /files/english-drive. */
export async function uploadEnglishDriveAsset(
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<UploadedEnglishDriveFile> {
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
  const res = await fetch(`${REST_BASE}/files/english-drive`, {
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
  const body = (await res.json()) as { fileId: string; pdfFileId?: string | null; originalName: string; mime: string };
  return { fileId: body.fileId, pdfFileId: body.pdfFileId ?? null, originalName: body.originalName, mime: body.mime };
}

// ---------------------------------------------------------------------------
// Drag-and-drop uploads (web): the UploadDropZone hands the screens browser
// File objects directly — same multipart POSTs (and server-side validation +
// Bangla error messages) as the pickers, minus DocumentPicker. Web only; on
// native the zone never fires.
// ---------------------------------------------------------------------------

/** POST one browser File to a /files/* endpoint; parses the JSON body. */
async function postWebFileForm<T>(path: string, file: File, extra?: Record<string, string>): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
  const token = getToken();
  const res = await fetch(`${REST_BASE}${path}`, {
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
  return (await res.json()) as T;
}

export const uploadHomeworkWebFile = (file: File, kind: "question" | "answer"): Promise<UploadedFile> =>
  postWebFileForm<UploadedFile>("/files/hw", file, { kind });

export const uploadChatWebFile = (conversationId: string, file: File): Promise<UploadedChatFile> =>
  postWebFileForm<UploadedChatFile>("/files/chat", file, { conversationId });

export const uploadClassTestPaperWebFile = (file: File): Promise<UploadedFile> =>
  postWebFileForm<UploadedFile>("/files/classtest", file);

export const uploadClassNoteWebFile = (file: File): Promise<UploadedFile> =>
  postWebFileForm<UploadedFile>("/files/classnote", file);

/** Web drag-drop of a PDF/DOCX English Drive doc — carries the converted pdfFileId. */
export const uploadEnglishDriveWebFile = (file: File): Promise<UploadedEnglishDriveFile> =>
  postWebFileForm<UploadedEnglishDriveFile>("/files/english-drive", file);

export const uploadCommentWebFile = (commentId: string, file: File): Promise<UploadedChatFile> =>
  postWebFileForm<UploadedChatFile>("/files/comment", file, { commentId });

/** Multi-file web upload with the pickers' cap + per-file failure semantics:
 *  at most `maxFiles` are taken, extras land in `failures` ("name: limit"),
 *  and one bad file never sinks the rest. */
async function uploadWebFilesCapped(
  path: string,
  files: File[],
  maxFiles: number,
  extra?: Record<string, string>,
): Promise<MultiUploadResult> {
  const take = files.slice(0, Math.max(0, maxFiles));
  const skipped = files.slice(Math.max(0, maxFiles));
  const uploaded: UploadedFile[] = [];
  const failures: string[] = skipped.map((f) => `${f.name}: limit`);
  for (const file of take) {
    try {
      uploaded.push(await postWebFileForm<UploadedFile>(path, file, extra));
    } catch (e) {
      failures.push(`${file.name}: ${e instanceof FileUploadError ? e.message : String(e)}`);
    }
  }
  return { uploaded, failures };
}

export const uploadPrintWebFiles = (files: File[], maxFiles: number): Promise<MultiUploadResult> =>
  uploadWebFilesCapped("/files/print", files, maxFiles);

export const uploadAssignmentWebFiles = (files: File[], maxFiles: number): Promise<MultiUploadResult> =>
  uploadWebFilesCapped("/files/assignment", files, maxFiles);

export const uploadHomeworkQuestionWebFiles = (files: File[], maxFiles: number): Promise<MultiUploadResult> =>
  uploadWebFilesCapped("/files/hw", files, maxFiles, { kind: "question" });

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

// ---------------------------------------------------------------------------
// Support-book artwork (SB-2 → POST /files/book). png/jpeg ≤ 25 MB per image.
//
// A DIFFERENT ROUTE FROM THE ONES ABOVE, because the upload does more than store
// bytes: it registers a lineage row at a named stage, which is what makes a
// re-approval invalidate everything downstream (D-#417). So the request carries
// bookId + lessonNo + slotId + stage, and the server answers with the ASSET it
// created, not just a fileId.
// ---------------------------------------------------------------------------

export const BOOK_IMAGE_MIMES = ["image/png", "image/jpeg"];
export const BOOK_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export interface UploadedBookImage {
  fileId: string;
  assetId: string;
  stage: string;
  slotId: string;
  lessonNo: number;
}

export interface BookImageUploadTarget {
  bookId: string;
  lessonNo: number;
  slotId: string;
  /** APPROVED | CROPPED | UPSCALED | COMPLIANT. */
  stage: string;
  /** APPROVED rows only — which tool drew it, for the audit trail (D-#419). */
  generatorTool?: string;
}

/** Pick one png/jpeg and upload it against a slot+stage. null when cancelled. */
export async function pickAndUploadBookImage(
  target: BookImageUploadTarget,
): Promise<UploadedBookImage | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: BOOK_IMAGE_MIMES,
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
  form.append("bookId", target.bookId);
  form.append("lessonNo", String(target.lessonNo));
  form.append("slotId", target.slotId);
  form.append("stage", target.stage);
  if (target.generatorTool) form.append("generatorTool", target.generatorTool);

  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/book`, {
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
  const body = (await res.json()) as UploadedBookImage;
  return body;
}

// ---------------------------------------------------------------------------
// Plain JSON pick (SB-1 import). No upload — the bytes are READ here and travel
// as a GraphQL string argument, because `submitSupportBookPatch` wants the text,
// not a stored file: a patch is not an artifact to keep, it is a proposal to
// validate. Whether it is kept is `LessonPatch`'s decision, made server-side.
// ---------------------------------------------------------------------------

export interface PickedJson {
  name: string;
  text: string;
}

/** Pick one .json file and return its text. null when cancelled. */
export async function pickJsonFile(): Promise<PickedJson | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/json"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];
  // fetch() on the picker's uri works for both web blob: urls and native file: urls,
  // which is why this does not need a platform branch the way the uploads above do.
  const res = await fetch(asset.uri);
  if (!res.ok) throw new FileUploadError(`could not read ${asset.name}`);
  return { name: asset.name, text: await res.text() };
}
