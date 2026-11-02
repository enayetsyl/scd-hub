/**
 * Server-side PDF export (J1.8 / J3.4). The thin REST surface
 * (GET /pdf/artifact/:id, GET /pdf/set/:id) authenticates via the Authorization
 * header (no query-param token), so we fetch with the bearer token and hand the
 * blob to the browser. Native file download/share needs expo-file-system +
 * expo-sharing (out of scope for this web-first slice), so PDF export is
 * web-only for now — PDF_SUPPORTED gates the button.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { REST_BASE } from "../graphql/client";
import { getToken } from "./tokenStore";

export const PDF_SUPPORTED = Platform.OS === "web";

function openBlob(blob: Blob): void {
  const blobUrl = URL.createObjectURL(blob);
  if (typeof window !== "undefined") {
    window.open(blobUrl, "_blank");
    // Release the object URL after the tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

/** Fetch a PDF (with auth) and open it in a new browser tab. Web only. */
export async function openPdf(path: string): Promise<void> {
  if (Platform.OS !== "web") {
    throw new Error("PDF export is web-only in this build");
  }
  const token = getToken();
  const res = await fetch(`${REST_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
  openBlob(await res.blob());
}

/**
 * Fetch an authenticated file and SAVE it under a given name, rather than opening it
 * in a tab (MR-8's comment pack). A `.md` or `.zip` opened in a tab is either rendered
 * as plain text or downloaded with a uuid for a name — neither is a file you can find
 * again — so this drives an anchor with `download` set. Web only, like the rest.
 *
 * The server's own Content-Disposition filename is ignored on purpose: the caller
 * knows the section and month and can name it better than a slug can.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  if (Platform.OS !== "web") {
    throw new Error("Export is web-only in this build");
  }
  const token = getToken();
  const res = await fetch(`${REST_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    // The route answers structured errors (no reports this month, wrong period) — read
    // the message rather than showing the operator a bare status code.
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* not JSON — fall back to the status */
    }
    throw new Error(detail || `Export failed (${res.status})`);
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * Staff letters open on the web AND on Android (D-#903): the staff member reading their
 * own letter is on the phone app, where the blob/window.open path above does not exist.
 * iOS stays off for the same reason as files.ts — it would need expo-sharing in the binary.
 */
export const LETTER_PDF_SUPPORTED = Platform.OS === "web" || Platform.OS === "android";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the PDF"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch a letter PDF (GET an issued one, or POST `body` for a preview) and show it: a
 * new tab on the web, the phone's PDF viewer on Android. A refusal the server explains
 * (no designation, not a raise) is thrown with the server's own words.
 */
export async function openLetterPdf(path: string, body?: unknown): Promise<void> {
  if (!LETTER_PDF_SUPPORTED) throw new Error("PDF viewing is not available on this device");
  const token = getToken();
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(
    `${REST_BASE}${path}`,
    body === undefined
      ? { headers: auth }
      : { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* not JSON — fall back to the status */
    }
    throw new Error(detail || `PDF request failed (${res.status})`);
  }
  const blob = await res.blob();
  if (Platform.OS === "web") {
    openBlob(blob);
    return;
  }
  // Android: write the bytes to the cache (the OS reclaims it) under a .pdf name, then
  // hand a content:// URI to the phone's viewer — the files.ts route, for bytes we hold.
  const uri = `${FileSystem.cacheDirectory}scdhub-letter-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(uri, await blobToBase64(blob), { encoding: FileSystem.EncodingType.Base64 });
  const contentUri = await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1,
    type: "application/pdf",
  });
}

/** POST a JSON body (edited markdown + layout knobs) and open the returned PDF.
 *  Web only — used by English Drive edit-before-print (D-#348). */
export async function openPdfPost(path: string, body: unknown): Promise<void> {
  if (Platform.OS !== "web") {
    throw new Error("PDF export is web-only in this build");
  }
  const token = getToken();
  const res = await fetch(`${REST_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
  openBlob(await res.blob());
}
