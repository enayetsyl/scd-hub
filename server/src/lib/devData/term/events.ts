/**
 * The guaranteed events of the realistic term (docs/dev-test-scenarios-2027.md section 3): each catalogue scenario that is not a
 * persona is placed on a specific day so it is SURE to exist. An event is a `Stage`: a function the term loop calls every school day
 * from its start day until it reports done (it may need several days, e.g. the re-teach, or a retry when a child is absent). The
 * events record what they produced and the dev roster names a tester should open.
 */
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { Student } from "../../../modules/foundation/models/Student";
import { Enrolment } from "../../../modules/foundation/models/Enrolment";
import { Guardian } from "../../../modules/foundation/models/Guardian";
import { GuardianLink } from "../../../modules/foundation/models/GuardianLink";
import { SubjectGroupMembership } from "../../../modules/routine/models/SubjectGroupMembership";
import { hashPassword } from "../../../modules/foundation/services/AuthService";
import { openEnrolment, closeEnrolment } from "../../../modules/foundation/services/EnrolmentService";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryAction } from "../../../modules/mastery/models/MasteryAction";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { IntegrityCase } from "../../../modules/homework-integrity/models/IntegrityCase";
import { classTokenForLevel, confirmPaper, createPaper, saveResults, type PaperItemInput } from "../../../modules/mastery/services/MasteryWorkService";
import { buildRetest, closeAction, decideAction, evaluateSectionTriggers } from "../../../modules/mastery/services/MasteryActionService";
import { buildSuggestedDraft } from "../../../modules/mastery/services/AssignmentSuggestionService";
import { recomputeForPaper, recordOutcome } from "../../../modules/homework-integrity/services/IntegrityService";
import { cancelRequest, markPrinted } from "../../../modules/trackers/services/ClassTestService";
import { ctBlockedQids } from "../../../modules/assessment/services/QuestionUseService";
import { AssignmentSchedule } from "../../../modules/trackers/models/AssignmentSchedule";
import { expectedItemsForWeek } from "../../../modules/trackers/services/AssignmentScheduleService";
import { atMidnight, weekNumberFor } from "../../../modules/trackers/assignmentCalendar";
import { appNow } from "../../devClock";
import { absentBySection } from "./daily";
import { registerTest, weekdayOf } from "./tests";
import type { EventRecord, Sim, StockEntry } from "./state";
import type { SectionInfo } from "../scenarios/types";

export interface Stage {
  id: string;
  /** First day it may run (a key; the first open day on / after it). */
  from: string;
  /** "pre" runs before the day's attendance (admissions, leaving, drafts); "post" after the day's marks. */
  phase: "pre" | "post";
  tries: number;
  done: boolean;
  /** Return true when finished; false to be called again the next school day. */
  run: (sim: Sim, dayKey: string) => Promise<boolean>;
}

const nameOf = async (ids: string[]): Promise<string[]> =>
  (await Student.find({ _id: { $in: ids } }).select("name").lean()).map((s) => s.name as string);

const record = (sim: Sim, e: EventRecord): void => {
  sim.events.push(e);
};

/** An objective of the stock with at least `minQ` usable bank questions not used by an earlier event; its items as paper items. */
function objectiveItems(sim: Sim, st: StockEntry, minQ: number, used: Set<string>): { loCode: string; items: PaperItemInput[] } | null {
  for (const o of st.outcomes) {
    if (used.has(o.code)) continue;
    const usable: PaperItemInput[] = [];
    for (const q of st.bank) {
      if (!q.loCodes.includes(o.code)) continue;
      const type = q.qtCode ?? o.questionTypeCodes?.[0];
      if (!type || !st.marks.has(type)) continue;
      usable.push({ origin: "BANK", artifactId: q.artifactId, loCode: o.code, questionTypeCode: type });
    }
    if (usable.length >= minQ) return { loCode: o.code, items: sim.ctx.pick(usable, usable.length) };
  }
  return null;
}

const usedObjectives = new Set<string>();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The OPEN integrity case of a child x objective, waiting up to `tries` x 200 ms for the confirm's hook to write it. */
async function settleCase(studentId: string, loCode: string, tries = 15): Promise<InstanceType<typeof IntegrityCase> | null> {
  for (let i = 0; i < tries; i++) {
    const open = await IntegrityCase.findOne({ studentId, loCode, status: "OPEN" });
    if (open) return open;
    await sleep(200);
  }
  return null;
}

/** Forget the state of an earlier run in this process. */
export function resetEventState(): void {
  usedObjectives.clear();
  leaverId = "";
}

/** The first section (level >= 1) with a subject today that is mastery-enabled with an objective of `minQ` questions. */
async function sectionWithObjective(sim: Sim, dayKey: string, minQ: number, only?: string): Promise<{ sec: SectionInfo; subject: string; teacherId: string; loCode: string; items: PaperItemInput[] } | null> {
  for (const sec of sim.sections.filter((s) => s.level >= 1 && (!only || s.sectionId === only))) {
    const token = classTokenForLevel(sec.level);
    if (!token) continue;
    const enabled = new Set((await MasteryEnablement.find({ academicYearId: sim.ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean()).map((e) => e.subject as string));
    const slots = await sim.slotsOn(dayKey, sec.sectionId);
    for (const subject of [...new Set(slots.map((s) => s.subject))].filter((s) => enabled.has(s))) {
      const teacherId = sim.teacherOfSubject(slots, subject);
      const st = await sim.stock(sec.level, subject);
      if (!teacherId || !st) continue;
      // an objective no earlier event used; when every objective is used (a small bank), the first with enough questions is used again
      const got = objectiveItems(sim, st, minQ, usedObjectives) ?? objectiveItems(sim, st, minQ, new Set());
      if (got) return { sec, subject, teacherId, ...got };
    }
  }
  return null;
}

const firstOpenFrom = (sim: Sim, key: string): string => sim.openDays.find((d) => d >= key) ?? (sim.openDays[sim.openDays.length - 1] as string);

// ---------------------------------------------------------------------------
// C8 late joiner, C9 leaver
// ---------------------------------------------------------------------------

async function admitChild(sim: Sim, dayKey: string, level: number, tag: string, name: string): Promise<{ studentId: string; sec: SectionInfo } | null> {
  const sec = sim.sections.find((s) => s.level === level) ?? sim.sections.find((s) => s.level >= 1);
  if (!sec) return null;
  const student = await Student.create({ schoolId: `FAKE-${sim.ctx.runId.slice(5)}-${tag}`, name, classId: sec.classId, sectionId: sec.sectionId, active: true });
  await openEnrolment({ studentId: String(student._id), sectionId: sec.sectionId, startKey: dayKey });
  sim.childPersona.set(String(student._id), "TYPICAL");
  return { studentId: String(student._id), sec };
}

/** The fake guardian of the late joiner logs in with the ONE shared dev tester password (`DEV_TEST_PASSWORD`, the same
 *  one dev-mask sets; given to testers out of band, never in the repo). Without it the guardian gets no login. */
const fakeGuardianPassword = (): string | undefined => process.env.DEV_TEST_PASSWORD || undefined;

const lateJoiner: Stage = {
  id: "C8", from: "2027-02-14", phase: "pre", tries: 0, done: false,
  async run(sim, dayKey) {
    const r = await admitChild(sim, dayKey, 2, "J1", "ফেক দেরিতে ভর্তি শিক্ষার্থী");
    if (!r) return true;
    sim.bump("lateJoiners");
    // The guardian side: a tagged guardian with a login, linked to the child (the createGuardian + linkGuardianToStudent rows).
    const phone = `0199${String(sim.ctx.seed).replace(/\D/g, "").padStart(7, "0").slice(-7)}`;
    let login = "no guardian login (the phone is already in use on this DB)";
    const pw = fakeGuardianPassword();
    const g = await sim.safe("joinerGuardian", async () => {
      const passwordHash = pw ? await hashPassword(pw) : undefined;
      return Guardian.create({ name: "ফেক অভিভাবক", identifierKind: "phone", identifier: phone, phone, ...(passwordHash ? { passwordHash } : {}), loginEnabled: !!passwordHash, active: true });
    });
    if (g) {
      await GuardianLink.create({ guardianId: g._id, studentId: r.studentId, relation: "mother", active: true });
      login = pw ? `guardian login: phone ${phone} (the shared dev test password)` : `guardian ${phone} has no login (DEV_TEST_PASSWORD not set)`;
    }
    // The attendance group: a classmate's Quran / Arabic group memberships (attendance of C1-5 is keyed to the Quran group, not the section)
    const mates = (await Student.find({ sectionId: r.sec.sectionId, active: true, _id: { $ne: r.studentId } }).select("_id").lean()).map((m) => m._id);
    const mems = await SubjectGroupMembership.find({ studentId: { $in: mates } }).lean();
    const byMate = new Map<string, typeof mems>();
    for (const m of mems) byMate.set(String(m.studentId), [...(byMate.get(String(m.studentId)) ?? []), m]);
    const best = [...byMate.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    for (const m of best) await sim.safe("joinerGroup", () => SubjectGroupMembership.create({ groupId: m.groupId, studentId: r.studentId, track: m.track }));
    record(sim, { id: "C8", title: "Late joiner", day: dayKey, status: g ? "placed" : "partly", produced: `admitted into ${r.sec.nameBn} (level ${r.sec.level}) through an enrolment dated ${dayKey}; ${best.length} attendance group membership(s) copied from a classmate; ${login}`, names: ["ফেক দেরিতে ভর্তি শিক্ষার্থী"], lookAt: "Roster, first weeks NOT_ASSESSED, catch-up; guardian app" });
    return true;
  },
};

let leaverId = "";
const leaverAdmit: Stage = {
  id: "C9a", from: "2027-01-01", phase: "pre", tries: 0, done: false,
  async run(sim, dayKey) {
    const r = await admitChild(sim, dayKey, 3, "L1", "ফেক ছেড়ে যাওয়া শিক্ষার্থী");
    if (r) leaverId = r.studentId;
    return true;
  },
};
const leaverLeaves: Stage = {
  id: "C9", from: "2027-04-06", phase: "pre", tries: 0, done: false,
  async run(sim, dayKey) {
    if (!leaverId) {
      record(sim, { id: "C9", title: "Leaver", day: dayKey, status: "not placed", produced: "no section to admit the leaver into", names: [], lookAt: "" });
      return true;
    }
    const open = await Enrolment.findOne({ studentId: leaverId, status: "ACTIVE" });
    if (open) {
      const lastKey = sim.openDays[Math.max(0, sim.openDays.indexOf(dayKey) - 1)] as string;
      await closeEnrolment(String(open._id), { endKey: lastKey, outcome: "LEFT" });
    }
    await Student.updateOne({ _id: leaverId }, { $set: { active: false } });
    sim.bump("leavers");
    record(sim, { id: "C9", title: "Leaver", day: dayKey, status: "placed", produced: `enrolment closed LEFT on ${dayKey}, child inactive; Jan-Mar records stay`, names: await nameOf([leaverId]), lookAt: "Records stop after the leaving day, past data stays" });
    return true;
  },
};

// ---------------------------------------------------------------------------
// T7 over-cap week: two teacher-built drafts of 200 marks in one week
// ---------------------------------------------------------------------------

const overCap: Stage = {
  id: "T7", from: "2027-01-27", phase: "pre", tries: 0, done: false,
  async run(sim, dayKey) {
    if (weekdayOf(dayKey) !== 3) return false; // the Wednesday draft day
    const sch = await AssignmentSchedule.findOne({ academicYearId: sim.ctx.academicYearId });
    if (!sch) {
      record(sim, { id: "T7", title: "Over-cap week", day: dayKey, status: "not placed", produced: "no AssignmentSchedule on this DB", names: [], lookAt: "" });
      return true;
    }
    const w0 = weekNumberFor(sch.termStartDate, atMidnight(appNow()));
    for (const w of [w0, w0 + 1]) {
      const week = await expectedItemsForWeek(String(sim.ctx.academicYearId), w).catch(() => null);
      if (!week || week.suspended || !week.dueDate || (week.deliveryDate ?? "").slice(0, 10) < dayKey) continue;
      const bySec = new Map<string, string[]>();
      for (const it of week.items) if (it.classLevel >= 1 && !it.nilDeclared && !it.delivered) bySec.set(it.sectionId, [...(bySec.get(it.sectionId) ?? []), it.subject as string]);
      const hit = [...bySec.entries()].find(([, subs]) => subs.length >= 2);
      if (!hit) continue;
      const [sectionId, subs] = hit;
      let built = 0;
      for (const subject of subs.slice(0, 2)) {
        const teacherId = sim.cellTeacher.get(`${sectionId}|${subject}`) ?? sim.principal.userId;
        const r = await sim.safe("overCapBuild", () => buildSuggestedDraft({ sectionId, subject: subject as MasterySubject, dueYmd: (week.dueDate as string).slice(0, 10), nSubjects: 1, builtBy: "TEACHER", actorId: teacherId }));
        if (r?.assignment) built++;
      }
      record(sim, {
        id: "T7", title: "Over-cap week", day: dayKey, status: built === 2 ? "placed" : "partly",
        produced: `${built} teacher-built drafts of the full 360 min each for one week (nSubjects = 1); the Thursday finalise of the second is refused by the week budget - see the refusal reasons "asFinaliseRefused"`,
        names: [], lookAt: "Finalise refusal naming the overage; trim the draft",
      });
      return true;
    }
    return false;
  },
};

// ---------------------------------------------------------------------------
// T8 re-teach: two CW sheets most of the class gets wrong -> proposal -> decided -> re-test built -> closed with before/after
// ---------------------------------------------------------------------------

function reteachStage(): Stage {
  let step = 0;
  let found: { sec: SectionInfo; subject: string; loCode: string; items: PaperItemInput[] } | null = null;
  let failing: string[] = [];
  let actionId = "";
  let closeOn = "";
  return {
    id: "T8", from: "2027-02-07", phase: "post", tries: 0, done: false,
    async run(sim, dayKey) {
      if (step <= 1) {
        // step 0 picks the objective and gives the first sheet; step 1 (next day) gives the second sheet on the same objective
        if (step === 0) {
          const f = await sectionWithObjective(sim, dayKey, 6) ?? (await sectionWithObjective(sim, dayKey, 3));
          if (!f) return false;
          found = f;
          usedObjectives.add(f.loCode);
        }
        const f = found!;
        const slots = await sim.slotsOn(dayKey, f.sec.sectionId);
        const teacherId = sim.teacherOfSubject(slots, f.subject);
        if (!teacherId) return false;
        const auth = sim.authOf(teacherId);
        const items = f.items.length >= 6 ? f.items.slice(step * 3, step * 3 + 3) : f.items.slice(0, 3);
        const paper = await sim.safe("reteachCw", () => createPaper({ sectionId: f.sec.sectionId, subject: f.subject as MasterySubject, source: "CW", date: dayKey, items }, auth));
        if (!paper) return false;
        if (step === 0) {
          const kids = (await Student.find({ sectionId: f.sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
          failing = sim.ctx.pick(kids, Math.max(1, Math.ceil(kids.length * 0.75)));
        }
        const doc = await MasteryPaper.findOne({ paperId: paper.paperId });
        await saveResults(paper.paperId, failing.map((studentId) => ({ studentId, items: (doc?.items ?? []).map((it) => ({ itemNo: it.itemNo, marks: 0 })) })), auth);
        await confirmPaper(paper.paperId, auth);
        sim.bump("reteachCw");
        step++;
        return false;
      }
      const f = found!;
      if (step === 2) {
        await sim.safe("reteachEval", () => evaluateSectionTriggers(new Types.ObjectId(f.sec.sectionId), f.subject as MasterySubject));
        const a = await MasteryAction.findOne({ sectionId: f.sec.sectionId, subject: f.subject, loCode: f.loCode });
        if (!a) {
          record(sim, { id: "T8", title: "Re-teach", day: dayKey, status: "not placed", produced: "two in-school sheets did not open a proposal (trigger thresholds)", names: [], lookAt: "" });
          return true;
        }
        actionId = String(a._id);
        const decided = await sim.safe("reteachDecide", () => decideAction(actionId, { decision: "RETEACH", note: "ডেভ ডেটা — আবার পড়ানো" }, sim.principal));
        if (decided) {
          const slots = await sim.slotsOn(dayKey, f.sec.sectionId);
          const teacherId = sim.teacherOfSubject(slots, f.subject) ?? sim.principal.userId;
          await sim.safe("reteachRetest", () => buildRetest(actionId, sim.authOf(teacherId)));
        }
        closeOn = sim.addSchoolDays(dayKey, 8);
        step = 3;
        return false;
      }
      if (dayKey < closeOn) return false;
      const closed = await sim.safe("reteachClose", () => closeAction(actionId, "PARTIAL", "ডেভ ডেটা — রি-টেস্টের ফল ছাড়া বন্ধ", sim.principal));
      record(sim, {
        id: "T8", title: "Re-teach", day: dayKey, status: closed ? "placed" : "partly",
        produced: `two CW sheets (75 % of ${f.sec.nameBn} wrong) -> MasteryAction proposed -> RETEACH decided -> re-test built -> ${closed ? "closed with before/after" : "left open (close refused)"}`,
        names: [], lookAt: "Re-teach list: proposed -> planned -> done with before/after",
      });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// C7 outside help: high homework + low class test on one objective -> case -> outcome
// ---------------------------------------------------------------------------

function outsideHelpStage(id: string, from: string, outcome: "GUARDIAN_DID" | "CHILD_DID" | "UNCLEAR", childPick: (sim: Sim) => string | null, repeatOf?: () => string | null): Stage {
  let step = 0;
  let chosen: { sec: SectionInfo; subject: string; loCode: string; hw: PaperItemInput[]; ctPool: PaperItemInput[] } | null = null;
  let childId = "";
  return {
    id, from, phase: "post", tries: 0, done: false,
    async run(sim, dayKey) {
      if (step === 0) {
        childId = (repeatOf ? repeatOf() : null) ?? childPick(sim) ?? "";
        const sectionId = childId ? String((await Student.findById(childId).select("sectionId").lean())?.sectionId ?? "") : "";
        const f = await sectionWithObjective(sim, dayKey, 4, sectionId || undefined);
        if (!f) return false;
        usedObjectives.add(f.loCode);
        chosen = { sec: f.sec, subject: f.subject, loCode: f.loCode, hw: f.items.slice(0, 2), ctPool: f.items.slice(2) };
        const auth = sim.authOf(f.teacherId);
        const hw = await sim.safe("ohHw", () => createPaper({ sectionId: f.sec.sectionId, subject: f.subject as MasterySubject, source: "HW", date: dayKey, items: chosen!.hw }, auth));
        if (!hw) return false;
        await sim.safe("ohHwConfirm", () => confirmPaper(hw.paperId, auth)); // nobody ticked wrong: HW 100 %
        if (!childId) {
          const kids = (await Student.find({ sectionId: f.sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
          childId = sim.ctx.pick(kids, 1)[0] ?? "";
        }
        step = 1;
        return false; // the class test is the next school day
      }
      const c = chosen!;
      if (absentBySection.get(c.sec.sectionId)?.has(childId) && sim.tries(id) < 4) return false; // the child must sit the test: try the next day
      const slots = await sim.slotsOn(dayKey, c.sec.sectionId);
      const teacherId = sim.teacherOfSubject(slots, c.subject);
      if (!teacherId) return false;
      const auth = sim.authOf(teacherId);
      // R19: a class-test sheet takes no question the section had as homework / assignment in the no-repeat window - look them up once
      const st = await sim.stock(c.sec.level, c.subject);
      const qidOf = new Map((st?.bank ?? []).map((q) => [q.artifactId, q.qid]));
      const token = classTokenForLevel(c.sec.level) as string;
      const blocked = new Set((await ctBlockedQids({ sectionId: c.sec.sectionId, qids: [...qidOf.values()], classToken: token, subject: c.subject })).blocked);
      const free = c.ctPool.filter((it) => !blocked.has(qidOf.get(String(it.artifactId)) ?? ""));
      if (free.length < 2) {
        sim.ctx.refuse("ohCt", "fewer than two unblocked questions left on the objective");
        return false;
      }
      const ct = await sim.safe("ohCt", () => createPaper({ sectionId: c.sec.sectionId, subject: c.subject as MasterySubject, source: "CT", date: dayKey, items: free.slice(0, 2) }, auth));
      if (!ct) return false;
      const paper = await MasteryPaper.findOne({ paperId: ct.paperId });
      if (!paper) return false;
      await saveResults(ct.paperId, [{ studentId: childId, items: paper.items.map((it) => ({ itemNo: it.itemNo, marks: 0 })) }], auth);
      await sim.safe("ohCtConfirm", () => confirmPaper(ct.paperId, auth));
      // The confirm's own hook opens the case (fire-and-forget): WAIT for it instead of racing it with a second recompute; only when
      // it never shows up is the recompute run once, as the fallback.
      let open = await settleCase(childId, c.loCode);
      if (!open) {
        await sim.safe("ohRecompute", () => recomputeForPaper(paper._id as Types.ObjectId, paper.academicYearId as Types.ObjectId));
        open = await settleCase(childId, c.loCode, 3);
      }
      let outcomeDone = false;
      if (open) {
        outcomeDone = !!(await sim.safe("ohOutcome", () => recordOutcome(String(open._id), outcome, "ডেভ ডেটা", { userId: auth.userId, role: "TEACHER", all: true })));
      }
      if (open) sim.bump("integrityCasesOpened");
      if (outcomeDone) sim.bump("integrityOutcomes");
      sim.outsideHelpChild.set(id, childId);
      record(sim, {
        id, title: `Outside help (${outcome}${repeatOf ? ", recurring child" : ""})`, day: dayKey, status: open && outcomeDone ? "placed" : open ? "partly" : "not placed",
        produced: open ? `HW 100 % + CT 0 % on ${c.loCode} -> integrity case opened -> outcome ${outcomeDone ? outcome : "not recorded"}` : "no case opened (not enough evidence on the objective)",
        names: await nameOf([childId]), lookAt: "Integrity case -> staff tag + guardian gentle note for the term",
      });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// S4 print queue: one printed Thursday sheet, one cancelled
// ---------------------------------------------------------------------------

const printQueue: Stage = {
  id: "S4", from: "2027-04-11", phase: "post", tries: 0, done: false,
  async run(sim, dayKey) {
    const f = await sectionWithObjective(sim, dayKey, 1);
    const sec = f?.sec ?? sim.sections.find((s) => s.level >= 1);
    if (!sec) return false;
    const slots = await sim.slotsOn(dayKey, sec.sectionId);
    const subject = f?.subject ?? slots[0]?.subject;
    const teacherId = f?.teacherId ?? slots[0]?.teacherId;
    if (!subject || !teacherId) return false;
    const a = await sim.safe("printReq", () => registerTest(sim, sec, subject, dayKey, 20, teacherId, false));
    const b = await sim.safe("printReq", () => registerTest(sim, sec, subject, dayKey, 20, teacherId, false));
    if (!a || !b) return false;
    const printed = await sim.safe("printMark", () => markPrinted(a, teacherId));
    const cancelled = await sim.safe("printCancel", () => cancelRequest(b, teacherId));
    record(sim, { id: "S4", title: "Print queue", day: dayKey, status: printed && cancelled ? "placed" : "partly", produced: `${sec.nameBn} ${subject}: one request printed, one cancelled`, names: [], lookAt: "Print queue: locked items, re-print" });
    return true;
  },
};

/** Build every stage of the term. `c7` returns the C7-persona children (for the outside-help cases). */
export function buildStages(sim: Sim): Stage[] {
  // the outside-help cases need a child of Class 1..5 (the classes with a weekly assignment, class tests and mastery)
  const upper = (id: string): boolean => (sim.level.get(sim.childSection.get(id) ?? "") ?? -1) >= 1;
  const c7 = [...sim.childPersona.entries()].filter(([id, p]) => p === "C7" && upper(id)).map(([id]) => id).sort();
  const typical = [...sim.childPersona.entries()].filter(([id, p]) => p === "TYPICAL" && upper(id)).map(([id]) => id).sort();
  let n = 0;
  const pickTypical = (): string | null => typical[(n++ * 7 + 3) % Math.max(1, typical.length)] ?? null;
  const stages: Stage[] = [
    ...[leaverAdmit, lateJoiner, leaverLeaves, overCap].map((x) => ({ ...x, tries: 0, done: false })),
    reteachStage(), { ...printQueue, tries: 0, done: false },
    outsideHelpStage("C7a", "2027-02-28", "GUARDIAN_DID", () => c7[0] ?? pickTypical()),
    outsideHelpStage("C7b", "2027-04-04", "CHILD_DID", () => c7[1] ?? pickTypical()),
    outsideHelpStage("C7c", "2027-04-25", "UNCLEAR", pickTypical),
    // the recurring child: the SAME child as C7a, a second case in term 1
    outsideHelpStage("C7d", "2027-05-30", "GUARDIAN_DID", () => null, () => sim.outsideHelpChild.get("C7a") ?? c7[0] ?? null),
  ];
  for (const s of stages) {
    const moved = sim.ctx.eventDays?.[s.id === "C9a" ? "C9" : s.id];
    if (moved) s.from = s.id === "C9a" ? "2027-01-01" : moved;
  }
  return stages;
}

/** Run today's stages of one phase. A stage that throws is counted and retried the next day (up to 6 tries), then given up. */
export async function runStages(sim: Sim, stages: Stage[], dayKey: string, phase: "pre" | "post"): Promise<void> {
  for (const s of stages) {
    if (s.done || s.phase !== phase || dayKey < firstOpenFrom(sim, s.from)) continue;
    s.tries++;
    sim.stageTries.set(s.id, s.tries);
    try {
      if (await s.run(sim, dayKey)) s.done = true;
    } catch (e) {
      sim.bump(`${s.id}Error`);
      sim.ctx.refuse(`${s.id}Stage`, e);
    }
    if (!s.done && s.tries >= 12) {
      s.done = true;
      if (!sim.events.some((e) => e.id === s.id)) record(sim, { id: s.id, title: s.id, day: dayKey, status: "not placed", produced: "gave up after 12 school days of retries (see the refusal reasons)", names: [], lookAt: "" });
    }
  }
}

/** Stages that never finished by the end of the run are reported as not placed. */
export function closeStages(sim: Sim, stages: Stage[], lastDay: string): void {
  for (const s of stages) {
    if (!s.done && !sim.events.some((e) => e.id === s.id)) record(sim, { id: s.id, title: s.id, day: lastDay, status: "not placed", produced: "did not finish before the last day of the run", names: [], lookAt: "" });
  }
}
