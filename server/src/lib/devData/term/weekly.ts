/**
 * The weekly assignment cycle of the realistic term, through the real machinery: ASDRAFT (`runAsDraft`, the engine's Wednesday
 * draft), the teacher's edits (swap / remove / add) and finalise (Thursday, later for a late marker, by the Office when the cell
 * teacher is on leave), the system delivery (`deliverTailoredItems`), the children's hand-in on the due day (by child persona) and
 * the teacher's marking (Tuesday for a diligent teacher, later for a late marker).
 */
import { MasteryAssignment } from "../../../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../../../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { AssignmentItem } from "../../../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../../../modules/trackers/models/AssignmentStudentRecord";
import { editSheet, sendAssignment } from "../../../modules/mastery/services/MasteryAssignmentService";
import { deliverTailoredItems, runAsDraft } from "../../../modules/mastery/services/AssignmentSuggestionService";
import { confirmAssignmentWeek, transitionAssignmentRecord } from "../../../modules/trackers/services/AssignmentService";
import { confirmPaper } from "../../../modules/mastery/services/MasteryWorkService";
import { appNow } from "../../devClock";
import { approveWithReview } from "../scenarios/helpers";
import { between, CHILD_PERSONAS, itemMarks, TEACHER_PERSONAS } from "./personas";
import { personaOf, saveRowsTolerant, successChance } from "./daily";
import type { Sim } from "./state";

export interface AsTrack {
  id: string;
  sectionId: string;
  subject: string;
  level: number;
  teacherId: string;
  finaliseOn: string;
  dueKey: string;
  stage: "DRAFT" | "SENT";
  paperId?: string;
  markOn?: string;
  handedIn: boolean;
  missed: Set<string>;
  tries: number;
}

export const asTracks = new Map<string, AsTrack>();
export const resetWeeklyState = (): void => asTracks.clear();
const dayKeyOfDue = (d: Date): string => d.toISOString().slice(0, 10);

/** The cell teacher of a section x subject: the teacher of its first routine period. */
export function cellTeacherOf(sim: Sim, sectionId: string, subject: string): string | null {
  return sim.cellTeacher.get(`${sectionId}|${subject}`) ?? null;
}

/** Everything the weekly cycle does on one school day. */
export async function weeklyDay(sim: Sim, dayKey: string, runStart: Date): Promise<void> {
  // 1. the engine's drafts (idempotent: it drafts only on / after the draft day of a week, once per cell)
  const sum = await sim.safe("asDraft", () => runAsDraft(appNow()));
  if (sum) {
    sim.bump("asDraftCreated", sum.created);
    sim.bump("asDraftManual", sum.manual);
    sim.bump("asDraftFailed", sum.failed);
  }
  // 2. new drafts -> a finalise day by the cell teacher's persona
  const drafts = await MasteryAssignment.find({ status: "DRAFT", createdAt: { $gte: runStart } }).select("_id sectionId subject dueDate").lean();
  for (const a of drafts) {
    const id = String(a._id);
    if (asTracks.has(id)) continue;
    const sectionId = String(a.sectionId);
    const teacherId = cellTeacherOf(sim, sectionId, a.subject as string) ?? "";
    const spec = TEACHER_PERSONAS[sim.teacherPersona.get(teacherId) ?? "T1"];
    const dueKey = dayKeyOfDue(a.dueDate as Date);
    let finaliseOn = sim.addSchoolDays(dayKey, between(sim.ctx.rng, spec.finaliseDelay[0], spec.finaliseDelay[1]));
    if (finaliseOn > dueKey) finaliseOn = dayKey;
    asTracks.set(id, { id, sectionId, subject: a.subject as string, level: sim.level.get(sectionId) ?? 1, teacherId, finaliseOn, dueKey, stage: "DRAFT", handedIn: false, missed: new Set(), tries: 0 });
    sim.bump("asDrafts");
  }
  // 3. finalise
  for (const t of [...asTracks.values()].filter((x) => x.stage === "DRAFT" && x.finaliseOn <= dayKey)) await finalise(sim, t, dayKey);
  // 4. the system delivery of every sent assignment whose delivery day has come
  const delivered = await sim.safe("asDeliver", () => deliverTailoredItems(appNow()));
  if (delivered) sim.bump("asDelivered", delivered);
  // 5. hand-in on / after the due day, then marking
  for (const t of [...asTracks.values()].filter((x) => x.stage === "SENT")) {
    if (!t.handedIn && t.dueKey <= dayKey) await handIn(sim, t, dayKey);
    if (t.handedIn && t.markOn && t.markOn <= dayKey) await mark(sim, t, dayKey);
  }
}

async function finalise(sim: Sim, t: AsTrack, dayKey: string): Promise<void> {
  const onLeave = !!t.teacherId && !!sim.onLeave.get(t.teacherId)?.has(dayKey);
  if (onLeave && t.finaliseOn === dayKey && dayKey < t.dueKey) {
    // the cell teacher is out: the Office finalises on her behalf (R28), unless a cover is on the routine that day (counted too)
    sim.bump("asFinalisedOnLeave");
  }
  const auth = onLeave || !t.teacherId ? sim.principal : sim.authOf(t.teacherId);
  const spec = TEACHER_PERSONAS[sim.teacherPersona.get(t.teacherId) ?? "T1"];
  const sheets = await MasteryAssignmentSheet.find({ assignmentId: t.id }).select("studentId items").lean();
  if (sheets.length > 0 && sim.ctx.rng() < spec.editRate) {
    // a teacher's edit of a child's draft sheet: remove an item, swap it, or add a question
    const sh = sim.ctx.pick(sheets, 1)[0]!;
    const op = sim.ctx.pick(["REMOVE", "SWAP", "ADD_BANK"] as const, 1)[0]!;
    const studentId = String(sh.studentId);
    if (op === "ADD_BANK") {
      const st = await sim.stock(t.level, t.subject);
      const qid = st ? sim.ctx.pick(st.bank, 1)[0]?.qid : undefined;
      if (qid) await sim.safe("asEdit", () => editSheet(t.id, studentId, { op, qid }, auth));
    } else if (sh.items.length > 1) {
      await sim.safe("asEdit", () => editSheet(t.id, studentId, { op, index: 0 }, auth));
    }
    sim.bump("asEdits");
  }
  const ok = await sim.safe("asFinalise", async () => {
    await approveWithReview(t.id, auth);
    return sendAssignment(t.id, auth);
  });
  if (!ok) {
    t.tries++;
    if (t.tries >= 3) asTracks.delete(t.id); // give up on a draft the services keep refusing
    return;
  }
  t.stage = "SENT";
  t.paperId = ok.paperId ?? undefined;
  sim.bump("asSent");
  const spec2 = TEACHER_PERSONAS[sim.teacherPersona.get(t.teacherId) ?? "T1"];
  // marking: Tuesday (two school days after the Sunday due day) for a diligent teacher, later for the others
  t.markOn = sim.addSchoolDays(t.dueKey, 2 + between(sim.ctx.rng, spec2.asDelay[0], spec2.asDelay[1]));
}

async function handIn(sim: Sim, t: AsTrack, dayKey: string): Promise<void> {
  if (!t.paperId) {
    t.handedIn = true;
    return;
  }
  const paper = await MasteryPaper.findOne({ paperId: t.paperId }).select("links").lean();
  const asItemId = paper?.links?.asItemId ? String(paper.links.asItemId) : null;
  if (!asItemId) {
    // not delivered yet (the tick delivers on the delivery day): retry on the next days, then give up
    if (++t.tries > 4) {
      sim.bump("asNotDelivered");
      asTracks.delete(t.id);
    }
    return;
  }
  let recs = await AssignmentStudentRecord.find({ asItemId, state: "GIVEN" }).select("_id studentId").lean();
  if (recs.length === 0) {
    const item = await AssignmentItem.findById(asItemId).select("academicYearId sectionId weekNumber").lean();
    if (item) {
      await sim.safe("asIssue", () => confirmAssignmentWeek({ academicYearId: String(item.academicYearId), sectionId: String(item.sectionId), weekNumber: item.weekNumber, actorId: t.teacherId || sim.principal.userId, at: appNow() }));
      recs = await AssignmentStudentRecord.find({ asItemId, state: "GIVEN" }).select("_id studentId").lean();
    }
  }
  const actor = t.teacherId || sim.principal.userId;
  const tally = sim.tallyOf(t.level);
  for (const r of recs) {
    const studentId = String(r.studentId);
    const miss = sim.ctx.rng() < CHILD_PERSONAS[personaOf(sim, studentId)].asMiss;
    const stat = sim.statOf(studentId);
    stat.asN++;
    tally.asN++;
    await sim.safe("asHandIn", async () => {
      await transitionAssignmentRecord(String(r._id), "DUE", actor, appNow());
      await transitionAssignmentRecord(String(r._id), miss ? "CHASE" : "SUBMITTED", actor, appNow());
    });
    if (miss) {
      t.missed.add(studentId);
      stat.asMiss++;
      tally.asMiss++;
      sim.bump("asChase");
    } else sim.bump("asSubmitted");
  }
  t.handedIn = true;
  void dayKey;
}

async function mark(sim: Sim, t: AsTrack, dayKey: string): Promise<void> {
  asTracks.delete(t.id);
  if (!t.paperId) return;
  if (t.teacherId && sim.onLeave.get(t.teacherId)?.has(dayKey)) {
    // out today: marked on the first day back (the deadline moves to the first day back)
    t.markOn = sim.addSchoolDays(dayKey, 1);
    asTracks.set(t.id, t);
    return;
  }
  const paper = await MasteryPaper.findOne({ paperId: t.paperId });
  if (!paper || paper.items.length === 0) return;
  const auth = t.teacherId ? sim.authOf(t.teacherId) : sim.principal;
  const rows: Array<{ studentId: string; items: Array<{ itemNo: number; marks: number }> }> = [];
  for (const own of paper.perStudentItems ?? []) {
    const studentId = String(own.studentId);
    if (t.missed.has(studentId) || own.itemNos.length === 0) continue; // handed nothing in / an empty sheet (nothing to tick)
    const p = personaOf(sim, studentId) === "C7" ? 0.95 : successChance(sim, studentId, t.level, dayKey, sim.ctx.rng);
    const wrong = paper.items
      .filter((i) => own.itemNos.includes(i.itemNo))
      .map((i) => ({ itemNo: i.itemNo, marks: itemMarks(sim.ctx.rng, p, i.marks), full: i.marks }))
      .filter((m) => m.marks < m.full);
    if (wrong.length > 0) rows.push({ studentId, items: wrong.map(({ itemNo, marks }) => ({ itemNo, marks })) });
  }
  if (rows.length > 0) {
    sim.bump("asWrongRows", await saveRowsTolerant(sim, t.paperId as string, rows, auth, "asTicks"));
  }
  const ok = await sim.safe("asConfirm", () => confirmPaper(t.paperId as string, auth));
  if (ok) sim.bump("asConfirmed");
}
