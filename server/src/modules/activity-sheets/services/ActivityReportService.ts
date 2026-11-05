/**
 * Activity-sheet reports (AS-5, D-#988) — each tab its own Reports-hub switch (D-#861):
 *   - by skill (reports:activity_skills): per skill area — sheets finished, all-correct rate,
 *     children; and a class × skill grid of finished sheets.
 *   - by bank (reports:activity_sheets): per bank and level — given, back, all-correct rate,
 *     not returned, repeats, tray vs guardian; banks nobody took; "too hard" levels.
 *   - children (reports:activity_students — names children): per child — finished, all
 *     correct, open, not returned, favourite skill, last sheet; per section totals.
 * Window: d30 / d90 / year (the storybook report's windows). Identity plane; no corpus path.
 */
import { Types } from "mongoose";
import { ACTIVITY_LEVELS, ACTIVITY_SKILL_AREAS, ACTIVITY_SKILL_LABELS_BN, ROSTER_CLASS_LABELS_BN, type ActivitySkillArea, type RosterClassLevel } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { windowStart } from "../../library/services/StoryReportService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { ActivitySheet } from "../models/ActivitySheet";
import { ActivityIssue, type IActivityIssue } from "../models/ActivityIssue";
import { sweepNotReturned } from "./ActivityFollowUpService";

/** A level is flagged "too hard" when at least this many came back and under 40% all correct. */
export const HARD_MIN_RETURNS = 5;
export const HARD_RATE = 0.4;

const finished = (i: IActivityIssue) => i.status === "RETURNED" && i.result !== "INCOMPLETE";

async function issuesIn(w: string, now: Date): Promise<IActivityIssue[]> {
  await sweepNotReturned(now);
  const from = windowStart(w, now);
  return (await ActivityIssue.find({
    status: { $ne: "CANCELLED" },
    $or: [{ requestedAt: { $gte: from } }, { returnedAt: { $gte: from } }],
  }).lean()) as unknown as IActivityIssue[];
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

// ---------------------------------------------------------------------------
// By skill
// ---------------------------------------------------------------------------

export interface SkillRow {
  skill: ActivitySkillArea;
  labelBn: string;
  finished: number;
  allCorrectPct: number;
  children: number;
}
export interface SkillCell {
  classLabelBn: string;
  skill: ActivitySkillArea;
  finished: number;
}
export interface SkillReport {
  rows: SkillRow[];
  grid: SkillCell[];
}

export async function activitySkillReport(w: string, now = new Date()): Promise<SkillReport> {
  const from = windowStart(w, now);
  const issues = (await issuesIn(w, now)).filter((i) => finished(i) && i.returnedAt && new Date(i.returnedAt) >= from);
  const banks = (await ActivityBank.find({ _id: { $in: [...new Set(issues.map((i) => i.bankId.toString()))] } }).select("skillArea").lean()) as unknown as IActivityBank[];
  const skillOf = new Map(banks.map((b) => [b._id.toString(), b.skillArea]));
  const rows = ACTIVITY_SKILL_AREAS.map((skill) => {
    const mine = issues.filter((i) => skillOf.get(i.bankId.toString()) === skill);
    return {
      skill,
      labelBn: ACTIVITY_SKILL_LABELS_BN[skill],
      finished: mine.length,
      allCorrectPct: pct(mine.filter((i) => i.result === "ALL_CORRECT").length, mine.length),
      children: new Set(mine.map((i) => i.studentId.toString())).size,
    };
  });
  const students = await Student.find({ _id: { $in: [...new Set(issues.map((i) => i.studentId.toString()))] } }).select("classId").lean();
  const classes = await Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const kidLevel = new Map(students.map((s) => [s._id.toString(), levelOf.get(s.classId?.toString())]));
  const counts = new Map<string, number>();
  for (const i of issues) {
    const lv = kidLevel.get(i.studentId.toString());
    const sk = skillOf.get(i.bankId.toString());
    if (lv === undefined || !sk) continue;
    counts.set(`${lv}|${sk}`, (counts.get(`${lv}|${sk}`) ?? 0) + 1);
  }
  const levels = [...new Set([...kidLevel.values()].filter((l): l is number => l !== undefined))].sort((a, b) => a - b);
  const grid = levels.flatMap((lv) =>
    ACTIVITY_SKILL_AREAS.map((skill) => ({ classLabelBn: ROSTER_CLASS_LABELS_BN[lv as RosterClassLevel] ?? String(lv), skill, finished: counts.get(`${lv}|${skill}`) ?? 0 })),
  );
  return { rows, grid };
}

// ---------------------------------------------------------------------------
// By bank
// ---------------------------------------------------------------------------

export interface BankLevelRow {
  level: string;
  given: number;
  back: number;
  allCorrectPct: number;
  tooHard: boolean;
}
export interface BankRow {
  bankId: string;
  code: string;
  nameBn: string;
  skill: string;
  given: number;
  back: number;
  allCorrectPct: number;
  notReturned: number;
  repeats: number;
  viaTray: number;
  viaGuardian: number;
  neverTaken: boolean;
  levels: BankLevelRow[];
}

export async function activityBankReport(w: string, now = new Date()): Promise<BankRow[]> {
  const from = windowStart(w, now);
  const issues = await issuesIn(w, now);
  const banks = (await ActivityBank.find({ status: "PUBLISHED" }).sort({ sortOrder: 1, code: 1 }).lean()) as unknown as IActivityBank[];
  const sheets = await ActivitySheet.find({ _id: { $in: [...new Set(issues.map((i) => i.sheetId.toString()))] } }).select("level").lean();
  const levelOf = new Map(sheets.map((s) => [s._id.toString(), s.level as string]));
  const rows = banks.map((b) => {
    const mine = issues.filter((i) => i.bankId.toString() === b._id.toString());
    const given = mine.filter((i) => new Date(i.requestedAt) >= from);
    const back = mine.filter((i) => i.status === "RETURNED" && i.returnedAt && new Date(i.returnedAt) >= from);
    const levels = ACTIVITY_LEVELS.map((level) => {
      const g = given.filter((i) => levelOf.get(i.sheetId.toString()) === level);
      const r = back.filter((i) => levelOf.get(i.sheetId.toString()) === level);
      const ok = r.filter((i) => i.result === "ALL_CORRECT").length;
      return { level, given: g.length, back: r.length, allCorrectPct: pct(ok, r.length), tooHard: r.length >= HARD_MIN_RETURNS && ok / r.length < HARD_RATE };
    });
    return {
      bankId: b._id.toString(),
      code: b.code,
      nameBn: b.nameBn,
      skill: b.skillArea,
      given: given.length,
      back: back.length,
      allCorrectPct: pct(back.filter((i) => i.result === "ALL_CORRECT").length, back.length),
      notReturned: mine.filter((i) => i.status === "NOT_RETURNED").length,
      repeats: given.filter((i) => i.repeat).length,
      viaTray: given.filter((i) => i.path === "TRAY").length,
      viaGuardian: given.filter((i) => i.path === "GUARDIAN").length,
      neverTaken: given.length === 0,
      levels,
    };
  });
  return rows.sort((a, b) => b.given - a.given || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export interface ChildRow {
  studentId: string;
  name: string;
  classLabelBn: string;
  sectionNameBn: string;
  finished: number;
  allCorrect: number;
  open: number;
  notReturned: number;
  favouriteSkillBn: string | null;
  last: Date | null;
}
export interface SectionTotal {
  classLabelBn: string;
  sectionNameBn: string;
  children: number;
  finished: number;
}
export interface ChildrenReport {
  children: ChildRow[];
  sections: SectionTotal[];
}

export async function activityChildrenReport(w: string, now = new Date()): Promise<ChildrenReport> {
  const from = windowStart(w, now);
  const issues = await issuesIn(w, now);
  const ids = [...new Set(issues.map((i) => i.studentId.toString()))].map((x) => new Types.ObjectId(x));
  const [students, banks] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select("name nameBn classId sectionId").lean(),
    ActivityBank.find({ _id: { $in: [...new Set(issues.map((i) => i.bankId.toString()))] } }).select("skillArea").lean(),
  ]);
  const [classes, sections] = await Promise.all([
    Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: students.map((s) => s.sectionId) } }).select("nameBn").lean(),
  ]);
  const lv = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const sec = new Map(sections.map((s) => [s._id.toString(), s.nameBn as string]));
  const skillOf = new Map(banks.map((b) => [b._id.toString(), b.skillArea as ActivitySkillArea]));
  const children = students.map((s) => {
    const mine = issues.filter((i) => i.studentId.toString() === s._id.toString());
    const done = mine.filter((i) => finished(i) && i.returnedAt && new Date(i.returnedAt) >= from);
    const bySkill = new Map<string, number>();
    for (const i of done) {
      const k = skillOf.get(i.bankId.toString());
      if (k) bySkill.set(k, (bySkill.get(k) ?? 0) + 1);
    }
    const fav = [...bySkill.entries()].sort((a, b) => b[1] - a[1])[0];
    const times = mine.map((i) => new Date(i.returnedAt ?? i.handedAt ?? i.requestedAt).getTime());
    const level = lv.get(s.classId?.toString());
    return {
      studentId: s._id.toString(),
      name: ((s.nameBn as string) || (s.name as string)) ?? "",
      classLabelBn: level === undefined ? "" : ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? String(level),
      classLevel: level ?? 99,
      sectionNameBn: sec.get(s.sectionId?.toString()) ?? "",
      finished: done.length,
      allCorrect: done.filter((i) => i.result === "ALL_CORRECT").length,
      open: mine.filter((i) => ["REQUESTED", "PRINTED", "HANDED"].includes(i.status)).length,
      notReturned: mine.filter((i) => i.status === "NOT_RETURNED").length,
      favouriteSkillBn: fav ? ACTIVITY_SKILL_LABELS_BN[fav[0] as ActivitySkillArea] : null,
      last: times.length ? new Date(Math.max(...times)) : null,
    };
  });
  children.sort((a, b) => b.finished - a.finished || a.classLevel - b.classLevel || a.name.localeCompare(b.name));
  const totals = new Map<string, SectionTotal & { lv: number }>();
  for (const c of children) {
    const k = `${c.classLabelBn}|${c.sectionNameBn}`;
    const t = totals.get(k) ?? { classLabelBn: c.classLabelBn, sectionNameBn: c.sectionNameBn, children: 0, finished: 0, lv: c.classLevel };
    t.children += 1;
    t.finished += c.finished;
    totals.set(k, t);
  }
  return {
    children: children.map(({ classLevel: _l, ...rest }) => rest),
    sections: [...totals.values()].sort((a, b) => a.lv - b.lv || a.sectionNameBn.localeCompare(b.sectionNameBn)).map(({ lv: _x, ...t }) => t),
  };
}
