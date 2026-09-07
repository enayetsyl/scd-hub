/**
 * attachToExisting — add rows to groups that already exist, and to nothing else.
 *
 * The tracker workspaces build one card per item from the OPEN rows, then hand back a
 * few rows that were deliberately left out of that set: the returns from an earlier day
 * (D-#648). Those rows must decorate a card that is already on the deck and must never
 * bring a card back, because an item whose only remaining rows are old returns is
 * FINISHED and belongs in the completed fold at the foot of the screen.
 *
 * That is the whole reason this is a named function rather than an inline `push`. The
 * failure it prevents is silent: a resurrected card looks like ordinary work still to
 * do, so a teacher would go hunting for homework that was handed back last week. The
 * screens also render subject folds by calling the grouper once per subject with a
 * SUBSET of the items, so "the group exists" is narrower than "the item is open" — a
 * row whose card is in the other fold has to be dropped, not attached to whatever is
 * nearest.
 *
 * Deliberately PURE — no React, no React Native, no `labels` import — so the server
 * suite can unit-test it, as it already does for `homeworkText.ts` and `nameList.ts`.
 * The app workspace has no test runner.
 */
export function attachToExisting<T, G extends { rows: T[] }>(
  groups: ReadonlyMap<string, G>,
  rows: readonly T[],
  keyOf: (row: T) => string,
): void {
  for (const row of rows) {
    const group = groups.get(keyOf(row));
    if (group) group.rows.push(row);
  }
}
