/**
 * Opening a print job's source (PQ-4, D-#281; extracted for the D-#362 history).
 *
 * A job opens differently per `sourceType`: an assembled question set and a lesson plan
 * are RENDERED on demand by the server's pdfkit pipeline, an upload streams through
 * `GET /files/:id`, a link opens externally. Both print screens (the queue and the
 * reprint history) need identical behaviour, so it lives here rather than twice.
 */
import { Linking } from "react-native";
import { openPdf } from "./pdf";

/** Just the fields the open path reads — any print-request-shaped object fits. */
export interface PrintSourceRef {
  sourceType: string;
  setId: string | null;
  contentArtifactId: string | null;
  linkUrl: string | null;
}

/**
 * Open the job's SINGLE-document source. Returns false when there is nothing single to
 * open — an UPLOAD job (whose files each get their own named button, because opening
 * only `fileIds[0]` left every other attachment unreachable) or a row whose source id
 * has gone missing; the caller decides what to say.
 */
export async function openPrintSource(r: PrintSourceRef): Promise<boolean> {
  if (r.sourceType === "SET" && r.setId) {
    await openPdf(`/pdf/set/${r.setId}`);
    return true;
  }
  // A plan is stored as markdown; `/pdf/artifact/:id` renders it through the same
  // pdfkit + NotoSansBengali pipeline the question sets use.
  if (r.sourceType === "CONTENT_ARTIFACT" && r.contentArtifactId) {
    await openPdf(`/pdf/artifact/${r.contentArtifactId}`);
    return true;
  }
  if (r.sourceType === "LINK" && r.linkUrl) {
    await Linking.openURL(r.linkUrl);
    return true;
  }
  return false;
}
