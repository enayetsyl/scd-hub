/**
 * Server-side PDF export (J1.8 / J3.4). The thin REST surface
 * (GET /pdf/artifact/:id, GET /pdf/set/:id) authenticates via the Authorization
 * header (no query-param token), so we fetch with the bearer token and hand the
 * blob to the browser. Native file download/share needs expo-file-system +
 * expo-sharing (out of scope for this web-first slice), so PDF export is
 * web-only for now — PDF_SUPPORTED gates the button.
 */
import { Platform } from "react-native";
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
