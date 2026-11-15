/**
 * Version-created hooks: later slices register work that must run in the same flow as version
 * creation (BL-2: errata carried into the version when their item becomes applied). Kept as a
 * registry so versionService does not import every later service (and so tests see one door).
 */
import type { AuthPayload } from "../../../context";
import type { ISchoolBook } from "../models/SchoolBook";
import type { IBookVersion } from "../models/BookVersion";
import type { IBookFeedback } from "../models/BookFeedback";

export type VersionCreatedHook = (book: ISchoolBook, version: IBookVersion, actor: AuthPayload) => Promise<void>;
const hooks: VersionCreatedHook[] = [];

export function registerVersionCreatedHook(h: VersionCreatedHook): void {
  if (!hooks.includes(h)) hooks.push(h);
}

export async function onVersionCreatedHooks(book: ISchoolBook, version: IBookVersion, actor: AuthPayload): Promise<void> {
  for (const h of hooks) await h(book, version, actor);
}

/** Work a triage route triggers (BL-2: verbal_errata → an erratum draft on the current release). */
export type TriageHook = (book: ISchoolBook, item: IBookFeedback, auth: AuthPayload) => Promise<void>;
const triageHooks: TriageHook[] = [];
export function registerTriageHook(h: TriageHook): void {
  if (!triageHooks.includes(h)) triageHooks.push(h);
}
export async function onTriageHooks(book: ISchoolBook, item: IBookFeedback, auth: AuthPayload): Promise<void> {
  for (const h of triageHooks) await h(book, item, auth);
}
