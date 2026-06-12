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
