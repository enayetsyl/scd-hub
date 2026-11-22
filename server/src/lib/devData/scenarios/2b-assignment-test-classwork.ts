/**
 * Scenario 2b (AL-6): the weekly assignment, a class test sheet and in-class work (prd-academic-loop-2027 sections 3.1,
 * 3.8 and 9.3). Run it after scenario 2 (it switches the release switch on when off, like 2a, NOT tagged).
 *
 * For the first school days of the run, each section of Class 1..5 takes ONE class x subject that has mastery on and a
 * locked tree and, THROUGH the real services with explicit dates:
 *   - CW   `createPaper` source CW (the in-class work sheet), a few wrong ticks, `confirmPaper` — in-school evidence;
 *   - CT   `createPaper` source CT (an unlinked class-test question sheet), a few wrong ticks, `confirmPaper`;
 *   - AS   the tailored weekly assignment: `buildAssignment`, `approveAllSheets`, `sendAssignment` (the week / day budget
 *          applies; a refusal is counted), then a few wrong ticks on its AS paper and `confirmPaper`.
 * Every refusal (R19 block, budget, a section with no stock) is counted, never fatal.
 */
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { isTaggedRow } from "../../../modules/mastery/rollup";
import { lockedOutcomes } from "../../../modules/mastery/services/MasteryDiagnosisService";
import { assignmentFor, approveAllSheets, buildAssignment, goldBank, marksTable, sendAssignment } from "../../../modules/mastery/services/MasteryAssignmentService";
import { classTokenForLevel, confirmPaper, createPaper, saveResults, type Auth, type PaperItemInput } from "../../../modules/mastery/services/MasteryWorkService";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import { Student } from "../../../modules/foundation/models/Student";
import { AssignmentItem } from "../../../modules/trackers/models/AssignmentItem";
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import type { Scenario, ScenarioCtx } from "./types";

const DAYS = 6;
const WRONG_CHILDREN = 4;

export const scenario2b: Scenario = {
  // "2b": sorts after scenario 2 (2a) and before scenario 3; `--scenario 2.5` selects it.
  id: 2.5,
  name: "assignment-test-classwork",
  collections: [
    { model: "MasteryPaper" },
    { model: "MasteryResult" },
    { model: "MasteryAssignment" },
    { model: "MasteryAssignmentSheet" },
    // the scenario's OWN tracker items (never an existing one — the AS paper links to them explicitly, so no real item is edited)
    { model: "AssignmentItem" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = {
      cwPapers: 0, ctPapers: 0, asSent: 0, asRefused: 0, ctRefused: 0, wrongTicks: 0, confirmed: 0, confirmRefused: 0, noStock: 0,
    };
    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne(
        { scopeKey: "SCHOOL" },
        { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } },
        { upsert: true },
      );
      ctx.switchedOn.push("academicLoop2027On");
    }

    let taught = 0;
    let asN = 0;
    for (const dayKey of ctx.dayKeys) {
      if (taught >= DAYS) break;
      const day = parseDateKey(dayKey);
      if ((await resolveDayType(day)) !== "FULL") continue;
      taught++;
      const since = new Date();

      for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
        const token = classTokenForLevel(sec.level);
        if (!token) continue;
        const enabled = await MasteryEnablement.find({ academicYearId: ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean();
        const slots = (await slotsForDate("section", sec.sectionId, day)).filter((s) => !s.isBreak && s.teacherId);
        const teacherOf = new Map<string, string>();
        for (const s of slots) if (!teacherOf.has(s.subject)) teacherOf.set(s.subject, String(s.teacherId));
        const subject = ctx.pick(enabled.map((e) => e.subject as string).filter((s) => teacherOf.has(s)), 1)[0];
        if (!subject) continue;
        const auth = { userId: teacherOf.get(subject)!, role: "TEACHER" } as unknown as Auth;

        const outcomes = (await lockedOutcomes(token, subject as MasterySubject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
        const bank = await goldBank(outcomes.map((o) => o.code));
        const marks = await marksTable(token, subject as MasterySubject);
        const itemsOf = (n: number): PaperItemInput[] => {
          const out: PaperItemInput[] = [];
          for (const q of ctx.pick(bank, n * 3)) {
            const lo = outcomes.find((o) => q.loCodes.includes(o.code));
            const type = q.qtCode ?? lo?.questionTypeCodes?.[0];
            if (!lo || !type || !marks.has(type)) continue;
            out.push({ origin: "BANK", artifactId: q.artifactId, loCode: lo.code, questionTypeCode: type });
            if (out.length >= n) break;
          }
          return out;
        };
        const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
        const tick = async (paperId: string) => {
          const paper = await MasteryPaper.findOne({ paperId });
          if (!paper || paper.items.length === 0) return;
          const rows = ctx.pick(kids, Math.min(WRONG_CHILDREN, kids.length)).map((studentId) => {
            const it = paper.items[Math.floor(ctx.rng() * paper.items.length)]!;
            return { studentId, items: [{ itemNo: it.itemNo, marks: ctx.rng() < 0.5 ? 0 : Math.max(0, it.marks / 2) }] };
          });
          if (rows.length > 0) {
            await saveResults(paperId, rows, auth);
            c.wrongTicks += rows.length;
          }
          try {
            await confirmPaper(paperId, auth);
            c.confirmed++;
          } catch {
            c.confirmRefused++;
          }
        };

        const cwItems = itemsOf(3);
        if (cwItems.length === 0) {
          c.noStock++;
          continue;
        }
        try {
          const cw = await createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CW", date: dayKey, items: cwItems }, auth);
          c.cwPapers++;
          await tick(cw.paperId);
        } catch {
          c.confirmRefused++;
        }
        try {
          const ct = await createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CT", date: dayKey, items: itemsOf(4) }, auth);
          c.ctPapers++;
          await tick(ct.paperId);
        } catch {
          c.ctRefused++;
        }
        try {
          // Its own tracker item (tagged, removed with the run); the explicit `asItemId` stops the finalise from finding —
          // and editing the minutes / day split of — a real item of the copied data.
          const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
          asN += 1;
          const item = await AssignmentItem.create({
            asId: `AS-FAKE-${ctx.runId}-${asN}`, academicYearId: ctx.academicYearId, scheduleEntryId: new Types.ObjectId(), weekNumber: 800 + asN,
            cycleWeek: 1, classId: sec.classId, classLevel: sec.level, sectionId: sec.sectionId, subject,
            teacherId: auth.userId, deliveryDate: new Date(y, m - 1, d), dueDate: new Date(y, m - 1, d), estMinutes: 20, status: "DRAFT",
            deliveredBy: auth.userId, deliveredAt: new Date(y, m - 1, d),
          });
          const start = await assignmentFor(sec.sectionId, subject as MasterySubject, dayKey, auth);
          const built = await buildAssignment({ sectionId: sec.sectionId, subject: subject as MasterySubject, dueDate: dayKey, layout: start.startingLayout, rememberLayout: false, asItemId: String(item._id) }, auth);
          await approveAllSheets(built.id, auth);
          const sent = await sendAssignment(built.id, auth);
          c.asSent++;
          if (sent.paperId) await tick(sent.paperId);
        } catch {
          c.asRefused++;
        }
      }
      await ctx.tagSince(since);
    }
    return c;
  },
};
