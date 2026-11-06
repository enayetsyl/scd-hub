/**
 * DailyReportService (D-#1030–#1035, docs/prd-daily-report.md) — the end-of-day school report.
 *
 *   makeDailyReport   18:00 on a school day (settings.sendMinutes): build every part, compare
 *                     yesterday's saved problems with a re-run ("fixed later"), save ONCE, then
 *                     notify the Principal + shared people who asked for it.
 *   liveReport        "today so far" — the same builders, never saved.
 *   viewFor           what one viewer may see: only the parts whose switch they hold (minus a
 *                     share past its end day), and never a Principal's own mistakes unless they
 *                     may see those (D-#1000). Headline counts cover only those parts.
 *   reportHistory     day/week/month/year: totals from the saved days, the same span before it,
 *                     and the places that went wrong on 3+ days.
 *
 * Identity/operational plane. Imports nothing from modules/corpus (ADR-005).
 */
import { Types } from "mongoose";
import {
  DAILY_REPORT_SECTIONS,
  DAILY_REPORT_SECTION_PERMISSION,
  DAILY_REPORT_DEFAULT_SEND_MINUTES,
  callerHasPermission,
  onTimeRate,
  type AccessProfile,
  type DailyReportSection,
  type Permission,
} from "@scd/shared";
import { DailyReport, type IDailyReport, type IDailyReportPart } from "../models/DailyReport";
import { DailyReportSettings, type IDailyReportSettings } from "../models/DailyReportSettings";
import { DailyReportShare } from "../models/DailyReportShare";
import { PART_BUILDERS, runPart, type PartContext } from "./dailyReportParts";
import { reconciliationReport, type ReconReport } from "../../trackers/services/ReconReportService";
import { resolveDayType } from "../../routine/calendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import { Notification } from "../../notifications/models/Notification";
import { emit } from "../../notifications/services/NotificationService";
import { principalUserIds } from "../../staff-mistakes/services/principalPrivacy";

export class DailyReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyReportError";
  }
}

/** Mistakes of a Principal are private to those holding this switch (D-#1000). */
export const PRINCIPAL_MISTAKES_PERMISSION = "staff_mistakes:review_principal" as const;
/** Widest history read (a year of school days). */
export const HISTORY_MAX_DAYS = 400;
/** A place that went wrong on this many saved days in the span is a "repeated problem". */
export const REPEAT_MIN_DAYS = 3;

export const dailyReportDedupeKey = (dateKey: string, userId: string) => `DRPT:${dateKey}:${userId}`;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface DailyReportSettingsShape {
  sendMinutes: number;
  headlineSections: DailyReportSection[];
  notifyPrincipal: boolean;
}

export async function getSettings(): Promise<DailyReportSettingsShape> {
  const row = (await DailyReportSettings.findOne({ key: "default" }).lean()) as IDailyReportSettings | null;
  return {
    sendMinutes: row?.sendMinutes ?? DAILY_REPORT_DEFAULT_SEND_MINUTES,
    headlineSections: (row?.headlineSections?.length ? row.headlineSections : [...DAILY_REPORT_SECTIONS]) as DailyReportSection[],
    notifyPrincipal: row?.notifyPrincipal ?? true,
  };
}

export async function saveSettings(
  input: { sendMinutes: number; headlineSections: string[]; notifyPrincipal: boolean },
  actorId: string,
): Promise<DailyReportSettingsShape> {
  if (!Number.isInteger(input.sendMinutes) || input.sendMinutes < 14 * 60 || input.sendMinutes > 22 * 60) {
    throw new DailyReportError("পাঠানোর সময় দুপুর ২টা থেকে রাত ১০টার মধ্যে হতে হবে।");
  }
  const sections = [...new Set(input.headlineSections)];
  if (sections.length === 0 || sections.some((s) => !(DAILY_REPORT_SECTIONS as readonly string[]).includes(s))) {
    throw new DailyReportError("শিরোনামে অন্তত একটি সঠিক অংশ বেছে নিন।");
  }
  await DailyReportSettings.updateOne(
    { key: "default" },
    { $set: { sendMinutes: input.sendMinutes, headlineSections: sections, notifyPrincipal: input.notifyPrincipal, updatedBy: new Types.ObjectId(actorId) } },
    { upsert: true },
  );
  return getSettings();
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function reconOnce(dateKey: string, asOf: Date): () => Promise<ReconReport> {
  let p: Promise<ReconReport> | null = null;
  return () => {
    if (!p) p = reconciliationReport(dateKey, dateKey, asOf, { skipNotPrinted: true });
    return p;
  };
}

/** Build the parts for a day at `asOf`. `only` limits it to some parts (the replay). */
export async function buildParts(
  dateKey: string,
  asOf: Date,
  opts: { only?: (key: DailyReportSection) => boolean } = {},
): Promise<{ dayType: string; parts: IDailyReportPart[] }> {
  const dayType = await resolveDayType(parseDateKey(dateKey));
  const ctx: PartContext = { dateKey, dayType, asOf, recon: reconOnce(dateKey, asOf) };
  const builders = PART_BUILDERS.filter((b) => !opts.only || opts.only(b.key));
  const parts = await Promise.all(builders.map((b) => runPart(b, ctx)));
  return { dayType, parts };
}

/** Re-run yesterday's replayable parts now; how many of its problems are gone (D-#1030). */
async function fixedSince(prev: IDailyReport): Promise<Map<DailyReportSection, number>> {
  const replayable = new Set(PART_BUILDERS.filter((b) => b.replayable).map((b) => b.key));
  const out = new Map<DailyReportSection, number>();
  const { parts } = await buildParts(prev.dateKey, prev.generatedAt, { only: (k) => replayable.has(k) });
  for (const now of parts) {
    const then = prev.parts.find((p) => p.key === now.key);
    if (!then || now.status === "ERROR" || then.status === "ERROR") continue;
    const fixed = Math.max(0, then.problems - now.problems);
    if (fixed > 0) out.set(now.key, fixed);
  }
  return out;
}

/**
 * Make and save the day's report (idempotent: an existing report is returned untouched).
 * Returns the saved report and whether THIS call created it.
 */
export async function makeDailyReport(dateKey: string, now = new Date()): Promise<{ report: IDailyReport; created: boolean }> {
  const existing = await DailyReport.findOne({ dateKey });
  if (existing) return { report: existing, created: false };

  const prev = await DailyReport.findOne({ dateKey: { $lt: dateKey } }).sort({ dateKey: -1 });
  const [{ dayType, parts }, fixed] = await Promise.all([
    buildParts(dateKey, now),
    prev ? fixedSince(prev).catch((err) => {
      console.error("[dailyReport] fixed-later replay failed:", err);
      return new Map<DailyReportSection, number>();
    }) : Promise.resolve(new Map<DailyReportSection, number>()),
  ]);
  for (const p of parts) p.fixedLater = fixed.get(p.key) ?? 0;

  try {
    const report = await DailyReport.create({
      dateKey,
      dayType,
      generatedAt: now,
      previousDateKey: prev?.dateKey ?? null,
      parts,
      notifiedUserIds: [],
    });
    return { report, created: true };
  } catch (err) {
    // A second process made it first (unique dateKey) — theirs is the report.
    if ((err as { code?: number }).code === 11000) {
      const report = await DailyReport.findOne({ dateKey });
      if (report) return { report, created: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

export interface DailyReportViewer {
  userId: string;
  sections: DailyReportSection[];
  mayPrincipalMistakes: boolean;
}

/** Grants a share added that are past its end day — refused even before the sweep removes them. */
async function expiredShareGrants(userId: string, todayKey: string): Promise<Set<string>> {
  const share = await DailyReportShare.findOne({ userId }).select("untilKey grantedPerms").lean();
  if (!share || !share.untilKey || share.untilKey >= todayKey) return new Set();
  return new Set(share.grantedPerms);
}

export async function viewerFor(profile: AccessProfile & { userId: string }, todayKey = dateKeyOf(new Date())): Promise<DailyReportViewer> {
  const expired = await expiredShareGrants(profile.userId, todayKey);
  const sections = DAILY_REPORT_SECTIONS.filter((s) => {
    const perm = DAILY_REPORT_SECTION_PERMISSION[s];
    return !expired.has(perm) && callerHasPermission(profile, perm as Permission);
  });
  return {
    userId: profile.userId,
    sections,
    mayPrincipalMistakes: callerHasPermission(profile, PRINCIPAL_MISTAKES_PERMISSION),
  };
}

export function assertCanSee(viewer: DailyReportViewer): void {
  if (viewer.sections.length === 0) throw new DailyReportError("দৈনিক প্রতিবেদনের কোনো অংশ দেখার অনুমতি আপনার নেই।");
}

/** One part as this viewer sees it (the Principal's own mistakes removed when they may not). */
export function partForViewer(part: IDailyReportPart, viewer: DailyReportViewer): IDailyReportPart {
  const p = plain(part);
  if (p.key !== "MISTAKES" || viewer.mayPrincipalMistakes || p.principalOwnMistakes === 0) return p;
  const items = p.items.filter((i) => !i.principalOnly);
  const mistakes = Math.max(0, p.mistakes - p.principalOwnMistakes);
  const tierStats = p.stats; // tier counts may include the hidden rows; drop them rather than mislead
  return {
    ...p,
    mistakes,
    principalOwnMistakes: 0,
    items,
    stats: tierStats.filter((s) => !/^tier[123]$/.test(s.key)),
    status: mistakes === 0 && p.problems === 0 ? (p.onTime === 0 ? "NA" : "OK") : p.status,
  };
}

export interface DailyReportHeadline {
  onTime: number;
  problems: number;
  mistakes: number;
  rate: number | null;
}

export function headlineOf(parts: IDailyReportPart[], headlineSections: readonly DailyReportSection[]): DailyReportHeadline {
  const counted = parts.filter((p) => headlineSections.includes(p.key));
  const onTime = counted.reduce((s, p) => s + p.onTime, 0);
  const problems = counted.reduce((s, p) => s + p.problems, 0);
  const mistakes = counted.reduce((s, p) => s + p.mistakes, 0);
  return { onTime, problems, mistakes, rate: onTimeRate(onTime, problems) };
}

export interface DailyReportView {
  dateKey: string;
  dayType: string;
  generatedAt: Date | null;
  /** True for "today so far" (built now, not saved). */
  live: boolean;
  headline: DailyReportHeadline;
  /** Average on-time rate of the 5 saved school days before this one, same parts. */
  previousRate: number | null;
  fixedLater: number;
  parts: IDailyReportPart[];
}

/** A hydrated report's parts are Mongoose subdocuments: `{...p}` would copy internals, not fields. */
function plain(p: IDailyReportPart): IDailyReportPart {
  const doc = p as unknown as { toObject?: () => IDailyReportPart };
  return typeof doc.toObject === "function" ? doc.toObject() : p;
}

function visibleParts(parts: IDailyReportPart[], viewer: DailyReportViewer): IDailyReportPart[] {
  return parts.map(plain).filter((p) => viewer.sections.includes(p.key)).map((p) => partForViewer(p, viewer));
}

async function previousRate(dateKey: string, viewer: DailyReportViewer, headlineSections: readonly DailyReportSection[]): Promise<number | null> {
  const prior = (await DailyReport.find({ dateKey: { $lt: dateKey } }).sort({ dateKey: -1 }).limit(5).lean()) as unknown as IDailyReport[];
  if (prior.length === 0) return null;
  let onTime = 0;
  let problems = 0;
  for (const r of prior) {
    const h = headlineOf(visibleParts(r.parts, viewer), headlineSections);
    onTime += h.onTime;
    problems += h.problems;
  }
  return onTimeRate(onTime, problems);
}

async function toView(
  r: { dateKey: string; dayType: string; generatedAt: Date | null; parts: IDailyReportPart[] },
  viewer: DailyReportViewer,
  live: boolean,
): Promise<DailyReportView> {
  const settings = await getSettings();
  const parts = visibleParts(r.parts, viewer);
  return {
    dateKey: r.dateKey,
    dayType: r.dayType,
    generatedAt: r.generatedAt,
    live,
    headline: headlineOf(parts, settings.headlineSections),
    previousRate: await previousRate(r.dateKey, viewer, settings.headlineSections),
    fixedLater: parts.reduce((s, p) => s + (p.fixedLater ?? 0), 0),
    parts,
  };
}

/** A saved day, or — for today before the send time — the live "so far" view. Null = no report that day. */
export async function dailyReportFor(dateKey: string, viewer: DailyReportViewer, now = new Date()): Promise<DailyReportView | null> {
  parseDateKey(dateKey);
  assertCanSee(viewer);
  const saved = (await DailyReport.findOne({ dateKey }).lean()) as unknown as IDailyReport | null;
  if (saved) return toView(saved, viewer, false);
  if (dateKey !== dateKeyOf(now)) return null;
  return liveReport(viewer, now);
}

export async function liveReport(viewer: DailyReportViewer, now = new Date()): Promise<DailyReportView> {
  assertCanSee(viewer);
  const dateKey = dateKeyOf(now);
  const allowed = new Set(viewer.sections);
  const { dayType, parts } = await buildParts(dateKey, now, { only: (k) => allowed.has(k) });
  return toView({ dateKey, dayType, generatedAt: null, parts }, viewer, true);
}

// ---------------------------------------------------------------------------
// History (D-#1033)
// ---------------------------------------------------------------------------

export interface HistoryDay {
  dateKey: string;
  onTime: number;
  problems: number;
  mistakes: number;
  rate: number | null;
}
export interface HistoryPart {
  key: DailyReportSection;
  onTime: number;
  problems: number;
  mistakes: number;
  rate: number | null;
  prevRate: number | null;
}
export interface RepeatedProblem {
  key: DailyReportSection;
  title: string;
  subtitle: string | null;
  days: number;
}
export interface DailyReportHistory {
  fromKey: string;
  toKey: string;
  days: HistoryDay[];
  total: DailyReportHeadline;
  previous: DailyReportHeadline;
  parts: HistoryPart[];
  repeated: RepeatedProblem[];
}

function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKeyOf(d);
}

function spanDays(fromKey: string, toKey: string): number {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / 86_400_000) + 1;
}

export async function reportHistory(fromKey: string, toKey: string, viewer: DailyReportViewer): Promise<DailyReportHistory> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  if (fromKey > toKey) throw new DailyReportError("শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।");
  const span = spanDays(fromKey, toKey);
  if (span > HISTORY_MAX_DAYS) throw new DailyReportError(`একবারে সর্বোচ্চ ${HISTORY_MAX_DAYS} দিন দেখা যায়।`);
  assertCanSee(viewer);
  const settings = await getSettings();
  const prevFrom = addDays(fromKey, -span);
  const prevTo = addDays(fromKey, -1);

  const [rows, prevRows] = await Promise.all([
    DailyReport.find({ dateKey: { $gte: fromKey, $lte: toKey } }).sort({ dateKey: 1 }).lean() as unknown as Promise<IDailyReport[]>,
    DailyReport.find({ dateKey: { $gte: prevFrom, $lte: prevTo } }).lean() as unknown as Promise<IDailyReport[]>,
  ]);

  const days: HistoryDay[] = [];
  const byPart = new Map<DailyReportSection, { onTime: number; problems: number; mistakes: number }>();
  const repeats = new Map<string, RepeatedProblem>();
  for (const r of rows) {
    const parts = visibleParts(r.parts, viewer);
    const h = headlineOf(parts, settings.headlineSections);
    days.push({ dateKey: r.dateKey, ...h });
    for (const p of parts) {
      const acc = byPart.get(p.key) ?? { onTime: 0, problems: 0, mistakes: 0 };
      acc.onTime += p.onTime;
      acc.problems += p.problems;
      acc.mistakes += p.mistakes;
      byPart.set(p.key, acc);
      // Places and duties only (owner 2026-11-06): group by part + place, never by person.
      if (p.key === "MISTAKES" || p.key === "WORK_BOARD") continue;
      const seen = new Set<string>();
      for (const it of p.items) {
        if (it.tone === "INFO") continue;
        const k = `${p.key}|${it.title}|${p.key === "CLASS_TEST" ? "" : it.value ?? ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const cur = repeats.get(k) ?? { key: p.key, title: it.title, subtitle: p.key === "CLASS_TEST" ? null : it.value, days: 0 };
        cur.days += 1;
        repeats.set(k, cur);
      }
    }
  }
  const prevByPart = new Map<DailyReportSection, { onTime: number; problems: number }>();
  let pOn = 0;
  let pProb = 0;
  let pMis = 0;
  for (const r of prevRows) {
    const parts = visibleParts(r.parts, viewer);
    const h = headlineOf(parts, settings.headlineSections);
    pOn += h.onTime;
    pProb += h.problems;
    pMis += h.mistakes;
    for (const p of parts) {
      const acc = prevByPart.get(p.key) ?? { onTime: 0, problems: 0 };
      acc.onTime += p.onTime;
      acc.problems += p.problems;
      prevByPart.set(p.key, acc);
    }
  }
  const sum = (f: (d: HistoryDay) => number) => days.reduce((s, d) => s + f(d), 0);
  const onTime = sum((d) => d.onTime);
  const problems = sum((d) => d.problems);
  return {
    fromKey,
    toKey,
    days,
    total: { onTime, problems, mistakes: sum((d) => d.mistakes), rate: onTimeRate(onTime, problems) },
    previous: { onTime: pOn, problems: pProb, mistakes: pMis, rate: onTimeRate(pOn, pProb) },
    parts: viewer.sections.map((key) => {
      const a = byPart.get(key) ?? { onTime: 0, problems: 0, mistakes: 0 };
      const b = prevByPart.get(key);
      return { key, ...a, rate: onTimeRate(a.onTime, a.problems), prevRate: b ? onTimeRate(b.onTime, b.problems) : null };
    }),
    repeated: [...repeats.values()]
      .filter((r) => r.days >= REPEAT_MIN_DAYS)
      .sort((a, b) => b.days - a.days)
      .slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// The 18:00 notification (D-#1032) + the unread Today card
// ---------------------------------------------------------------------------

const bn = (n: number): string => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export function notificationBody(h: DailyReportHeadline, prevRate: number | null): string {
  const line1 = `সময়মতো ${bn(h.onTime)} · সমস্যা ${bn(h.problems)} · ভুল ${bn(h.mistakes)}`;
  if (h.rate == null) return line1;
  const prev = prevRate == null ? "" : ` (আগের ৫ দিনে ${bn(prevRate)}%)`;
  return `${line1}\nসময়মতো কাজ ${bn(h.rate)}%${prev}`;
}

/** Who gets the 18:00 notification: the Principal(s) (unless switched off) and every active share
 *  with notify on — each only if they can still see at least one part. */
export async function notificationRecipients(todayKey: string): Promise<DailyReportViewer[]> {
  const settings = await getSettings();
  const ids = new Set<string>();
  if (settings.notifyPrincipal) for (const id of await principalUserIds()) ids.add(id);
  const shares = await DailyReportShare.find({ notify: true }).select("userId untilKey").lean();
  for (const s of shares) if (!s.untilKey || s.untilKey >= todayKey) ids.add(s.userId.toString());
  if (ids.size === 0) return [];
  const users = await User.find({ _id: { $in: [...ids] }, active: true, role: { $ne: "GUARDIAN" } })
    .select("role additionalTemplates grantedPermissions revokedPermissions")
    .lean();
  const out: DailyReportViewer[] = [];
  for (const u of users) {
    const v = await viewerFor(
      {
        userId: u._id.toString(),
        role: u.role,
        additionalTemplates: u.additionalTemplates ?? [],
        grantedPermissions: u.grantedPermissions ?? [],
        revokedPermissions: u.revokedPermissions ?? [],
      },
      todayKey,
    );
    if (v.sections.length > 0) out.push(v);
  }
  return out;
}

export async function notifyDailyReport(report: IDailyReport): Promise<number> {
  const recipients = await notificationRecipients(report.dateKey);
  const settings = await getSettings();
  let n = 0;
  const notified: Types.ObjectId[] = [];
  for (const v of recipients) {
    try {
      const parts = visibleParts(report.parts, v);
      const h = headlineOf(parts, settings.headlineSections);
      const prev = await previousRate(report.dateKey, v, settings.headlineSections);
      const res = await emit({
        recipientUserId: v.userId,
        kind: "DAILY_REPORT",
        titleBn: "আজকের দৈনিক প্রতিবেদন",
        bodyBn: notificationBody(h, prev),
        refs: { date: report.dateKey },
        dedupeKey: dailyReportDedupeKey(report.dateKey, v.userId),
      });
      if (res.created) n += 1;
      notified.push(new Types.ObjectId(v.userId));
    } catch (err) {
      console.error("[dailyReport] notify failed (never blocks the others):", err);
    }
  }
  if (notified.length > 0) await DailyReport.updateOne({ _id: report._id }, { $addToSet: { notifiedUserIds: { $each: notified } } });
  return n;
}

/** The scheduler entry: make the day's report once and notify. Returns notifications created. */
export async function runDailyReport(now = new Date()): Promise<number> {
  const dateKey = dateKeyOf(now);
  const { report, created } = await makeDailyReport(dateKey, now);
  if (!created) return 0;
  return notifyDailyReport(report);
}

/** The Today card: the newest daily-report notification this person has not opened yet. */
export async function myUnreadDailyReport(viewer: DailyReportViewer): Promise<DailyReportView | null> {
  if (viewer.sections.length === 0) return null;
  const row = await Notification.findOne({ recipientUserId: viewer.userId, kind: "DAILY_REPORT", readAt: null })
    .sort({ createdAt: -1 })
    .select("refs")
    .lean();
  const dateKey = (row?.refs as { date?: string } | undefined)?.date;
  if (!dateKey) return null;
  const saved = (await DailyReport.findOne({ dateKey }).lean()) as unknown as IDailyReport | null;
  return saved ? toView(saved, viewer, false) : null;
}

/** Opening a day's report marks its notification read (so the Today card goes away). */
export async function markDailyReportSeen(userId: string, dateKey: string): Promise<void> {
  await Notification.updateMany(
    { recipientUserId: userId, kind: "DAILY_REPORT", readAt: null, "refs.date": dateKey },
    { $set: { readAt: new Date() } },
  );
}
