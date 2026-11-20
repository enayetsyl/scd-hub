/**
 * ‹ আগের / পরের › on the question-review thread screen (owner 20 Nov 2026, D-#1665).
 *
 * A list screen (the reviewer's queue, the publish inbox, a reviewer's rounds) remembers the ORDER of
 * the questions it showed at the moment one is opened; the thread screen then steps through that same
 * order without going back to the list. Kept in memory AND in device storage, so a web reload (or a
 * "viewing as" switch) still has the list; storage failing just means no buttons.
 */
import { getItem, setItem } from "./storage";

const KEY = "qreviewNav.order";
let order: string[] = [];

/** Remember the list's question order (artifact ids, duplicates dropped, first kept). */
export function setQuestionReviewOrder(artifactIds: string[]): void {
  const seen = new Set<string>();
  order = artifactIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  void setItem(KEY, JSON.stringify(order)).catch(() => undefined);
}

/** After a reload the memory is empty: read the saved order back (no-op when memory already has one). */
export async function loadQuestionReviewOrder(): Promise<void> {
  if (order.length > 0) return;
  try {
    const raw = await getItem(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(ids)) order = ids.filter((x): x is string => typeof x === "string");
  } catch {
    /* storage unavailable or bad JSON — no buttons */
  }
}

/** Where `artifactId` sits in the remembered list, with its neighbours; null when it is not in it. */
export function questionReviewNeighbours(
  artifactId: string,
): { index: number; total: number; prev: string | null; next: string | null } | null {
  const i = order.indexOf(artifactId);
  if (i < 0 || order.length < 2) return null;
  return { index: i, total: order.length, prev: i > 0 ? order[i - 1] : null, next: i < order.length - 1 ? order[i + 1] : null };
}
