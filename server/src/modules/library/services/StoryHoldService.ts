/**
 * Storybook holds for children (SB-3, D-#982): when a returned book is promoted to the
 * first child in line, the hold lasts N WORKING days (the school calendar's FULL days —
 * Sun–Thu, holidays excluded; one calendar source, routine/calendar.ts), and the child's
 * guardians are told the book is waiting at the office (LIBRARY_HOLD_READY).
 *
 * Kept apart from LibraryReservationService so the queue mechanics stay one small file and
 * the DB-free reservation tests (staff holds, calendar days) are untouched.
 */
import { guardiansWithFeature } from "../../guardian-access/services/GuardianFeatureService";
import { buildDayTypeResolver } from "../../routine/calendar";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Guardian } from "../../foundation/models/Guardian";
import { Student } from "../../foundation/models/Student";
import { emit } from "../../notifications/services/NotificationService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { BookTitle } from "../models/BookTitle";
import type { IBookReservation } from "../models/BookReservation";

const DAY_MS = 86_400_000;

/** End (23:59:59 Dhaka) of the `days`-th working day AFTER `from`'s day. */
export async function workingDaysHoldEnd(from: Date, days: number): Promise<Date> {
  const n = Math.max(1, Math.floor(days));
  const resolve = await buildDayTypeResolver(from, new Date(from.getTime() + (n * 7 + 31) * DAY_MS));
  let d = new Date(from);
  let counted = 0;
  for (let guard = 0; counted < n && guard < 400; guard++) {
    d = new Date(d.getTime() + DAY_MS);
    if (resolve(d) === "FULL") counted += 1;
  }
  return new Date(`${dhakaDayKey(d)}T23:59:59+06:00`);
}

const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** "2026-11-09" → "৯ নভেম্বর" for a guardian-facing line. */
export function bnDayLabel(dayKey: string): string {
  const [, m, d] = dayKey.split("-").map(Number);
  const day = String(d).replace(/\d/g, (x) => BN_DIGITS[Number(x)]);
  return `${day} ${MONTHS_BN[m - 1] ?? ""}`.trim();
}

/** Dedupe per hold AND per guardian — an entity-only key would swallow the second parent. */
export const holdReadyKey = (reservationId: string, guardianId: string): string => `LIBHR:${reservationId}:${guardianId}`;

/** Tell the child's linked, active guardians that the book is held for them. Best effort. */
export async function notifyHoldReady(resv: Pick<IBookReservation, "_id" | "titleId" | "studentId" | "expiresAt">): Promise<number> {
  if (!resv.studentId) return 0;
  const [title, student, links] = await Promise.all([
    BookTitle.findById(resv.titleId).select("titleBn").lean(),
    Student.findById(resv.studentId).select("name nameBn").lean(),
    GuardianLink.find({ studentId: resv.studentId }).select("guardianId active").lean(),
  ]);
  const guardianIds = links.filter((l) => l.active !== false).map((l) => l.guardianId);
  if (guardianIds.length === 0) return 0;
  const guardians = await guardiansWithFeature("STORYBOOKS", await Guardian.find({ _id: { $in: guardianIds }, active: true }).select("_id").lean());
  const child = student?.nameBn || student?.name || "";
  const until = resv.expiresAt ? bnDayLabel(dhakaDayKey(new Date(resv.expiresAt))) : "";
  let sent = 0;
  for (const g of guardians) {
    const res = await emit({
      recipientGuardianId: g._id.toString(),
      recipientUserId: null,
      kind: "LIBRARY_HOLD_READY",
      titleBn: "বই আপনার জন্য রাখা আছে",
      bodyBn: `“${title?.titleBn ?? "বই"}” ${child}-এর জন্য অফিসে রাখা আছে${until ? ` — ${until}-এর মধ্যে নিয়ে নিন` : ""}।`,
      refs: { studentId: resv.studentId.toString() },
      dedupeKey: holdReadyKey(resv._id.toString(), g._id.toString()),
    }).catch((e) => {
      console.warn("hold-ready notice failed:", (e as Error)?.message);
      return { created: false };
    });
    if (res.created) sent += 1;
  }
  return sent;
}
