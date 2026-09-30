/**
 * GuardianAnnouncement — a short school-wide message shown to guardians as a
 * popup on their first app open of each day, for a fixed window (D-#700).
 *
 * WHY THIS IS DATA AND NOT A HARDCODED BANNER. The window has an end date, and
 * the thing that ends it must not be a deploy: an announcement that can only be
 * stopped by shipping code is one that stays up too long. The text is Bangla
 * prose a parent reads, so it must be correctable in a minute, not a release.
 *
 * WHY IT IS NOT A NOTIFICATION. The inbox already carries 677
 * `EXAM_SYLLABUS_PUBLISHED` rows, 535 of them unread — one per published row per
 * guardian. Another inbox row is noise in a channel that is already saturated;
 * a popup is the instrument for "you have not noticed this yet", precisely
 * because it interrupts once and then goes away.
 *
 * SCOPE: guardians only, one active announcement at a time. `audience` exists so
 * a staff announcement is a value rather than a schema change, but nothing reads
 * anything but GUARDIAN today.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const ANNOUNCEMENT_AUDIENCES = ["GUARDIAN"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export interface IGuardianAnnouncement extends Document {
  _id: Types.ObjectId;
  audience: AnnouncementAudience;
  titleBn: string;
  bodyBn: string;
  /** The dismiss button's words. Falls back to a generic "ঠিক আছে" when empty. */
  ctaBn: string;
  /**
   * Where the CTA sends them, as a guardian TAB name the app already registers
   * (e.g. "GuardianSyllabusTab"). Free text rather than an enum: the app owns
   * its own route names, and mirroring them here would be a second place to
   * update every time a tab is renamed. An unknown value simply closes the
   * popup — see the app's `announcementTarget`.
   */
  deepLinkTab: string;
  /**
   * Dhaka-local date keys, inclusive. "Once a day for 7 days" is a WINDOW, not a
   * count of showings: a guardian who opens the app twice in the window sees it
   * twice, one who never opens it sees it never, and it stops on `endsOn`
   * whatever happened in between. A per-guardian counter would keep the message
   * alive for weeks for an infrequent user, long after it stopped being news.
   */
  startsOn: string;
  endsOn: string;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianAnnouncementSchema = new Schema<IGuardianAnnouncement>(
  {
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, required: true, default: "GUARDIAN" },
    titleBn: { type: String, required: true, trim: true },
    bodyBn: { type: String, required: true, trim: true },
    ctaBn: { type: String, default: "" },
    deepLinkTab: { type: String, default: "" },
    startsOn: { type: String, required: true },
    endsOn: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

/** The only read there is: "is anything live for this audience today?" */
GuardianAnnouncementSchema.index({ audience: 1, active: 1, startsOn: 1, endsOn: 1 });

/** `YYYY-MM-DD`, the same shape `dhakaDayKey` produces. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns a Bangla error, or null when the announcement is well formed.
 *
 * Exported so the seeding script runs the identical check — a window typed as
 * `2026-9-30` would silently never match a `2026-09-30` key and the popup would
 * simply never appear, with nothing anywhere saying why.
 */
export function validateAnnouncement(a: {
  titleBn?: string;
  bodyBn?: string;
  startsOn?: string;
  endsOn?: string;
}): string | null {
  if (!a.titleBn?.trim()) return "ঘোষণার শিরোনাম দিতে হবে।";
  if (!a.bodyBn?.trim()) return "ঘোষণার বক্তব্য দিতে হবে।";
  if (!a.startsOn || !DATE_KEY.test(a.startsOn)) return "শুরুর তারিখ YYYY-MM-DD আকারে দিতে হবে।";
  if (!a.endsOn || !DATE_KEY.test(a.endsOn)) return "শেষের তারিখ YYYY-MM-DD আকারে দিতে হবে।";
  // String comparison is correct for zero-padded ISO keys, and is what the query
  // uses too — so a window that validates here is a window that can match.
  if (a.endsOn < a.startsOn) return "শেষের তারিখ শুরুর তারিখের আগে হতে পারে না।";
  return null;
}

export const GuardianAnnouncement = model<IGuardianAnnouncement>(
  "GuardianAnnouncement",
  GuardianAnnouncementSchema,
);
