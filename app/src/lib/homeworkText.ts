/**
 * homeworkText — does a class-note's "যা পড়ালাম" text ANNOUNCE homework? (D-#505)
 *
 * Owner review 2026-08-17: on one day three teachers wrote "H.W-...", "hw-...",
 * "H.w-- ..." inside the taught-summary, and only ONE of them also declared a
 * homework item — one of the others had in fact declared "no homework" for the same
 * period. The guardian's day then showed one homework plus a "no homework" notice
 * while the lesson text mentioned three. Nothing was broken: prose in a class note
 * is not a declaration, and the app cannot know it was meant to be one.
 *
 * So the daily-entry card warns whoever is about to publish exactly that. It NEVER
 * blocks — a note may legitimately mention last week's homework, and being unable to
 * publish a truthful lesson summary would be worse than the mismatch.
 *
 * Deliberately its own pure module: the app workspace has no test runner, so the
 * regex is unit-tested from the server suite (`homeworkTextHint.test.ts`) the way
 * `navInitialRoute.test.ts` covers app-side navigation rules. Keep this file free of
 * React and React Native imports or that test can no longer load it.
 */

/** `H.W`, `H.w`, `hw`, `হোমওয়ার্ক`, `বাড়ির কাজ` (and the `বাড়ীর` spelling) — the
 *  forms teachers actually type. A bare "h w" is NOT matched: it fires on ordinary
 *  English ("ah well") for nothing, and a false warning on every note would train
 *  teachers to ignore the real one. */
const HW_LATIN = /(^|[^\p{L}])(h\.\s?w|hw)/iu;
const HW_BANGLA = /হোমওয়ার্ক|বাড়ির\s*কাজ|বাড়ীর\s*কাজ/u;

export function mentionsHomework(text: string): boolean {
  return HW_LATIN.test(text) || HW_BANGLA.test(text);
}
