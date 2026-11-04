/** A refusal the person can act on (wrong state, not theirs, bad reason) — D-#936. Its own
 *  file so the settings and ladder services can throw it without an import cycle. */
export class StaffMistakeError extends Error {}
