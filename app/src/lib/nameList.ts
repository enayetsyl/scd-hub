/**
 * nameList — name a short roster inline, fall back to a count when it gets long.
 *
 * The tracker cards carry several collapsed groups whose label was a bare number:
 * "পুনঃবিতরণ · ১". The names were always there, one tap away inside the fold, but the
 * teacher's actual question at that moment is *who* — and for the usual case (one
 * student absent when the work went out) the count carries no information the word
 * beside it doesn't already give. Owner ask, 2026-09-07: show the person's name on
 * the card.
 *
 * A threshold rather than always-names, because these labels sit on a Button title
 * inside a card that already lists two roster passes: a heavy-absence day would wrap
 * to several lines and push the passes off-screen, which costs more than the tap it
 * saves.
 *
 * Deliberately its own PURE module — no React, no React Native, no `labels` import
 * (the caller formats the count, so this file never has to know about Bangla
 * numerals). The app workspace has no test runner, so keeping it free of those
 * imports is what lets the server suite unit-test it, the way `homeworkText.ts` and
 * `notificationNav.ts` are already covered.
 */

/** How many names read comfortably on one Button title. */
export const NAME_LIST_MAX = 3;

/**
 * `names` joined for display, or `countLabel` when the list is too long to read —
 * or when any name is blank.
 *
 * The blank guard matters: dropping an empty name would shorten the list without
 * shortening the group, so the label would name two students for a group of four.
 * A count is honest where the names are not.
 */
export function namesOrCount(
  names: string[],
  countLabel: string,
  max: number = NAME_LIST_MAX,
): string {
  if (names.length === 0 || names.length > max) return countLabel;
  const clean = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (clean.length !== names.length) return countLabel;
  return clean.join(", ");
}
