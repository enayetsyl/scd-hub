/**
 * ‹ আগের / পরের › on the question-review thread screen (owner 20 Nov 2026).
 *
 * A list screen (the reviewer's queue, the publish inbox, a reviewer's rounds) remembers the ORDER of
 * the questions it showed at the moment one is opened; the thread screen then steps through that same
 * order without going back to the list. Held in memory only: a web reload or a cold start simply has no
 * list, and the buttons do not show.
 */
let order: string[] = [];

/** Remember the list's question order (artifact ids, duplicates dropped, first kept). */
export function setQuestionReviewOrder(artifactIds: string[]): void {
  const seen = new Set<string>();
  order = artifactIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

/** Where `artifactId` sits in the remembered list, with its neighbours; null when it is not in it. */
export function questionReviewNeighbours(
  artifactId: string,
): { index: number; total: number; prev: string | null; next: string | null } | null {
  const i = order.indexOf(artifactId);
  if (i < 0 || order.length < 2) return null;
  return { index: i, total: order.length, prev: i > 0 ? order[i - 1] : null, next: i < order.length - 1 ? order[i + 1] : null };
}
