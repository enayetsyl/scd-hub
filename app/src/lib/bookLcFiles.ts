/**
 * Book-lifecycle REST (server: POST /files/book-lc/*, GET /files/book-lc/*) — imports, new-version
 * uploads, version files, returned-copy scans, master/memo downloads. Pick first, then send one form,
 * as the activity-sheet screens do.
 */
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { REST_BASE } from "../graphql/client";
import { getToken } from "./tokenStore";
import { FileUploadError, rnUploadName } from "./files";
import { downloadFile } from "./pdf";
import * as FileSystem from "expo-file-system";

export type BlAsset = DocumentPicker.DocumentPickerAsset;

/** Pick one file; null when cancelled. */
export async function pickBookLcFile(kind: "md" | "zip" | "pdf" | "docx" | "scan" | "any"): Promise<BlAsset | null> {
  const types: Record<typeof kind, string[] | string> = {
    md: "*/*",
    zip: ["application/zip", "application/x-zip-compressed", "*/*"],
    pdf: ["application/pdf"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    scan: ["application/pdf", "image/png", "image/jpeg"],
    any: "*/*",
  };
  const picked = await DocumentPicker.getDocumentAsync({ type: types[kind], multiple: false, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;
  return picked.assets[0];
}

async function appendAsset(form: FormData, field: string, asset: BlAsset): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    form.append(field, new File([blob], asset.name, { type: asset.mimeType ?? blob.type }));
  } else {
    form.append(field, { uri: asset.uri, name: rnUploadName(asset.name), type: asset.mimeType ?? "application/octet-stream" } as unknown as Blob);
  }
}

/** POST a multipart form to /files/book-lc/<path>; returns the JSON body or throws the Bangla error. */
export async function postBookLc<T>(path: string, fields: Record<string, string | number | null | undefined>, files: Record<string, BlAsset | null | undefined>): Promise<T> {
  const form = new FormData();
  for (const [k, a] of Object.entries(files)) if (a) await appendAsset(form, k, a);
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== "") form.append(k, String(v));
  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/book-lc/${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
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

/** Download the version's master .md (web). */
export function downloadBookLcMaster(versionId: string, filename: string): Promise<void> {
  return downloadFile(`/files/book-lc/version/${versionId}/master.md`, filename);
}
/** Download the round's memo .md (web). */
export function downloadBookLcMemo(roundId: string, filename: string): Promise<void> {
  return downloadFile(`/files/book-lc/round/${roundId}/memo.md`, filename);
}

/** Read a picked text file (a result .json / .md / .txt) as UTF-8. */
export async function readPickedText(asset: BlAsset): Promise<string> {
  if (Platform.OS === "web") return fetch(asset.uri).then((r) => r.text());
  return FileSystem.readAsStringAsync(asset.uri);
}

/** POST /files/book-lc/bundle → the zip is saved (web); returns the bundle's nonce and draft id. */
export async function downloadBookLcBundle(input: { bookId: string; feedback: string[]; instructionIds: string[]; includeMedia: boolean }): Promise<{ nonce: string; draftId: string }> {
  if (Platform.OS !== "web") throw new Error("web only");
  const token = getToken();
  const res = await fetch(`${REST_BASE}/files/book-lc/bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = `bundle failed (${res.status})`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the generic message
    }
    throw new FileUploadError(message);
  }
  const nonce = res.headers.get("X-Bundle-Nonce") ?? "";
  const draftId = res.headers.get("X-Draft-Id") ?? "";
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name ? decodeURIComponent(name) : `bundle_${nonce}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { nonce, draftId };
}

/** The round's return-transcription pack (web). */
export function downloadBookLcTranscriptionPack(roundId: string, filename: string): Promise<void> {
  return downloadFile(`/files/book-lc/round/${roundId}/transcription-pack.zip`, filename);
}
