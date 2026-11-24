/**
 * The daily steps of the realistic term that every school day runs: attendance by persona, class notes + lesson deliveries by
 * teacher persona, homework (give, issue, hand in by child persona, mark by teacher persona), the guardian weekly message and the
 * 09:30 marks ladder. All of it goes THROUGH the existing services with the generator clock set to the fake day.
 */
import { classToken, HW_SUBJECTS, subjectAllowedForClassLevel } from "@scd/shared";
import { Student } from "../../../modules/foundation/models/Student";
import { ClassNote } from "../../../modules/routine/models/ClassNote";
import { StudentAttendanceDay } from "../../../modules/attendance/models/StudentAttendanceDay";
import { HomeworkItem } from "../../../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../../modules/trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { publishClassNote } from "../../../modules/routine/services/RoutineTriggerService";
import { nextSessionKey, recordDelivery, sectionSessionStates, sessionPlansFor, type PlanSession } from "../../../modules/lesson-progress/services/LessonDeliveryService";
import { markAttendanceUnit, markerForUnit } from "../../../modules/attendance/services/StudentAttendanceService";
import { resolveUnits, studentLitesOn, unitKey, type AttendanceUnit } from "../../../modules/attendance/attendanceUnit";
import { parseDateKey } from "../../../modules/attendance/dates";
import { declareHomeworkItem, issueHomeworkItem, transitionRecord } from "../../../modules/trackers/services/HomeworkService";
import { saveFreeLineTicks } from "../../../modules/trackers/services/HomeworkFreeLineService";
import { confirmPaper, saveResults, type Auth, type ResultInput } from "../../../modules/mastery/services/MasteryWorkService";
import { runGuardianWeeklySummary } from "../../../modules/mastery/services/GuardianWeeklySummaryService";
import { runMarkEscalation } from "../../../modules/trackers/services/MarkReminderService";
import { setDevClock } from "../../devClock";
import type { AppContext } from "../../../context";
import { absenceChance, abilityOn, between, CHILD_PERSONAS, hwWeight, itemMarks, LEVEL_ABILITY_FACTOR, TEACHER_PERSONAS, type ChildPersona } from "./personas";
import { isExamDay, isPrepDay } from "./calendar";
import type { Sim } from "./state";
import { pickAllowedHomeworkQids } from "../scenarios/helpers";

const CONTINUING_RATE = 0.15;

/**
 * Save result rows; when the bulk save is refused (one child no longer on the list: moved, left, joined later) save them one at a
 * time so the others still land. Returns how many rows were saved.
 */
export async function saveRowsTolerant(sim: Sim, paperId: string, rows: ResultInput[], auth: Auth, tag: string): Promise<number> {
  if (rows.length === 0) return 0;
  if (await sim.safe(tag, () => saveResults(paperId, rows, auth))) return rows.length;
  let n = 0;
  for (const r of rows) if (await sim.safe(`${tag}One`, () => saveResults(paperId, [r], auth))) n++;
  return n;
}

/** A child's persona (a child admitted during the run is TYPICAL). */
export function personaOf(sim: Sim, studentId: string): ChildPersona {
  return sim.childPersona.get(studentId) ?? "TYPICAL";
}

/** The success chance of a child on this day (ability x level factor, a little noise). */
export function successChance(sim: Sim, studentId: string, level: number, dayKey: string, rng: () => number): number {
  const spec = CHILD_PERSONAS[personaOf(sim, studentId)];
  const base = abilityOn(spec, sim.termFraction(dayKey)) * (LEVEL_ABILITY_FACTOR[level] ?? 1);
  return Math.max(0.04, Math.min(0.97, base + (rng() - 0.5) * 0.16));
}

/** Today's absentees of one section (children on a C4 streak are always out); a pure draw, no writes. */
export function absentToday(sim: Sim, studentIds: string[], dayKey: string, weekday: number, ctDay: (studentId: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const id of studentIds) {
    const streak = sim.streaks.get(id);
    if (streak && dayKey >= streak[0] && dayKey <= streak[1]) {
      out.add(id);
      continue;
    }
    if (sim.ctx.rng() < absenceChance(CHILD_PERSONAS[personaOf(sim, id)], weekday, ctDay(id))) out.add(id);
  }
  return out;
}

const planCache = new Map<string, PlanSession[]>();
async function planFor(level: number, subject: string): Promise<PlanSession[]> {
  const k = `${level}:${subject}`;
  if (!planCache.has(k)) planCache.set(k, await sessionPlansFor(level, subject));
  return planCache.get(k) as PlanSession[];
}

/** The decided absentees of the day, by section (set by `attendanceDay`, read by homework / tests the same day). */
export const absentBySection = new Map<string, Set<string>>();

/** Attendance of every unit for the day, by persona and weekday, through `markAttendanceUnit`. */
export async function attendanceDay(sim: Sim, dayKey: string): Promise<void> {
  absentBySection.clear();
  const startedAt = new Date(); // REAL time: the day's rows are told apart from anyone else's by their real creation time
  const day = parseDateKey(dayKey);
  const weekday = day.getDay(); // Sun = 0 .. Thu = 4
  const units = new Map<string, { unit: AttendanceUnit; students: Set<string> }>();
  for (const sec of sim.sections) {
    const lites = await studentLitesOn(dayKey, { sectionIds: [sec.sectionId] });
    const byStudent = await resolveUnits(lites, dayKey);
    for (const [studentId, unit] of byStudent) {
      const k = unitKey(unit);
      const e = units.get(k) ?? { unit, students: new Set<string>() };
      e.students.add(studentId);
      units.set(k, e);
    }
  }
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
  const ctSections = new Set([...sim.ctPlan.keys()].filter((k) => k.endsWith(`|${dayKey}`)).map((k) => k.split("|")[0] as string));
  const sectionOfStudent = new Map<string, string>();
  for (const st of await Student.find({ active: true, sectionId: { $in: sim.sections.map((s) => s.sectionId) } }).select("_id sectionId").lean()) {
    sectionOfStudent.set(String(st._id), String(st.sectionId));
  }
  for (const k of [...units.keys()].sort()) {
    const { unit, students } = units.get(k)!;
    const marker = await markerForUnit(unit, dayKey);
    if (!marker.teacherId) {
      sim.bump("attendanceUnitsNoMarker");
      continue;
    }
    const ids = [...students].sort();
    const level = (id: string) => sim.level.get(sectionOfStudent.get(id) ?? "") ?? 1;
    // a child's OWN section decides: a class-test day for her section lifts her absence to the test-day rate, even when the
    // attendance unit is a Quran group of several sections
    const absent = absentToday(sim, ids, dayKey, weekday, (id) => ctSections.has(sectionOfStudent.get(id) ?? ""));
    const fakeCtx = { auth: { userId: marker.teacherId, role: "TEACHER" } } as unknown as AppContext;
    await markAttendanceUnit(fakeCtx, unit, dayKey, [...absent], at);
    sim.bump("attendanceUnitsMarked");
    for (const id of ids) {
      const s = sim.statOf(id);
      const t = sim.tallyOf(level(id));
      s.attDays++;
      t.attDays++;
      if (absent.has(id)) {
        s.absDays++;
        t.absDays++;
        sim.bump("absences");
        const sid = sectionOfStudent.get(id);
        if (sid) absentBySection.set(sid, (absentBySection.get(sid) ?? new Set()).add(id));
      }
    }
  }
  // rows are tagged once a week, so the day's rows are found by their (real) creation window, not by the tag
  await StudentAttendanceDay.collection.updateMany({ dateKey: dayKey, createdAt: { $gte: startedAt, $lte: new Date() } }, { $set: { markedAt: at } });
}

/** One class note + lesson delivery per taught period (the effective teacher's persona decides whether the note is made). */
export async function lessonsDay(sim: Sim, dayKey: string): Promise<void> {
  const day = parseDateKey(dayKey);
  for (const sec of sim.sections) {
    for (const slot of await sim.slotsOn(dayKey, sec.sectionId)) {
      if (!slot.teacherId) {
        sim.bump("notesNoTeacher"); // the teacher is on leave and no cover was free
        continue;
      }
      const spec = TEACHER_PERSONAS[sim.teacherPersona.get(slot.teacherId) ?? "T1"];
      if (sim.ctx.rng() >= spec.noteRate) {
        sim.bump("notesSkipped");
        continue;
      }
      const note = await sim.safe("note", () =>
        publishClassNote({ slotId: slot.slotId, date: day, taughtSummaryBn: `ফেক ক্লাস নোট — ${slot.subject}`, actorId: slot.teacherId, canManage: true }),
      );
      if (!note) continue;
      sim.bump("notes");
      // the note reads as made on the fake day: ~6 h after the period for a diligent teacher, later for the others (T2 4 pm, T3 6 pm)
      const hour = ({ T1: 13, T2: 16, T3: 18, T4: 14 } as const)[sim.teacherPersona.get(slot.teacherId) ?? "T1"];
      const backdate = (): Promise<unknown> => ClassNote.collection.updateOne({ _id: (note as unknown as { _id: unknown })._id as never }, { $set: { publishedAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0) } });
      await backdate();
      const plan = await planFor(sec.level, slot.subject);
      const key = plan.length > 0 ? nextSessionKey(plan, await sectionSessionStates(sec.sectionId, slot.subject)) : null;
      if (!key) {
        sim.bump("notesWithoutPlan");
        continue;
      }
      const finished = sim.ctx.rng() >= CONTINUING_RATE;
      const delivery = await sim.safe("delivery", () => recordDelivery(note, { sessions: [{ key, finished }] }, slot.teacherId));
      if (delivery) sim.bump("deliveries");
      await backdate(); // the delivery saves the note again
    }
  }
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

export interface HwPending {
  itemId: string;
  paperId: string | null;
  teacherId: string;
  sectionId: string;
  level: number;
  handedIn: string[];
  confirmOn: string;
  hasFreeLines: boolean;
}
export const hwQueue: HwPending[] = [];

/** Forget the state of an earlier run in this process (the module-level queues and caches). */
export function resetDailyState(): void {
  hwQueue.length = 0;
  absentBySection.clear();
  planCache.clear();
}

/** Give homework in the sections that give it today; hand-in by child persona; marking is queued by teacher persona. */
export async function homeworkDay(sim: Sim, dayKey: string): Promise<void> {
  const hwSubjects = new Set<string>(HW_SUBJECTS);
  const prep = isPrepDay(dayKey); // homework is optional in the preparation week
  for (const sec of sim.sections.filter((s) => s.level >= 1)) {
    const slots = await sim.slotsOn(dayKey, sec.sectionId);
    const bySubject = new Map<string, string>();
    for (const s of slots) if (s.teacherId && hwSubjects.has(s.subject) && !bySubject.has(s.subject)) bySubject.set(s.subject, s.teacherId);
    for (const [subject, teacherId] of bySubject) {
      if (!subjectAllowedForClassLevel(subject, sec.level)) continue;
      // ~0.6 of the weight a day: ENG about 1 homework in 3 school days, ISLAM seldom, BAN rarely in C2 / C3 (2026)
      if (sim.ctx.rng() >= hwWeight(subject, sec.level) * (prep ? 0.25 : 0.6)) continue;
      await giveHomework(sim, dayKey, sec, subject, teacherId);
    }
  }
}

async function giveHomework(sim: Sim, dayKey: string, sec: { sectionId: string; classId: string; level: number }, subject: string, teacherId: string): Promise<void> {
  const ctx = sim.ctx;
  const qids = await pickAllowedHomeworkQids(ctx, { sectionId: sec.sectionId, classId: sec.classId, level: sec.level, nameBn: "" }, subject, dayKey, between(ctx.rng, 1, 5));
  const withLines = ctx.rng() < 0.3 || qids.length === 0;
  const item = await sim.safe("declare", () =>
    declareHomeworkItem({
      academicYearId: ctx.academicYearId, classId: sec.classId, classLevel: sec.level, sectionId: sec.sectionId, subject, dateGiven: dayKey,
      topTags: [`TOP-${subject}-${classToken(sec.level)}-GEN`], qCount: Math.max(1, qids.length), selectedQids: qids,
      description: `ফেক বাড়ির কাজ — ${subject}`,
      freeLines: withLines ? [{ kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 10 }] : undefined,
      teacherItems: qids.length > 0 && ctx.rng() < 0.2 ? [{ textBn: "নিজে একটি বাক্য লেখো।", marks: 2 }] : undefined,
      actorId: teacherId,
    }),
  );
  if (!item) return;
  sim.bump("hwDeclared");
  const doc = await HomeworkItem.findById(item.itemId);
  if (!doc) return;
  const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
  if (kids.length === 0) return;
  const absent = absentBySection.get(sec.sectionId) ?? new Set<string>();
  await issueHomeworkItem(item.itemId, kids.map((studentId) => ({ studentId, present: !absent.has(studentId) })), teacherId);
  sim.bump("hwIssued");
  const recs = await HomeworkStudentRecord.find({ hwItemId: doc._id, state: "GIVEN" }).select("_id studentId").lean();
  const handedIn: string[] = [];
  const tally = sim.tallyOf(sec.level);
  for (const r of recs) {
    const studentId = String(r.studentId);
    await transitionRecord({ recordId: String(r._id), toState: "DUE", actorId: teacherId });
    const miss = ctx.rng() < CHILD_PERSONAS[personaOf(sim, studentId)].hwMiss;
    const stat = sim.statOf(studentId);
    stat.hwN++;
    tally.hwN++;
    if (miss) {
      await transitionRecord({ recordId: String(r._id), toState: "CHASE", actorId: teacherId });
      stat.hwMiss++;
      tally.hwMiss++;
      sim.bump("hwChase");
    } else {
      await transitionRecord({ recordId: String(r._id), toState: "SUBMITTED", actorId: teacherId });
      handedIn.push(studentId);
      sim.bump("hwSubmitted");
    }
  }
  const spec = TEACHER_PERSONAS[sim.teacherPersona.get(teacherId) ?? "T1"];
  if (ctx.rng() < spec.hwSkipRate) {
    sim.bump("hwNeverConfirmed"); // the teacher never marks it: the 09:30 list shows it late
    return;
  }
  hwQueue.push({
    itemId: item.itemId, paperId: doc.paperId ? String(doc.paperId) : null, teacherId, sectionId: sec.sectionId, level: sec.level, handedIn,
    confirmOn: sim.addSchoolDays(dayKey, between(ctx.rng, spec.hwDelay[0], spec.hwDelay[1])), hasFreeLines: (doc.freeLines?.length ?? 0) > 0,
  });
}

/** Mark the homework whose marking day is today (wrong ticks by ability, a free-line tick sometimes, then the confirm). */
export async function markHomeworkDue(sim: Sim, dayKey: string, force = false): Promise<void> {
  for (let i = hwQueue.length - 1; i >= 0; i--) {
    const q = hwQueue[i]!;
    if (!force && q.confirmOn > dayKey) continue;
    if (!force && sim.onLeave.get(q.teacherId)?.has(dayKey)) {
      q.confirmOn = sim.addSchoolDays(dayKey, 1); // out today: marked on the first day back
      continue;
    }
    hwQueue.splice(i, 1);
    const paper = q.paperId ? await MasteryPaper.findById(q.paperId) : null;
    const auth = sim.authOf(q.teacherId);
    if (paper) {
      const rows: Array<{ studentId: string; items: Array<{ itemNo: number; marks: number }> }> = [];
      for (const studentId of q.handedIn) {
        const p = personaOf(sim, studentId) === "C7" ? 0.97 : Math.min(0.97, successChance(sim, studentId, q.level, dayKey, sim.ctx.rng) + 0.1);
        const wrong = paper.items.map((it) => ({ itemNo: it.itemNo, marks: itemMarks(sim.ctx.rng, p, it.marks), full: it.marks })).filter((m) => m.marks < m.full);
        if (wrong.length > 0) rows.push({ studentId, items: wrong.map(({ itemNo, marks }) => ({ itemNo, marks })) });
      }
      if (rows.length > 0) {
        sim.bump("hwWrongRows", await saveRowsTolerant(sim, paper.paperId, rows, auth, "hwTicks"));
      }
    }
    if (q.hasFreeLines && q.handedIn.length > 0 && sim.ctx.rng() < 0.4) {
      await sim.safe("hwFreeLine", () => saveFreeLineTicks(q.itemId, [{ studentId: sim.ctx.pick(q.handedIn, 1)[0]!, notDone: [0] }]));
    }
    if (paper) {
      const ok = await sim.safe("hwConfirm", () => confirmPaper(paper.paperId, auth));
      if (ok) sim.bump("hwConfirmed");
    }
  }
}

// ---------------------------------------------------------------------------
// Guardian weekly message + the 09:30 marks ladder
// ---------------------------------------------------------------------------

/** Wednesday 18:00: the guardian weekly message run (the emitters are muted: only the run bookkeeping advances). */
export async function guardianSummaryRun(sim: Sim, dayKey: string): Promise<void> {
  setDevClock(new Date(`${dayKey}T18:00:00+06:00`));
  try {
    const r = await sim.safe("guardianSummary", () => runGuardianWeeklySummary(new Date(`${dayKey}T18:00:00+06:00`)));
    if (r) {
      sim.bump("guardianSummaryRuns");
      sim.bump("guardianSummaryChildren", r.students);
    }
  } finally {
    sim.ctx.clock(dayKey);
  }
}

/** The 09:30 ladder of the day: the MarkEscalation snapshot of late marks (Principal card, 09:30 list). */
export async function marksLadder(sim: Sim, dayKey: string): Promise<void> {
  // The snapshot of a day is written once and the live dev scheduler skips a day that has one: never write one for the run's last day
  // (nor after it), so the dev site's own ladder is not blocked on the first day it reaches.
  if (dayKey >= (sim.openDays[sim.openDays.length - 1] as string)) return;
  const n = await sim.safe("markLadder", () => runMarkEscalation(new Date(`${dayKey}T09:30:00+06:00`)));
  if (typeof n === "number") sim.bump("markLadderRows", n);
}

export { isExamDay };
