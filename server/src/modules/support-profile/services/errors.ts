/** A refusal the person can act on (not a reader, wrong state, a blocked word) — the support
 *  profile's expected error (docs/prd-child-support-profile.md §3; registered in sentry.ts). */
export class SupportProfileRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportProfileRefusal";
  }
}
