/**
 * The all-rounder card (SB-7, D-#987, docs/prd-storybook-reading.md): how BALANCED a child is,
 * beside the existing progress card (which says which way they are going).
 *
 * Each area gets a 0–100 score and a band; the overall score is the plain average of the areas
 * that HAVE data (a missing area never pulls it down); overall bands ≥ 80 / 60–79 / < 60. No
 * classmate comparison. Worked out when read, never stored (the D-#85 posture).
 *
 *   ATTENDANCE   present % over 90 days               ≥ 90 / 80–89 / < 80
 *   CLASS_TEST   average %                            ≥ 80 or rising (≥ 60) / 60–79 / < 60 or at risk
 *   HOMEWORK     completion %                         ≥ 90 / 80–89 / < 80
 *   ASSIGNMENT   ½ on-time % + ½ marks %              ≥ 80 / 60–79 / < 60
 *   READING      storybooks read in 30 days ÷ target  ≥ 80 / 50–79 / < 50 — counts once the
 *                (the desk's tick at return), ≤ 100   child has borrowed a storybook at all
 *   ACTIVITY     activity sheets finished (back, not অসম্পূর্ণ) in 30 days ÷ the monthly target
 *                (rule, default 8), ≤ 100; ≥ 80 / 50–79 / < 50 — counts once the child has had
 *                a sheet (AS-6, D-#987/#991)
 * Quran is left out for now (owner, D-#987).
 */
import { BookLoan } from "../../library/models/BookLoan";
import { BookTitle } from "../../library/models/BookTitle";
import { wholePicture, type WholePicture } from "./WholePictureService";
import { ActivityIssue } from "../../activity-sheets/models/ActivityIssue";
import { activityRules } from "../../activity-sheets/services/ActivitySettingsService";

export const ALL_ROUNDER_AREAS = ["ATTENDANCE", "CLASS_TEST", "HOMEWORK", "ASSIGNMENT", "READING", "ACTIVITY"] as const;
export type AllRounderArea = (typeof ALL_ROUNDER_AREAS)[number];
export type AllRounderBand = "STRONG" | "OK" | "ATTENTION" | "NONE" | "SOON";

/** D-#990 default: 4 storybooks a month for the 3–6 band. */
export const READING_MONTHLY_TARGET = 4;
const READING_DAYS = 30;
const DAY_MS = 86_400_000;

export interface AreaScore {
  area: AllRounderArea;
  score: number | null;
  band: AllRounderBand;
  /** The raw figure behind the score (a percentage; books read for READING; sheets finished for ACTIVITY). */
  value: number | null;
}

export interface AllRounder {
  studentId: string;
  score: number | null;
  band: AllRounderBand;
  strongCount: number;
  countedAreas: number;
  areas: AreaScore[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const band3 = (score: number, strong: number, ok: number): AllRounderBand => (score >= strong ? "STRONG" : score >= ok ? "OK" : "ATTENTION");

/** Activity sheets for the card: finished in 30 days, the monthly target, whether the child ever had one. */
export interface ActivityCount {
  done: number;
  target: number;
  ever: boolean;
}
const NO_ACTIVITY: ActivityCount = { done: 0, target: 8, ever: false };

/** Pure: the school areas, reading and activity sheets from their counts. */
export function areasOf(
  wp: Pick<WholePicture, "attendance" | "classTest" | "homework" | "assignment">,
  reading: { read: number; everBorrowed: boolean },
  activity: ActivityCount = NO_ACTIVITY,
): AreaScore[] {
  const out: AreaScore[] = [];
  // Attendance
  if (wp.attendance.markedDays > 0) {
    const s = clamp(wp.attendance.presentPct);
    out.push({ area: "ATTENDANCE", score: s, band: band3(s, 90, 80), value: wp.attendance.presentPct });
  } else out.push({ area: "ATTENDANCE", score: null, band: "NONE", value: null });
  // Class tests
  const avg = wp.classTest.avgPercent;
  if (avg !== null && avg !== undefined) {
    const s = clamp(avg);
    const band: AllRounderBand = wp.classTest.atRisk
      ? "ATTENTION"
      : s >= 80 || (wp.classTest.trajectory === "up" && s >= 60)
        ? "STRONG"
        : s >= 60
          ? "OK"
          : "ATTENTION";
    out.push({ area: "CLASS_TEST", score: s, band, value: avg });
  } else out.push({ area: "CLASS_TEST", score: null, band: "NONE", value: null });
  // Homework
  if (wp.homework.completionPct !== null && wp.homework.completionPct !== undefined) {
    const s = clamp(wp.homework.completionPct);
    out.push({ area: "HOMEWORK", score: s, band: band3(s, 90, 80), value: wp.homework.completionPct });
  } else out.push({ area: "HOMEWORK", score: null, band: "NONE", value: null });
  // Assignments
  const a = wp.assignment;
  const settled = a.total - a.pending;
  if (settled > 0) {
    const onTime = ((settled - Math.min(a.late, settled)) / settled) * 100;
    const s = clamp(a.avgMarksPct === null || a.avgMarksPct === undefined ? onTime : (onTime + a.avgMarksPct) / 2);
    out.push({ area: "ASSIGNMENT", score: s, band: band3(s, 80, 60), value: s });
  } else out.push({ area: "ASSIGNMENT", score: null, band: "NONE", value: null });
  // Reading
  if (reading.everBorrowed) {
    const s = clamp((reading.read / READING_MONTHLY_TARGET) * 100);
    out.push({ area: "READING", score: s, band: band3(s, 80, 50), value: reading.read });
  } else out.push({ area: "READING", score: null, band: "NONE", value: null });
  // Activity sheets (AS-6): finished in 30 days against the monthly target.
  if (activity.ever) {
    const s = clamp((activity.done / Math.max(1, activity.target)) * 100);
    out.push({ area: "ACTIVITY", score: s, band: band3(s, 80, 50), value: activity.done });
  } else out.push({ area: "ACTIVITY", score: null, band: "NONE", value: null });
  return out;
}

/** An overall from one area alone ("১০০/১০০" off a single book count) would overstate — the
 *  areas still show, the headline waits for a second. */
export const MIN_AREAS_FOR_OVERALL = 2;

/** Pure: the overall from the areas that have data. */
export function overallOf(areas: AreaScore[]): Pick<AllRounder, "score" | "band" | "strongCount" | "countedAreas"> {
  const counted = areas.filter((a) => a.score !== null);
  const strongCount = counted.filter((a) => a.band === "STRONG").length;
  if (counted.length < MIN_AREAS_FOR_OVERALL) return { score: null, band: "NONE", strongCount, countedAreas: counted.length };
  const score = clamp(counted.reduce((n, a) => n + (a.score as number), 0) / counted.length);
  return { score, band: band3(score, 80, 60), strongCount: counted.filter((a) => a.band === "STRONG").length, countedAreas: counted.length };
}

async function readingOf(studentId: string, now: Date): Promise<{ read: number; everBorrowed: boolean }> {
  const loans = await BookLoan.find({ studentId, borrowerType: "STUDENT" }).select("titleId status readAtReturn returnedAt").lean();
  if (loans.length === 0) return { read: 0, everBorrowed: false };
  const story = await BookTitle.find({ _id: { $in: loans.map((l) => l.titleId) }, seriesId: { $exists: true } }).select("_id").lean();
  const ids = new Set(story.map((t) => t._id.toString()));
  const mine = loans.filter((l) => ids.has(l.titleId.toString()));
  const from = now.getTime() - READING_DAYS * DAY_MS;
  return {
    everBorrowed: mine.length > 0,
    read: mine.filter((l) => l.status === "RETURNED" && l.readAtReturn === true && l.returnedAt && new Date(l.returnedAt).getTime() >= from).length,
  };
}

async function activityOf(studentId: string, now: Date): Promise<ActivityCount> {
  const from = new Date(now.getTime() - READING_DAYS * DAY_MS);
  const [ever, done, rules] = await Promise.all([
    ActivityIssue.exists({ studentId, status: { $ne: "CANCELLED" } }),
    ActivityIssue.countDocuments({ studentId, status: "RETURNED", result: { $ne: "INCOMPLETE" }, returnedAt: { $gte: from } }),
    activityRules(),
  ]);
  return { done, target: rules.monthlyTarget, ever: !!ever };
}

/** Pure: the card without some areas (a guardian whose READING / ACTIVITY feature is off, D-#1011),
 *  the overall re-worked from what is left. */
export function withoutAreas(r: AllRounder, drop: readonly AreaScore["area"][]): AllRounder {
  if (drop.length === 0) return r;
  const areas = r.areas.filter((a) => !drop.includes(a.area));
  return { studentId: r.studentId, areas, ...overallOf(areas) };
}

export async function allRounder(studentId: string, now: Date = new Date()): Promise<AllRounder> {
  const [wp, reading, activity] = await Promise.all([wholePicture(studentId, now), readingOf(studentId, now), activityOf(studentId, now)]);
  const areas = areasOf(wp, reading, activity);
  return { studentId, areas, ...overallOf(areas) };
}
