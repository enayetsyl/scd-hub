/**
 * Scenario 2b (AL-6): the weekly assignment, a class test sheet and in-class work (prd-academic-loop-2027 sections 3.1,
 * 3.8 and 9.3). Run it after scenario 2 (it switches the release switch on when off, like 2a, NOT tagged).
 *
 * For the first school days of the run, each section of Class 1..5 takes ONE class x subject that has mastery on and a
 * locked tree and, THROUGH the real services with explicit dates:
 *   - CW   `createPaper` source CW (the in-class work sheet), a few wrong ticks, `confirmPaper` — in-school evidence;
 *   - CT   a class test REGISTERED through `createRequest` (an uploaded paper, `skipPrint`: born PRINTED, one StoredFile row) and
 *          its question sheet `createPaper` source CT linked to it (`classTestId`; the sheet's marks = the test's total), a few
 *          wrong ticks, `confirmPaper` - the linked sheet is what writes the CT rows of the question ledger (an UNLINKED CT sheet
 *          writes none, by design: it is not "given" until a test owns it) and the test's results;
 *   - AS   the tailored weekly assignment: `buildAssignment`, `approveAllSheets`, `sendAssignment`, then a few wrong ticks on its
 *          AS paper and `confirmPaper`. ONE per section per fake week, a different subject each week: a second one for the same
 *          week x section x subject is refused (AC-C12) and the week budget (AC-C4) caps how many subjects fit in a week.
 * Every refusal (R19 block, budget, a section with no stock) is counted AND logged by reason (`ctx.refuse`), never fatal. The
 * dev clock is set to each fake day, so "CW is dated today or earlier", "today's routine teacher" and "the test's day has come"
 * read the fake day.
 */
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { isTaggedRow } from "../../../modules/mastery/rollup";
import { lockedOutcomes } from "../../../modules/mastery/services/MasteryDiagnosisService";
import { assignmentFor, buildAssignment, goldBank, marksTable, sendAssignment } from "../../../modules/mastery/services/MasteryAssignmentService";
import { classTokenForLevel, confirmPaper, createPaper, saveResults, type Auth, type PaperItemInput } from "../../../modules/mastery/services/MasteryWorkService";
import { ctBlockedQids, isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import { Student } from "../../../modules/foundation/models/Student";
import { AssignmentItem } from "../../../modules/trackers/models/AssignmentItem";
import { Types } from "mongoose";
import { StoredFile } from "../../../modules/platform/models/StoredFile";
import { createRequest } from "../../../modules/trackers/services/ClassTestService";
import { confirmAssignmentWeek, transitionAssignmentRecord } from "../../../modules/trackers/services/AssignmentService";
import { AssignmentStudentRecord } from "../../../modules/trackers/models/AssignmentStudentRecord";
import { appNow } from "../../devClock";
import type { MasterySubject } from "@scd/shared";
import { approveWithReview } from "./helpers";
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
    // the class test registered for the CT sheet (+ its question file stub and the results the confirm writes)
    { model: "ClassTest" },
    { model: "ClassTestResult" },
    { model: "StoredFile" },
    // sending the AS paper on / after its delivery day delivers the tracker item: its roster records ride along
    { model: "AssignmentStudentRecord" },
    // the scenario's OWN tracker items (never an existing one — the AS paper links to them explicitly, so no real item is edited)
    { model: "AssignmentItem" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = {
      cwPapers: 0, cwRefused: 0, ctPapers: 0, ctLinked: 0, asSent: 0, gapApprovals: 0, asRefused: 0, ctRefused: 0, wrongTicks: 0, confirmed: 0, confirmRefused: 0, noStock: 0,
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
    let ctN = 0;
    const asUsed = new Map<string, Set<string>>(); // sectionId -> the subjects already given a weekly assignment
    const asWeek = new Set<string>(); // `${sectionId}|${fake week}`: one tailored assignment per section per week
    for (const dayKey of ctx.dayKeys) {
      if (taught >= DAYS) break;
      const day = parseDateKey(dayKey);
      if ((await resolveDayType(day)) !== "FULL") continue;
      taught++;
      const since = new Date();
      ctx.clock(dayKey);
      const fakeWeek = Math.floor(ctx.dayKeys.indexOf(dayKey) / 5);

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
        // R19: a class-test sheet takes no question the section had as homework / assignment in the no-repeat window (scenario 2 gave
        // out most of a small bank): look the blocked ones up once and keep them off the CT sheet.
        const ctBlocked = new Set((await ctBlockedQids({ sectionId: sec.sectionId, qids: bank.map((q) => q.qid), classToken: token, subject })).blocked);
        const itemsOf = (n: number, forCt = false): PaperItemInput[] => {
          const out: PaperItemInput[] = [];
          for (const q of ctx.pick(bank.filter((b) => !forCt || !ctBlocked.has(b.qid)), n * 3)) {
            const lo = outcomes.find((o) => q.loCodes.includes(o.code));
            const type = q.qtCode ?? lo?.questionTypeCodes?.[0];
            if (!lo || !type || !marks.has(type)) continue;
            out.push({ origin: "BANK", artifactId: q.artifactId, loCode: lo.code, questionTypeCode: type });
            if (out.length >= n) break;
          }
          return out;
        };
        const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
        const tick = async (paperId: string, by: Auth = auth) => {
          const paper = await MasteryPaper.findOne({ paperId });
          if (!paper || paper.items.length === 0) return;
          // A tailored AS paper gives each child their OWN list (Part A + their Part B): a tick lands only on an item of that list.
          const rows = ctx.pick(kids, Math.min(WRONG_CHILDREN, kids.length)).map((studentId) => {
            const own = paper.perStudentItems?.find((l) => String(l.studentId) === studentId)?.itemNos;
            const list = own && own.length > 0 ? paper.items.filter((i) => own.includes(i.itemNo)) : paper.items;
            const it = list[Math.floor(ctx.rng() * list.length)] ?? paper.items[0]!;
            return { studentId, items: [{ itemNo: it.itemNo, marks: ctx.rng() < 0.5 ? 0 : Math.max(0, it.marks / 2) }] };
          });
          if (rows.length > 0) {
            await saveResults(paperId, rows, by);
            c.wrongTicks += rows.length;
          }
          try {
            await confirmPaper(paperId, by);
            c.confirmed++;
          } catch (e) {
            c.confirmRefused++;
            ctx.refuse("confirmRefused", e);
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
        } catch (e) {
          c.cwRefused++;
          ctx.refuse("cwRefused", e);
        }
        try {
          const ctItems = itemsOf(4, true);
          const total = ctItems.reduce((t, it) => t + (marks.get(it.questionTypeCode) ?? 0), 0);
          let classTestId: string | null = null;
          if (ctItems.length > 0 && Number.isInteger(total) && total >= 1) {
            // Register the test first (an uploaded paper, no print step): a CT sheet only writes ledger rows once a test owns it.
            ctN += 1;
            const file = await StoredFile.create({
              kind: "classtest_question", mime: "application/pdf", sizeBytes: 1, originalName: `fake-ct-${ctN}.pdf`,
              driveFileId: `dev-fake-${ctx.runId}-ct-${ctN}`, uploadedBy: new Types.ObjectId(auth.userId),
            });
            const test = await createRequest({
              sectionId: sec.sectionId, subject, examDate: dayKey, totalMarks: total, source: "UPLOADED_PAPER",
              questionFileId: String(file._id), skipPrint: true, teacherId: auth.userId, actorId: auth.userId, notes: "ফেক ক্লাস টেস্ট",
            });
            classTestId = test.id;
          }
          const ct = await createPaper(
            { sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CT", date: dayKey, items: ctItems.length > 0 ? ctItems : itemsOf(4, true), ...(classTestId ? { classTestId } : {}) },
            auth,
          );
          c.ctPapers++;
          if (classTestId) c.ctLinked++;
          await tick(ct.paperId);
        } catch (e) {
          c.ctRefused++;
          ctx.refuse("ctRefused", e);
        }
        // The weekly assignment: the first fake day of each week, a subject this section has not had one on yet.
        const weekKey = `${sec.sectionId}|${fakeWeek}`;
        const asSubject = asWeek.has(weekKey)
          ? undefined
          : enabled.map((e) => e.subject as string).find((s) => teacherOf.has(s) && !asUsed.get(sec.sectionId)?.has(s));
        if (!asSubject) continue;
        asWeek.add(weekKey);
        asUsed.set(sec.sectionId, new Set([...(asUsed.get(sec.sectionId) ?? []), asSubject]));
        const asAuth = { userId: teacherOf.get(asSubject)!, role: "TEACHER" } as unknown as Auth;
        try {
          // Its own tracker item (tagged, removed with the run); the explicit `asItemId` stops the finalise from finding —
          // and editing the minutes / day split of — a real item of the copied data.
          const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
          asN += 1;
          const item = await AssignmentItem.create({
            asId: `AS-FAKE-${ctx.runId}-${asN}`, academicYearId: ctx.academicYearId, scheduleEntryId: new Types.ObjectId(), weekNumber: 800 + asN,
            cycleWeek: 1, classId: sec.classId, classLevel: sec.level, sectionId: sec.sectionId, subject: asSubject,
            teacherId: asAuth.userId, deliveryDate: new Date(y, m - 1, d), dueDate: new Date(y, m - 1, d), estMinutes: 20, status: "DRAFT",
            deliveredBy: asAuth.userId, deliveredAt: new Date(y, m - 1, d),
            // the delivery roster: `confirmAssignmentWeek` (the real issue step) turns it into the children's records
            draftRoster: kids.map((studentId) => ({ studentId: new Types.ObjectId(studentId), present: true })),
          });
          const start = await assignmentFor(sec.sectionId, asSubject as MasterySubject, dayKey, asAuth);
          const built = await buildAssignment({ sectionId: sec.sectionId, subject: asSubject as MasterySubject, dueDate: dayKey, layout: start.startingLayout, rememberLayout: false, asItemId: String(item._id) }, asAuth);
          c.gapApprovals += await approveWithReview(built.id, asAuth);
          const sent = await sendAssignment(built.id, asAuth);
          c.asSent++;
          if (sent.paperId) {
            // Issue the week through the real service (the AS paper locks: its ledger rows; the roster records are born GIVEN), then
            // the children hand it in - a paper's marks are refused for a child with no tracker record, and the confirm refuses while
            // a record is still GIVEN / DUE (§3.1 guards 1 and 2). That was the weekly assignment's "student is not on this list".
            await confirmAssignmentWeek({ academicYearId: ctx.academicYearId, sectionId: sec.sectionId, weekNumber: item.weekNumber, actorId: asAuth.userId, at: appNow() });
            const linked = (await MasteryPaper.findOne({ paperId: sent.paperId }).select("links").lean())?.links?.asItemId;
            const recs = linked ? await AssignmentStudentRecord.find({ asItemId: linked, state: "GIVEN" }).select("_id").lean() : [];
            for (const r of recs) {
              await transitionAssignmentRecord(String(r._id), "DUE", asAuth.userId, appNow());
              await transitionAssignmentRecord(String(r._id), "SUBMITTED", asAuth.userId, appNow());
            }
            await tick(sent.paperId, asAuth);
          }
        } catch (e) {
          c.asRefused++;
          ctx.refuse("asRefused", e);
        }
      }
      await ctx.tagSince(since);
    }
    return c;
  },
};
