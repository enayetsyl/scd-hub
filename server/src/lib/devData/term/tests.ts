/**
 * Class work (CW) sheets and class tests of the realistic term. A class test is given about every three weeks per subject per
 * section; most have a question sheet (a CT paper linked to the registered test: its confirm writes the results), some have none
 * (the teacher enters marks straight on the test: the "CT without a sheet" warning). Scores follow the child's ability x the class
 * level (C3 weakest); a child absent on the register is ABSENT on the test.
 */
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { Student } from "../../../modules/foundation/models/Student";
import { StoredFile } from "../../../modules/platform/models/StoredFile";
import { classTokenForLevel, confirmPaper, createPaper, type Auth, type PaperItemInput } from "../../../modules/mastery/services/MasteryWorkService";
import { ctBlockedQids } from "../../../modules/assessment/services/QuestionUseService";
import { createRequest } from "../../../modules/trackers/services/ClassTestService";
import { enterResult } from "../../../modules/trackers/services/ClassTestResultService";
import { appNow } from "../../devClock";
import { itemMarks } from "./personas";
import { absentBySection, personaOf, saveRowsTolerant, successChance } from "./daily";
import type { Sim, StockEntry } from "./state";
import type { SectionInfo } from "../scenarios/types";

let ctSeq = 0;

/** Up to `n` BANK items of the stock (questions of locked objectives with a known question type); a CT sheet leaves out the blocked qids (R19). */
export function itemsOf(sim: Sim, st: StockEntry, n: number, blocked?: Set<string>): PaperItemInput[] {
  const out: PaperItemInput[] = [];
  for (const q of sim.ctx.pick(st.bank.filter((b) => !blocked?.has(b.qid)), n * 3)) {
    const lo = st.outcomes.find((o) => q.loCodes.includes(o.code));
    const type = q.qtCode ?? lo?.questionTypeCodes?.[0];
    if (!lo || !type || !st.marks.has(type)) continue;
    out.push({ origin: "BANK", artifactId: q.artifactId, loCode: lo.code, questionTypeCode: type });
    if (out.length >= n) break;
  }
  return out;
}

/** Children of a section who are present today (everyone not on the register as absent). */
export async function presentKids(sim: Sim, sectionId: string): Promise<{ all: string[]; present: string[] }> {
  const all = (await Student.find({ sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
  const absent = absentBySection.get(sectionId) ?? new Set<string>();
  void sim;
  return { all, present: all.filter((id) => !absent.has(id)) };
}

/** Enter wrong ticks for the present children of a paper (by their success chance) and confirm it. Returns the earned / available marks of present children. */
export async function tickAndConfirm(
  sim: Sim,
  paperId: string,
  level: number,
  dayKey: string,
  present: string[],
  auth: Auth,
  how: (studentId: string) => number,
  tag: string,
): Promise<{ earned: number; available: number } | null> {
  const paper = await MasteryPaper.findOne({ paperId });
  if (!paper || paper.items.length === 0) return null;
  const rows: Array<{ studentId: string; items: Array<{ itemNo: number; marks: number }> }> = [];
  let earned = 0;
  let available = 0;
  for (const studentId of present) {
    const p = how(studentId);
    let childEarned = 0;
    const wrong: Array<{ itemNo: number; marks: number }> = [];
    for (const it of paper.items) {
      const m = itemMarks(sim.ctx.rng, p, it.marks);
      childEarned += m;
      if (m < it.marks) wrong.push({ itemNo: it.itemNo, marks: m });
    }
    earned += childEarned;
    available += paper.items.reduce((t, it) => t + it.marks, 0);
    if (wrong.length > 0) rows.push({ studentId, items: wrong });
  }
  await saveRowsTolerant(sim, paperId, rows, auth, `${tag}Ticks`);
  const ok = await sim.safe(`${tag}Confirm`, () => confirmPaper(paperId, auth));
  if (ok) sim.bump(`${tag}Confirmed`);
  void level;
  void dayKey;
  return { earned, available };
}

/** The class-work sheet of the week: a few questions, wrong ticks by ability, confirmed (in-school evidence). */
export async function cwDay(sim: Sim, dayKey: string): Promise<void> {
  for (const sec of sim.sections.filter((s) => s.level >= 1)) {
    if (sim.ctx.rng() >= 0.22) continue; // about one section in five each day: each section ~1 a week
    const slots = await sim.slotsOn(dayKey, sec.sectionId);
    const token = classTokenForLevel(sec.level);
    if (!token) continue;
    const enabled = new Set((await MasteryEnablement.find({ academicYearId: sim.ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean()).map((e) => e.subject as string));
    const subject = sim.ctx.pick([...new Set(slots.map((s) => s.subject))].filter((s) => enabled.has(s)), 1)[0];
    if (!subject) continue;
    const teacherId = sim.teacherOfSubject(slots, subject);
    const st = await sim.stock(sec.level, subject);
    if (!teacherId || !st) {
      sim.bump("cwNoStock");
      continue;
    }
    const items = itemsOf(sim, st, 3);
    if (items.length === 0) {
      sim.bump("cwNoStock");
      continue;
    }
    const auth = sim.authOf(teacherId);
    const paper = await sim.safe("cw", () => createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CW", date: dayKey, items }, auth));
    if (!paper) continue;
    sim.bump("cwPapers");
    const { present } = await presentKids(sim, sec.sectionId);
    await sim.safe("cwTicks", () => tickAndConfirm(sim, paper.paperId, sec.level, dayKey, present, auth, (id) => successChance(sim, id, sec.level, dayKey, sim.ctx.rng), "cw"));
  }
}

/** Today's class tests (the plan built at the start): with a sheet (~75 %) or without one. */
export async function classTestDay(sim: Sim, dayKey: string): Promise<void> {
  for (const sec of sim.sections.filter((s) => s.level >= 1)) {
    const subject = sim.ctPlan.get(`${sec.sectionId}|${dayKey}`);
    if (!subject) continue;
    await sim.safe("ct", () => oneClassTest(sim, sec, subject, dayKey, sim.ctx.rng() >= 0.25));
  }
}

export async function registerTest(sim: Sim, sec: SectionInfo, subject: string, dayKey: string, total: number, teacherId: string, skipPrint = true): Promise<string> {
  ctSeq += 1;
  const file = await StoredFile.create({
    kind: "classtest_question", mime: "application/pdf", sizeBytes: 1, originalName: `fake-ct-${ctSeq}.pdf`,
    driveFileId: `dev-fake-${sim.ctx.runId}-ct-${ctSeq}`, uploadedBy: new Types.ObjectId(teacherId),
  });
  const test = await createRequest({
    sectionId: sec.sectionId, subject, examDate: dayKey, totalMarks: total, source: "UPLOADED_PAPER", questionFileId: String(file._id),
    skipPrint, teacherId, actorId: teacherId, notes: "ফেক ক্লাস টেস্ট",
  });
  return test.id;
}

/** One class test. `withSheet`: a CT question sheet linked to the registered test; else the marks are entered straight on the test. */
export async function oneClassTest(sim: Sim, sec: SectionInfo, subject: string, dayKey: string, withSheet: boolean): Promise<{ testId: string; paperId?: string } | null> {
  const slots = await sim.slotsOn(dayKey, sec.sectionId);
  const teacherId = sim.teacherOfSubject(slots, subject);
  if (!teacherId) {
    sim.bump("ctNoPeriod");
    return null;
  }
  const auth = sim.authOf(teacherId);
  const { all, present } = await presentKids(sim, sec.sectionId);
  const tally = sim.tallyOf(sec.level);
  tally.ctChildDays += all.length;
  tally.ctPresent += present.length;
  if (withSheet) {
    const st = await sim.stock(sec.level, subject);
    if (!st) {
      sim.bump("ctNoStock");
      return null;
    }
    const token = classTokenForLevel(sec.level) as string;
    const blocked = new Set((await ctBlockedQids({ sectionId: sec.sectionId, qids: st.bank.map((q) => q.qid), classToken: token, subject })).blocked);
    const items = itemsOf(sim, st, 4, blocked);
    const total = items.reduce((t, it) => t + (st.marks.get(it.questionTypeCode) ?? 0), 0);
    if (items.length === 0 || !Number.isInteger(total) || total < 1) {
      sim.bump("ctNoStock");
      return null;
    }
    const testId = await registerTest(sim, sec, subject, dayKey, total, teacherId);
    const paper = await createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CT", date: dayKey, items, classTestId: testId }, auth);
    sim.bump("ctWithSheet");
    const r = await tickAndConfirm(sim, paper.paperId, sec.level, dayKey, present, auth, (id) => successChance(sim, id, sec.level, dayKey, sim.ctx.rng), "ct");
    if (r) {
      tally.ctEarned += r.earned;
      tally.ctAvailable += r.available;
    }
    return { testId, paperId: paper.paperId };
  }
  // no sheet: the teacher enters each child's marks on the test itself
  const total = 20;
  const testId = await registerTest(sim, sec, subject, dayKey, total, teacherId);
  sim.bump("ctWithoutSheet");
  const absent = new Set(all.filter((id) => !present.includes(id)));
  for (const studentId of all) {
    if (absent.has(studentId)) {
      await sim.safe("ctEnter", () => enterResult({ testId, studentId, status: "ABSENT", actorId: teacherId, now: appNow() }));
      continue;
    }
    const score = successChance(sim, studentId, sec.level, dayKey, sim.ctx.rng);
    const marks = Math.max(0, Math.min(total, Math.round(total * score)));
    const done = await sim.safe("ctEnter", () => enterResult({ testId, studentId, status: "PRESENT", marks, actorId: teacherId, now: appNow() }));
    if (done) {
      tally.ctEarned += marks;
      tally.ctAvailable += total;
    }
  }
  void personaOf;
  return { testId };
}

/**
 * The class-test plan: every section gives each of its mastery-enabled subjects a test about every three weeks, on a weekday it
 * has that subject, never on an exam / preparation day. A section takes one test a day at most.
 */
export async function planClassTests(sim: Sim, weekOf: (dayKey: string) => number): Promise<void> {
  const byWeek = new Map<number, string[]>();
  for (const d of sim.teachDays) byWeek.set(weekOf(d), [...(byWeek.get(weekOf(d)) ?? []), d]);
  let sIdx = 0;
  for (const sec of sim.sections.filter((s) => s.level >= 1)) {
    sIdx++;
    const token = classTokenForLevel(sec.level);
    if (!token) continue;
    const enabled = (await MasteryEnablement.find({ academicYearId: sim.ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean()).map((e) => e.subject as string).sort();
    let j = 0;
    for (const subject of enabled) {
      j++;
      const days = sim.subjectDays.get(`${sec.sectionId}|${subject}`);
      if (!days || days.size === 0) continue;
      const offset = (j + sIdx) % 3;
      for (const [w, keys] of byWeek) {
        if (w < 1 || w % 3 !== offset) continue;
        const cands = keys.filter((k) => days.has(weekdayOf(k)) && !sim.ctPlan.has(`${sec.sectionId}|${k}`));
        const pick = cands[j % Math.max(1, cands.length)];
        if (pick) sim.ctPlan.set(`${sec.sectionId}|${pick}`, subject);
      }
    }
  }
}

/** 0 = Sun .. 4 = Thu of a YYYY-MM-DD key. */
export const weekdayOf = (k: string): number => {
  const [y, m, d] = k.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
};
