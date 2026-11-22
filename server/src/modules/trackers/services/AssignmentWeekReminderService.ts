/**
 * AssignmentWeekReminderService (D-#1679) — the daily 09:00 nudge to a section's class teacher when an
 * assignment WEEK still has DRAFT items a day after delivery.
 *
 * Why: auto-issue (D-#839) waits for every expected subject to be delivered or nil-declared, so ONE
 * missing subject holds the whole week back (students get nothing). The class teacher can confirm by
 * hand (AssignmentReconcile), but only a red Today alert told them. This names the missing subject(s).
 */
import { AS_WEEKLY_CEILING_MIN, HW_SUBJECT_LABELS_BN, type HwSubject } from "@scd/shared";
import { AssignmentItem } from "../models/AssignmentItem";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { bnNum } from "../../../lib/bnNum";
import { expectedItemsForWeek, type ExpectedWeek } from "./AssignmentScheduleService";
import { AS_AUTO_ISSUE_LOOKBACK_DAYS } from "./AssignmentAutoIssueService";

/** 09:00 Dhaka — once per school day. */
export const AS_WEEK_REMINDER_MINUTES = 9 * 60;

export interface PendingAssignmentWeek {
  academicYearId: string;
  sectionId: string;
  classId: string;
  weekNumber: number;
  /** "চতুর্থ শ্রেণি · বালক" — a section name alone ("বালক") is ambiguous. */
  nameBn: string;
  /** The earliest delivery day of the week's DRAFT items (what the teacher recognises; the week index is internal). */
  deliveredOn: Date;
  /** The human week label parts (null when the expected grid could not be read). */
  month: number | null;
  weekOfMonth: number | null;
  /** Σ estMinutes of ALL the week's items (draft + issued) — over the cap, confirm is refused until trimmed. */
  totalMinutes: number;
  /** The ACTIVE class teacher; null when none or they have left (the scheduler then tells Office). */
  classTeacherId: string | null;
  draftSubjects: HwSubject[];
  missingSubjects: HwSubject[];
}

const subjectBn = (s: string): string => HW_SUBJECT_LABELS_BN[s as HwSubject] ?? s;

/** Subjects of the section's expected cells that are neither delivered nor nil-declared. */
export function missingSubjectsForSection(week: ExpectedWeek, sectionId: string): HwSubject[] {
  const out: HwSubject[] = [];
  for (const i of week.items) {
    if (i.sectionId !== sectionId || i.delivered || i.nilDeclared) continue;
    if (!out.includes(i.subject)) out.push(i.subject);
  }
  return out;
}

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** `19 Nov` → "১৯ নভেম্বর" (local day). */
export function dayMonthBn(d: Date): string {
  return `${bnNum(d.getDate())} ${BN_MONTHS[d.getMonth()]}`;
}

/** The reminder text. With nothing missing the hold is probably the weekly time cap. */
export function weekReminderBodyBn(p: {
  nameBn: string;
  deliveredOn: Date;
  draftSubjects: readonly string[];
  missingSubjects: readonly string[];
  totalMinutes: number;
}): string {
  const drafts = p.draftSubjects.map(subjectBn).join(", ");
  const head = `${p.nameBn} — ${dayMonthBn(p.deliveredOn)} থেকে দেওয়া অ্যাসাইনমেন্ট (${drafts}) এখনো ছাত্রদের কাছে যায়নি।`;
  const missing = p.missingSubjects.length > 0 ? ` বাকি: ${p.missingSubjects.map(subjectBn).join(", ")} (দেওয়া হয়নি)।` : "";
  // Over the weekly cap the confirm is REFUSED, so the reminder must say to trim first — never promise the button works.
  const action =
    p.totalMinutes > AS_WEEKLY_CEILING_MIN
      ? ` এই সপ্তাহের মোট সময় ${bnNum(p.totalMinutes)} মিনিট, সীমা ${bnNum(AS_WEEKLY_CEILING_MIN)} মিনিট — কোনো বিষয়ের সময় কমিয়ে তারপর ‘সপ্তাহ নিশ্চিত করুন’ চাপুন।`
      : " ‘সপ্তাহ নিশ্চিত করুন’ চাপলে দেওয়াগুলো ছাত্রদের কাছে যাবে।";
  return head + missing + action;
}

/** Group DRAFT rows (already filtered to a past delivery day) by (year, section, week). Pure. */
type DraftWeekGroup = { academicYearId: string; sectionId: string; weekNumber: number; deliveredOn: Date; draftSubjects: HwSubject[] };
export function groupDraftWeeks(
  rows: Array<{ academicYearId: string; sectionId: string; weekNumber: number; subject: HwSubject; deliveryDate: Date }>,
): DraftWeekGroup[] {
  const m = new Map<string, DraftWeekGroup>();
  for (const r of rows) {
    const k = `${r.academicYearId}|${r.sectionId}|${r.weekNumber}`;
    const g = m.get(k) ?? { academicYearId: r.academicYearId, sectionId: r.sectionId, weekNumber: r.weekNumber, deliveredOn: r.deliveryDate, draftSubjects: [] };
    if (r.deliveryDate < g.deliveredOn) g.deliveredOn = r.deliveryDate;
    if (!g.draftSubjects.includes(r.subject)) g.draftSubjects.push(r.subject);
    m.set(k, g);
  }
  return [...m.values()];
}

/** DRAFT items whose delivery day has passed (before the start of today), within the auto-issue look-back. */
export async function pendingAssignmentWeeks(now: Date): Promise<PendingAssignmentWeek[]> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const floor = new Date(startOfToday);
  floor.setDate(floor.getDate() - AS_AUTO_ISSUE_LOOKBACK_DAYS);

  const drafts = (await AssignmentItem.find({
    status: "DRAFT",
    deliveryDate: { $gte: floor, $lt: startOfToday },
  })
    .select("academicYearId weekNumber sectionId subject deliveryDate")
    .lean()) as unknown as Array<{
    academicYearId: { toString(): string };
    weekNumber: number;
    sectionId: { toString(): string };
    subject: HwSubject;
    deliveryDate: Date;
  }>;
  if (drafts.length === 0) return [];

  const groups = groupDraftWeeks(
    drafts.map((d) => ({
      academicYearId: d.academicYearId.toString(),
      sectionId: d.sectionId.toString(),
      weekNumber: d.weekNumber,
      subject: d.subject,
      deliveryDate: new Date(d.deliveryDate),
    })),
  );

  const sections = (await Section.find({ _id: { $in: [...new Set(groups.map((g) => g.sectionId))] }, active: true })
    .select("nameBn classId classTeacherId")
    .lean()) as unknown as Array<{ _id: { toString(): string }; nameBn: string; classId: { toString(): string }; classTeacherId?: { toString(): string } | null }>;
  const secById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classes = (await Class.find({ _id: { $in: [...new Set(sections.map((s) => s.classId.toString()))] } })
    .select("nameBn")
    .lean()) as unknown as Array<{ _id: { toString(): string }; nameBn?: string }>;
  const classBn = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? ""]));

  // Σ minutes per (section, week) across DRAFT + ISSUED items — the same total confirmAssignmentWeek checks.
  const allItems = (await AssignmentItem.find({
    sectionId: { $in: [...new Set(groups.map((g) => g.sectionId))] },
    weekNumber: { $in: [...new Set(groups.map((g) => g.weekNumber))] },
  })
    .select("academicYearId sectionId weekNumber estMinutes")
    .lean()) as unknown as Array<{ academicYearId: { toString(): string }; sectionId: { toString(): string }; weekNumber: number; estMinutes?: number }>;
  const minutes = new Map<string, number>();
  for (const it of allItems) {
    const k = `${it.academicYearId.toString()}|${it.sectionId.toString()}|${it.weekNumber}`;
    minutes.set(k, (minutes.get(k) ?? 0) + (it.estMinutes ?? 0));
  }
  // A class teacher who has left must not swallow the reminder — Office gets it instead.
  const ctIds = [...new Set(sections.map((s) => (s.classTeacherId ? s.classTeacherId.toString() : null)).filter(Boolean) as string[])];
  const activeCt = new Set(
    ((await User.find({ _id: { $in: ctIds }, active: true }).select("_id").lean()) as unknown as Array<{ _id: { toString(): string } }>).map((u) => u._id.toString()),
  );

  const weekCache = new Map<string, ExpectedWeek | null>();
  const out: PendingAssignmentWeek[] = [];
  for (const g of groups) {
    const sec = secById.get(g.sectionId);
    if (!sec) continue; // inactive / retired section
    const wk = `${g.academicYearId}|${g.weekNumber}`;
    if (!weekCache.has(wk)) {
      try {
        weekCache.set(wk, await expectedItemsForWeek(g.academicYearId, g.weekNumber));
      } catch {
        weekCache.set(wk, null);
      }
    }
    const week = weekCache.get(wk) ?? null;
    out.push({
      ...g,
      classId: sec.classId.toString(),
      nameBn: [classBn.get(sec.classId.toString()), sec.nameBn].filter(Boolean).join(" · "),
      month: week ? week.month : null,
      weekOfMonth: week ? week.weekOfMonth : null,
      totalMinutes: minutes.get(`${g.academicYearId}|${g.sectionId}|${g.weekNumber}`) ?? 0,
      classTeacherId: sec.classTeacherId && activeCt.has(sec.classTeacherId.toString()) ? sec.classTeacherId.toString() : null,
      missingSubjects: week ? missingSubjectsForSection(week, g.sectionId) : [],
    });
  }
  return out;
}
