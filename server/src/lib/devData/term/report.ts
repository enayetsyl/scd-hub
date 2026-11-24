/**
 * The report of the realistic term: the achieved rates next to the section 1 targets, the persona table (counts + example roster
 * names), and the scenario table (every catalogue scenario with what it produced and the children / teachers a tester can open).
 * Only counts, rates and dev roster names go in the report; the manifest keeps ids, never names.
 */
import { Types } from "mongoose";
import { Student } from "../../../modules/foundation/models/Student";
import { User } from "../../../modules/foundation/models/User";
import { GuardianLink } from "../../../modules/foundation/models/GuardianLink";
import { CHILD_PERSONAS, pct, TEACHER_PERSONAS, type ChildPersona, type TeacherPersona } from "./personas";
import type { EventRecord, Sim } from "./state";

export interface RateRow {
  area: string;
  target: string;
  achieved: string;
}

export interface TermReport {
  rates: RateRow[];
  personas: Array<{ persona: string; label: string; count: number; examples: string[] }>;
  teachers: Array<{ persona: string; label: string; count: number; examples: string[]; leaveDays: number }>;
  scenarios: EventRecord[];
}

const p1 = (x: number): string => `${(x * 100).toFixed(1)} %`;
const share = (n: number, d: number): number => (d > 0 ? n / d : 0);

export async function buildReport(sim: Sim, extra: { behindSections?: number; targetsSet?: number; healthRows?: number }): Promise<TermReport> {
  // --- rates ---------------------------------------------------------------
  let att = 0;
  let abs = 0;
  let ctPresent = 0;
  let ctDays = 0;
  let ctE = 0;
  let ctA = 0;
  const levelRows: string[] = [];
  for (const [level, t] of [...sim.tally.entries()].sort((a, b) => a[0] - b[0])) {
    att += t.attDays;
    abs += t.absDays;
    ctPresent += t.ctPresent;
    ctDays += t.ctChildDays;
    ctE += t.ctEarned;
    ctA += t.ctAvailable;
    if (t.ctAvailable > 0) levelRows.push(`level ${level}: ${p1(t.ctEarned / t.ctAvailable)}`);
  }
  const kids = [...sim.childStat.values()];
  const absShare = kids.filter((k) => k.attDays > 0).map((k) => k.absDays / k.attDays);
  const hwShare = kids.filter((k) => k.hwN >= 3).map((k) => k.hwMiss / k.hwN);
  const asShare = kids.filter((k) => k.asN >= 2).map((k) => k.asMiss / k.asN);
  const teachers = [...sim.teacherPersona.keys()];
  const leaveDays = teachers.map((t) => sim.leaveDays.get(t) ?? 0);
  const rates: RateRow[] = [
    { area: "Daily absence, mean", target: "10.8 %", achieved: p1(share(abs, att)) },
    { area: "Absent share per child, p50 / p90", target: "11.5 % / 34 % (21 / 63 of 183 days)", achieved: `${p1(pct(absShare, 50))} / ${p1(pct(absShare, 90))}` },
    { area: "Homework non-submission per child, p50 / p90", target: "19 % / 47 %", achieved: `${p1(pct(hwShare, 50))} / ${p1(pct(hwShare, 90))}` },
    { area: "Assignment miss per child, p50", target: "8 %", achieved: p1(pct(asShare, 50)) },
    { area: "Class test mean score (all levels)", target: "68 %", achieved: p1(share(ctE, ctA)) },
    { area: "Class test mean by level", target: "C3 53 %, others ~68 %+", achieved: levelRows.join("; ") || "no test sheets" },
    { area: "Absent on a class-test day", target: "14 %", achieved: p1(1 - share(ctPresent, ctDays)) },
    { area: "Leave days per teacher, p50 / p90 (half a year)", target: "~3 / ~10 (6 / 21 a year)", achieved: `${pct(leaveDays, 50)} / ${pct(leaveDays, 90)}` },
  ];

  // --- personas ------------------------------------------------------------
  const byPersona = new Map<ChildPersona, string[]>();
  for (const [id, p] of sim.childPersona) byPersona.set(p, [...(byPersona.get(p) ?? []), id]);
  const personas: TermReport["personas"] = [];
  for (const code of Object.keys(CHILD_PERSONAS) as ChildPersona[]) {
    const ids = (byPersona.get(code) ?? []).sort();
    const rows = await Student.find({ _id: { $in: ids.slice(0, 2).map((i) => new Types.ObjectId(i)) } }).select("name").lean();
    personas.push({ persona: code, label: CHILD_PERSONAS[code].label, count: ids.length, examples: rows.map((r) => r.name as string) });
  }
  const byTeacher = new Map<TeacherPersona, string[]>();
  for (const [id, p] of sim.teacherPersona) byTeacher.set(p, [...(byTeacher.get(p) ?? []), id]);
  const tp: TermReport["teachers"] = [];
  for (const code of Object.keys(TEACHER_PERSONAS) as TeacherPersona[]) {
    const ids = (byTeacher.get(code) ?? []).sort();
    const rows = await User.find({ _id: { $in: ids.slice(0, 2).map((i) => new Types.ObjectId(i)) } }).select("name").lean();
    tp.push({ persona: code, label: TEACHER_PERSONAS[code].label, count: ids.length, examples: rows.map((r) => (r as { name?: string }).name ?? "?"), leaveDays: ids.reduce((t, i) => t + (sim.leaveDays.get(i) ?? 0), 0) });
  }

  // --- scenario table ------------------------------------------------------
  const rows: EventRecord[] = [...sim.events];
  const names = (code: ChildPersona): string[] => personas.find((p) => p.persona === code)?.examples ?? [];
  const personaRow = (id: string, title: string, code: ChildPersona, produced: string, lookAt: string): EventRecord => ({
    id, title, day: "all term", status: (byPersona.get(code)?.length ?? 0) > 0 ? "placed" : "not placed", produced: `${byPersona.get(code)?.length ?? 0} child(ren): ${produced}`, names: names(code), lookAt,
  });
  rows.push(
    personaRow("C1", "Steady child", "C1", "~5 % absent, hands in ~95 %, scores high", "Mastery MASTERED; guardian message \"very good\""),
    personaRow("C2", "Struggling child", "C2", "scores 30-50 %, ~25 % non-submission (more in Class 3)", "WEAK objectives, Part B weak items, re-teach list"),
    personaRow("C3", "Improver", "C3", "ability climbs from 45 % to 90 % across the term", "Weak -> improving on loop health"),
    personaRow("C4", "Long illness", "C4", "one 13-school-day absence streak in February", "ABSENT_REDELIVER, missed-class objectives, guardian home guide"),
    personaRow("C5", "Chronic absentee", "C5", "~32 % absent all term", "Attendance reports, NOT_ASSESSED, class-teacher follow-up"),
    personaRow("C6", "Homework skipper", "C6", "~45 % of homework not handed in", "Chase ladder, Principal late lists"),
  );
  rows.push({ id: "C10", title: "Absent on class-test day", day: "every test", status: ctDays > 0 ? "placed" : "not placed", produced: `${p1(1 - share(ctPresent, ctDays))} of children absent on a test day; ${sim.c.ctWithoutSheet ?? 0} tests have no sheet`, names: [], lookAt: "CT ABSENT rows, retest, CT-without-sheet warning" });
  for (const code of Object.keys(TEACHER_PERSONAS) as TeacherPersona[]) {
    const t = tp.find((x) => x.persona === code)!;
    rows.push({ id: code === "T1" ? "T1" : code === "T2" ? "T2" : code === "T3" ? "T3" : "T4", title: `Teacher persona ${code} (${t.label})`, day: "all term", status: t.count > 0 ? "placed" : "not placed", produced: `${t.count} teacher(s)${code === "T4" ? `, ${t.leaveDays} leave days, ${sim.c.coversAssigned ?? 0} covers assigned` : ""}`, names: t.examples, lookAt: code === "T1" ? "Loop health green" : code === "T2" ? "09:30 marks list, Principal card" : code === "T3" ? "Loop health periods marked" : "Substitute covers, finalise-on-leave" });
  }
  const t7 = rows.find((r) => r.id === "T7");
  if (t7 && t7.status === "placed" && (sim.c.asFinaliseRefused ?? 0) === 0) {
    // the drafts were built, but no finalise was refused: the sheets' counted minutes (their real questions) stayed under the week cap
    t7.status = "partly";
    t7.produced += ". NOT observed in this run: no finalise was refused (the counted minutes of the sheets stayed under the cap); check on the real dev DB, or build a heavier week by hand";
  }
  const leave5 = sim.leaves.find((l) => l.guaranteed);
  rows.push({ id: "T4b", title: "5-day sick leave (March) + finalise-on-leave", day: leave5?.fromKey ?? "-", status: leave5?.applicationId ? "placed" : "not placed", produced: !leave5 ? "not in this run's window (it sits on 21-25 March; run to at least 25 March)" : leave5?.applicationId ? `leave ${leave5.fromKey}..${leave5.toKey} approved, covers assigned; ${sim.c.asFinalisedOnLeave ?? 0} assignment(s) finalised by the Office while the cell teacher was out` : "no leave applied (no staff profile for the teacher?)", names: leave5 ? await nameOfUsers([leave5.teacherId]) : [], lookAt: "Substitute covers; deadlines move to first day back" });
  rows.push({ id: "T5", title: "Behind-target শাখা x subject", day: "end of run", status: (extra.behindSections ?? 0) > 0 ? "placed" : "not placed", produced: `${extra.targetsSet ?? 0} targets set; ${extra.behindSections ?? 0} শাখা row(s) behind (scenario 6 at the end of the run)`, names: [], lookAt: "\"লক্ষ্য থেকে N সেশন পিছিয়ে\", LPBEHIND notice" });
  rows.push({ id: "T6", title: "Engine user vs hand-builder", day: "weekly", status: "partly", produced: `${sim.c.asSent ?? 0} engine drafts finalised; ${sim.c.asEdits ?? 0} teacher edits (swap / remove / add); the by-hand build is NOT generated (it would refuse: the engine already drafted the cell)`, names: [], lookAt: "Suggestion audit, swap card, NEEDS_REVIEW resolved" });
  rows.push({ id: "S1", title: "Holidays and roll", day: "calendar", status: "placed", produced: "21 Feb, Eid 9-18 Mar, 14 Apr (Wed), Eid 16-20 May as dev holiday exceptions", names: [], lookAt: "Delivery / due roll, no chase on closed days" });
  rows.push({ id: "S2", title: "Exam pause", day: "6-24 Jun", status: "placed", produced: "prep + exam pause windows, half-yearly exam dates and an exam routine per class; no lessons on exam days", names: [], lookAt: "No drafts, no marking reminders, exam days not teaching days" });
  rows.push({ id: "S3", title: "Merged sections day", day: "-", status: "not placed", produced: "NOT generated: a real merge moves real children and deactivates the source sections (not removable by the run tag). A tester merges two শাখা through the Principal screen.", names: [], lookAt: "Use history across sources" });
  rows.push({ id: "S6", title: "Guardian side", day: "every Wednesday", status: (sim.c.guardianSummaryRuns ?? 0) > 0 ? "placed" : "not placed", produced: `${sim.c.guardianSummaryRuns ?? 0} weekly runs, ${sim.c.guardianSummaryChildren ?? 0} child summaries built (emitters muted: no notification rows)`, names: [], lookAt: "Guardian app weekly message" });
  rows.push({ id: "S7", title: "Readiness", day: "end of run", status: (extra.healthRows ?? 0) > 0 ? "placed" : "partly", produced: `loop-health read of the run (scenario 8): ${extra.healthRows ?? 0} শাখা rows`, names: [], lookAt: "Loop health -> January readiness" });

  // C11 twins / C12 gender-split: read-only (what the dev roster already has)
  const kidIds = [...sim.childPersona.keys()].map((i) => new Types.ObjectId(i));
  const sib = await GuardianLink.aggregate([{ $match: { studentId: { $in: kidIds }, active: { $ne: false } } }, { $group: { _id: "$guardianId", kids: { $addToSet: "$studentId" } } }, { $match: { "kids.1": { $exists: true } } }, { $limit: 3 }]);
  const sibNames = sib.length ? await nameOfStudents(sib[0].kids.slice(0, 2).map(String)) : [];
  rows.push({ id: "C11", title: "Siblings / twins", day: "existing", status: sib.length ? "placed" : "not placed", produced: sib.length ? `${sib.length}+ guardian(s) with two children in the roster (not created by the run)` : "the dev roster has no guardian with two children", names: sibNames, lookAt: "Separate weekly message per child" });
  const split = sim.sections.filter((s) => /বালক|বালিকা/.test(s.nameBn));
  rows.push({ id: "C12", title: "Gender-split শাখা", day: "existing", status: split.length ? "placed" : "not placed", produced: `${split.length} gender-split শাখা in the run, each with its own papers and drafts`, names: split.slice(0, 2).map((s) => s.nameBn), lookAt: "Each শাখা its own papers, history, drafts" });
  return { rates, personas, teachers: tp, scenarios: rows };
}

async function nameOfUsers(ids: string[]): Promise<string[]> {
  return (await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => (u as { name?: string }).name ?? "?");
}
async function nameOfStudents(ids: string[]): Promise<string[]> {
  return (await Student.find({ _id: { $in: ids } }).select("name").lean()).map((s) => s.name as string);
}

/** The report as printable lines. */
export function reportLines(r: TermReport): string[] {
  const out: string[] = ["[dev-fake] === achieved rates vs section 1 targets ==="];
  for (const x of r.rates) out.push(`[dev-fake] ${x.area}: target ${x.target} | achieved ${x.achieved}`);
  out.push("[dev-fake] === child personas ===");
  for (const p of r.personas) out.push(`[dev-fake] ${p.persona} ${p.label}: ${p.count}  e.g. ${p.examples.join(", ")}`);
  out.push("[dev-fake] === teacher personas ===");
  for (const p of r.teachers) out.push(`[dev-fake] ${p.persona} ${p.label}: ${p.count}  e.g. ${p.examples.join(", ")}  (leave days ${p.leaveDays})`);
  out.push("[dev-fake] === scenarios ===");
  for (const s of r.scenarios) out.push(`[dev-fake] ${s.id} ${s.title} [${s.status}] ${s.day}: ${s.produced}${s.names.length ? ` | open: ${s.names.join(", ")}` : ""}`);
  return out;
}
