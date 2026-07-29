/**
 * Assignment Tracker resolvers (AS-T1..AS-T5, D-#85–#89).
 *
 * RBAC — vocab is FROZEN this session (another in-flight branch owns
 * /shared/vocab.ts), so the gates compose EXISTING permissions (D-#94):
 *   - Schedule CRUD (admin): `roster:manage` — the established Principal/Office
 *     admin grant (assignClassTeacher / sectionMerge precedent). The PRD's
 *     "tracker:write admin scope" can't cover OFFICE (it holds no tracker:*),
 *     and D-#88 makes Office a first-class operator of this module.
 *   - Teacher flows (deliver/collect/check/resubmit/transition): `tracker:write`
 *     + `assertCanWrite` on the section — exactly the homework pattern. The
 *     record's/item's real section is verified server-side so scope can't be
 *     asserted on one section while mutating another.
 *   - Staff reads: `tracker:read` + `assertCanRead` (homework pattern); the
 *     schedule/expected-grid reads also admit Principal/Office without
 *     tracker:read (they are unscoped staff, assertCanRead's own rule).
 *   - Office follow-up (AS-T4): `message:dispatch` + an explicit
 *     Principal/Office role check — the follow-up IS the R-T2 manual-dispatch
 *     flow, but D-#88 rules teachers OUT of guardian chasing, and TEACHER
 *     holds message:dispatch for its own wa.me flow.
 *   - Guardian read (AS-T5): `guardian:read_child` + assertGuardianOfStudent
 *     (the GP-1 link gate) — AJ-8.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { Role, LifecycleState } from "@scd/shared";
import { dateOnlyISO } from "../assignmentCalendar";
import {
  upsertAssignmentSchedule as upsertScheduleSvc,
  addScheduleEntry as addEntrySvc,
  removeScheduleEntry as removeEntrySvc,
  updateScheduleEntryTeacher as updateEntryTeacherSvc,
  getAssignmentSchedule as getScheduleSvc,
  expectedItemsForWeek as expectedWeekSvc,
  myAssignmentPrepPrompts as prepPromptsSvc,
  declareNoAssignment as declareNoAssignmentSvc,
  removeNoAssignment as removeNoAssignmentSvc,
  type AssignmentNilDeclarationDTO,
} from "../services/AssignmentScheduleService";
import {
  deliverAssignmentItem as deliverSvc,
  updateAssignmentItem as updateAssignmentItemSvc,
  deleteAssignmentItem as deleteAssignmentItemSvc,
  type UpdateAssignmentItemResult,
  redeliverAssignmentRecord as redeliverSvc,
  sweepAssignmentChases as sweepSvc,
  transitionAssignmentRecord as transitionSvc,
  assignmentItemCounts as countsSvc,
  assignmentWeekLoad as weekLoadSvc,
  setAssignmentItemMinutes as setMinutesSvc,
  confirmAssignmentWeek as confirmWeekSvc,
  listAssignmentItems,
  listAssignmentRecords,
} from "../services/AssignmentService";
import {
  checkAssignmentRecord as checkSvc,
  issueAssignmentResubmission as resubSvc,
} from "../services/AssignmentCheckingService";
import { revertAssignmentRecord as revertAssignmentRecordSvc } from "../services/AssignmentRevertService";
import {
  listOpenAssignmentRecords as listOpenAsRecordsSvc,
  submitPass as asSubmitPassSvc,
  returnPass as asReturnPassSvc,
  recordAssignmentOutcome as recordAsOutcomeSvc,
  type AsOpenRecordDTO,
} from "../services/AssignmentRosterPassService";
import {
  assignmentChaseList as chaseListSvc,
  escalateAssignmentChase as escalateSvc,
  recordFollowUpOutcome as outcomeSvc,
  listAssignmentFollowUps as listFollowUpsSvc,
} from "../services/AssignmentFollowUpService";
import {
  assignmentSummary as summarySvc,
  childAssignments as childAssignmentsSvc,
  assignmentItemTallies,
  type AssignmentItemTally,
} from "../services/AssignmentSummaryService";
import {
  assignmentLoadReport as loadReportSvc,
  type AssignmentLoadRow,
  type AssignmentLoadReport,
} from "../services/AssignmentLoadReportService";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { AssignmentItem } from "../models/AssignmentItem";
import { Subject } from "../../foundation/models/Subject";
import { Section } from "../../foundation/models/Section";
import {
  assertCanWrite,
  assertCanRead,
  assertGuardianOfStudent,
  allowedSubjectCodesForSection,
  isClassTeacher,
  ForbiddenError,
} from "../../../middleware/authz";

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

async function assignmentItemSubjectId(itemId: string): Promise<string | undefined> {
  const item = await AssignmentItem.findById(itemId).select("subject").lean();
  return item?.subject ? resolveSubjectId(item.subject) : undefined;
}

async function assignmentRecordSubjectId(recordId: string): Promise<string | undefined> {
  const rec = await AssignmentStudentRecord.findById(recordId).select("asItemId").lean();
  return rec ? assignmentItemSubjectId(rec.asItemId.toString()) : undefined;
}

// ---------------------------------------------------------------------------
// Gate helpers (see the header note)
// ---------------------------------------------------------------------------

/** Principal/Office — the AS-T4 follow-up owner (D-#88; teachers never chase). */
function assertFollowUpAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("অ্যাসাইনমেন্ট ফলো-আপ অফিস/অধ্যক্ষের কাজ (D-#88)");
  }
}

/** Staff read of the schedule/expected grid: Principal/Office (unscoped staff)
 *  or any role holding tracker:read (TEACHER). Guardians are denied here —
 *  their surface is childAssignments. */
function assertStaffScheduleRead(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (role === "PRINCIPAL" || role === "OFFICE") return;
  if (callerHasPermission(ctx.auth, "tracker:read")) return;
  throw new ForbiddenError();
}

/** The record's REAL section must be the one write-scope was asserted on. */
async function assertRecordInSection(recordId: string, sectionId: string): Promise<void> {
  const rec = await AssignmentStudentRecord.findById(recordId).select("sectionId").lean();
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  if (rec.sectionId.toString() !== sectionId) {
    throw new ForbiddenError("Record is not in the given section");
  }
}

async function assertItemInSection(itemId: string, sectionId: string): Promise<void> {
  const item = await AssignmentItem.findById(itemId).select("sectionId").lean();
  if (!item) throw new Error("AssignmentItem not found");
  if (item.sectionId.toString() !== sectionId) {
    throw new ForbiddenError("Item is not in the given section");
  }
}

/** Item-level read gate: the item's subject must be within the caller's allowed
 *  subject codes for the section (null = unrestricted) — a subject teacher may
 *  not open another subject's per-student records/counts. */
async function assertItemSubjectReadable(
  ctx: AppContext,
  sectionId: string,
  classId: string,
  itemId: string,
): Promise<void> {
  const allowed = await allowedSubjectCodesForSection(ctx, sectionId, classId);
  if (!allowed) return;
  const item = await AssignmentItem.findById(itemId).select("subject").lean();
  if (!item || !allowed.has(item.subject)) throw new ForbiddenError();
}

/** AS-T6 weekly reconcile/confirm owner (D-#274): the section's class teacher
 *  (daily coordinator, D-#42/#45) OR a `roster:manage` holder (Principal/Office). */
async function assertCanConfirmAssignmentWeek(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (callerHasPermission(ctx.auth, "roster:manage")) return;
  const section = await Section.findById(sectionId).select("classTeacherId").lean();
  const ctId = section?.classTeacherId ? section.classTeacherId.toString() : null;
  if (!isClassTeacher(ctId, ctx.auth.userId as string)) {
    throw new ForbiddenError("Only the section's class teacher or an admin may reconcile the week (AS-T6)");
  }
}

// ---------------------------------------------------------------------------
// Object shapes
// ---------------------------------------------------------------------------

interface ScheduleEntryShape {
  id: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
}
const ScheduleEntryRef = builder.objectRef<ScheduleEntryShape>("AssignmentScheduleEntry");
ScheduleEntryRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    cycleWeek: t.exposeInt("cycleWeek"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
  }),
});

interface ScheduleShape {
  id: string;
  academicYearId: string;
  termStartDate: string;
  deliveryDayOfWeek: number;
  dueDayOfWeek: number;
  entries: ScheduleEntryShape[];
}
const ScheduleRef = builder.objectRef<ScheduleShape>("AssignmentSchedule");
ScheduleRef.implement({
  description: "The year's assignment plan: term anchor + cadence + the 4-week rotation (D-#86).",
  fields: (t) => ({
    id: t.exposeString("id"),
    academicYearId: t.exposeString("academicYearId"),
    termStartDate: t.exposeString("termStartDate"),
    deliveryDayOfWeek: t.exposeInt("deliveryDayOfWeek"),
    dueDayOfWeek: t.exposeInt("dueDayOfWeek"),
    entries: t.field({ type: [ScheduleEntryRef], resolve: (r) => r.entries }),
  }),
});

function scheduleShape(doc: {
  _id: { toString(): string };
  academicYearId: { toString(): string };
  termStartDate: Date;
  deliveryDayOfWeek: number;
  dueDayOfWeek: number;
  entries: Array<{
    _id: { toString(): string };
    cycleWeek: number;
    classId: { toString(): string };
    classLevel: number;
    sectionId: { toString(): string };
    subject: string;
    teacherId: { toString(): string };
  }>;
}): ScheduleShape {
  return {
    id: doc._id.toString(),
    academicYearId: doc.academicYearId.toString(),
    termStartDate: doc.termStartDate.toISOString(),
    deliveryDayOfWeek: doc.deliveryDayOfWeek,
    dueDayOfWeek: doc.dueDayOfWeek,
    entries: doc.entries.map((e) => ({
      id: e._id.toString(),
      cycleWeek: e.cycleWeek,
      classId: e.classId.toString(),
      classLevel: e.classLevel,
      sectionId: e.sectionId.toString(),
      subject: e.subject,
      teacherId: e.teacherId.toString(),
    })),
  };
}

interface ExpectedItemShape {
  entryId: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
  delivered: boolean;
  /** AS-T6: null (no item) | "DRAFT" (delivered, awaiting weekly confirm) | "ISSUED". */
  status: string | null;
  asItemId: string | null;
  asId: string | null;
  estMinutes: number | null;
  totalMarks: number | null;
  nilDeclared: boolean;
  nilReason: string | null;
  nilDeclarationId: string | null;
}
const ExpectedItemRef = builder.objectRef<ExpectedItemShape>("ExpectedAssignmentItem");
ExpectedItemRef.implement({
  fields: (t) => ({
    entryId: t.exposeString("entryId"),
    cycleWeek: t.exposeInt("cycleWeek"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
    delivered: t.exposeBoolean("delivered"),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    asItemId: t.string({ nullable: true, resolve: (r) => r.asItemId }),
    asId: t.string({ nullable: true, resolve: (r) => r.asId }),
    estMinutes: t.int({ nullable: true, resolve: (r) => r.estMinutes }),
    totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
    nilDeclared: t.exposeBoolean("nilDeclared"),
    nilReason: t.string({ nullable: true, resolve: (r) => r.nilReason }),
    nilDeclarationId: t.string({ nullable: true, resolve: (r) => r.nilDeclarationId }),
  }),
});

const AssignmentNilDeclarationRef = builder.objectRef<AssignmentNilDeclarationDTO>("AssignmentNilDeclaration");
AssignmentNilDeclarationRef.implement({
  description: "Explicit 'no assignment this week' declaration for one scheduled assignment cell.",
  fields: (t) => ({
    id: t.exposeString("id"),
    academicYearId: t.exposeString("academicYearId"),
    weekNumber: t.exposeInt("weekNumber"),
    cycleWeek: t.exposeInt("cycleWeek"),
    weekStartKey: t.exposeString("weekStartKey"),
    deliveryDateKey: t.exposeString("deliveryDateKey"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
    reason: t.exposeString("reason"),
    declaredBy: t.exposeString("declaredBy"),
  }),
});

interface ExpectedWeekShape {
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStart: string;
  year: number;
  month: number;
  weekOfMonth: number;
  suspended: boolean;
  deliveryDate: string | null;
  dueDate: string | null;
  items: ExpectedItemShape[];
}
const ExpectedWeekRef = builder.objectRef<ExpectedWeekShape>("ExpectedAssignmentWeek");
ExpectedWeekRef.implement({
  description: "Week N of the computed grid: calendar-month week label + §4-rolled dates + delivered join (D-#275).",
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    weekNumber: t.exposeInt("weekNumber"),
    cycleWeek: t.exposeInt("cycleWeek"),
    weekStart: t.exposeString("weekStart"),
    year: t.exposeInt("year"),
    month: t.exposeInt("month"),
    weekOfMonth: t.exposeInt("weekOfMonth"),
    suspended: t.exposeBoolean("suspended"),
    deliveryDate: t.string({ nullable: true, resolve: (r) => r.deliveryDate }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    items: t.field({ type: [ExpectedItemRef], resolve: (r) => r.items }),
  }),
});

interface PrepPromptShape {
  entryId: string;
  weekNumber: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  deliveryDate: string;
  dueDate: string;
}
const PrepPromptRef = builder.objectRef<PrepPromptShape>("AssignmentPrepPrompt");
PrepPromptRef.implement({
  description: "D-#89 Sunday/Monday teacher prep prompt — expected, not yet delivered.",
  fields: (t) => ({
    entryId: t.exposeString("entryId"),
    weekNumber: t.exposeInt("weekNumber"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    deliveryDate: t.exposeString("deliveryDate"),
    dueDate: t.exposeString("dueDate"),
  }),
});

interface DeliverResultShape {
  itemId: string;
  asId: string;
  weekNumber: number;
  subject: string;
  deliveryDate: string;
  dueDate: string;
  status: string;
  estMinutes: number;
  presentCount: number;
  absentCount: number;
}
const DeliverResultRef = builder.objectRef<DeliverResultShape>("DeliverAssignmentResult");
DeliverResultRef.implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    asId: t.exposeString("asId"),
    weekNumber: t.exposeInt("weekNumber"),
    subject: t.exposeString("subject"),
    deliveryDate: t.exposeString("deliveryDate"),
    dueDate: t.exposeString("dueDate"),
    status: t.exposeString("status"),
    estMinutes: t.exposeInt("estMinutes"),
    presentCount: t.exposeInt("presentCount"),
    absentCount: t.exposeInt("absentCount"),
  }),
});

interface AsTransitionShape {
  recordId: string;
  asId: string;
  state: string;
  chaseCount: number;
  dueDate: string | null;
}
const AsTransitionRef = builder.objectRef<AsTransitionShape>("AssignmentTransitionResult");
AsTransitionRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    state: t.exposeString("state"),
    chaseCount: t.exposeInt("chaseCount"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
  }),
});

interface ItemShape {
  id: string;
  asId: string;
  weekNumber: number;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
  deliveryDate: string;
  dueDate: string;
  setId: string | null;
  totalMarks: number | null;
}
const ItemRef = builder.objectRef<ItemShape>("AssignmentItem");
ItemRef.implement({
  description: "Layer-A assignment item — one per realized (week × section × subject).",
  fields: (t) => ({
    id: t.exposeString("id"),
    asId: t.exposeString("asId"),
    weekNumber: t.exposeInt("weekNumber"),
    cycleWeek: t.exposeInt("cycleWeek"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
    deliveryDate: t.exposeString("deliveryDate"),
    dueDate: t.exposeString("dueDate"),
    setId: t.string({ nullable: true, resolve: (r) => r.setId }),
    totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
  }),
});

interface AsStampShape {
  state: string;
  at: string;
}
const AsStampRef = builder.objectRef<AsStampShape>("AssignmentStateStamp");
AsStampRef.implement({
  fields: (t) => ({
    state: t.exposeString("state"),
    at: t.exposeString("at"),
  }),
});

interface AsRecordShape {
  id: string;
  asId: string;
  studentId: string;
  state: string;
  stateDates: AsStampShape[];
  dueDate: string | null;
  chaseCount: number;
  result: string | null;
  marks: number | null;
  feedback: string | null;
  resubOf: string | null;
}
const AsRecordRef = builder.objectRef<AsRecordShape>("AssignmentStudentRecord");
AsRecordRef.implement({
  description: "Layer-B per-student lifecycle record (shared engine, D-#37). Identity-bearing, operational plane.",
  fields: (t) => ({
    id: t.exposeString("id"),
    asId: t.exposeString("asId"),
    studentId: t.exposeString("studentId"),
    state: t.exposeString("state"),
    stateDates: t.field({ type: [AsStampRef], resolve: (r) => r.stateDates }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    chaseCount: t.exposeInt("chaseCount"),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
    resubOf: t.string({ nullable: true, resolve: (r) => r.resubOf }),
  }),
});

interface CountsShape {
  itemId: string;
  asId: string;
  rosterCount: number;
  deliveredCount: number;
  notReceivedCount: number;
  submittedCount: number;
  missingStudentIds: string[];
}
const CountsRef = builder.objectRef<CountsShape>("AssignmentItemCounts");
CountsRef.implement({
  description: "Derived counts — computed from per-student records, never typed (PRD §1).",
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    asId: t.exposeString("asId"),
    rosterCount: t.exposeInt("rosterCount"),
    deliveredCount: t.exposeInt("deliveredCount"),
    notReceivedCount: t.exposeInt("notReceivedCount"),
    submittedCount: t.exposeInt("submittedCount"),
    missingStudentIds: t.field({ type: ["String"], resolve: (r) => r.missingStudentIds }),
  }),
});

interface CheckResultShape {
  recordId: string;
  asId: string;
  state: string;
  result: string;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
}
const CheckResultRef = builder.objectRef<CheckResultShape>("CheckAssignmentResult");
CheckResultRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    state: t.exposeString("state"),
    result: t.exposeString("result"),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
  }),
});

interface ResubResultShape {
  originalRecordId: string;
  originalState: string;
  recordId: string;
  asId: string;
  state: string;
  resubOf: string;
  dueDate: string | null;
}
const ResubResultRef = builder.objectRef<ResubResultShape>("AssignmentResubmissionResult");
ResubResultRef.implement({
  description: "Teacher-explicit resubmission (D-#87): new record, same AS_ID, fresh pass.",
  fields: (t) => ({
    originalRecordId: t.exposeString("originalRecordId"),
    originalState: t.exposeString("originalState"),
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    state: t.exposeString("state"),
    resubOf: t.exposeString("resubOf"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
  }),
});

interface ChaseEntryShape {
  recordId: string;
  asItemId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  studentId: string;
  studentName: string;
  guardianPhone: string | null;
  sectionId: string;
  classId: string;
  dueDate: string | null;
  daysOverdue: number;
  chaseCount: number;
  followUpCount: number;
  nextStepNumber: number;
}
const ChaseEntryRef = builder.objectRef<ChaseEntryShape>("AssignmentChaseEntry");
ChaseEntryRef.implement({
  description: "Office chase list: every CHASE record + student + guardian contact + days overdue (AS-T4).",
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    weekNumber: t.exposeInt("weekNumber"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    guardianPhone: t.string({ nullable: true, resolve: (r) => r.guardianPhone }),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    daysOverdue: t.exposeInt("daysOverdue"),
    chaseCount: t.exposeInt("chaseCount"),
    followUpCount: t.exposeInt("followUpCount"),
    nextStepNumber: t.exposeInt("nextStepNumber"),
  }),
});

interface EscalateResultShape {
  followUpId: string;
  recordId: string;
  stepNumber: number;
  step: string;
  sentStatus: string;
  messageBn: string;
  waLink: string | null;
  notifiedGuardianIds: string[];
}
const EscalateResultRef = builder.objectRef<EscalateResultShape>("AssignmentEscalateResult");
EscalateResultRef.implement({
  fields: (t) => ({
    followUpId: t.exposeString("followUpId"),
    recordId: t.exposeString("recordId"),
    stepNumber: t.exposeInt("stepNumber"),
    step: t.exposeString("step"),
    sentStatus: t.exposeString("sentStatus"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    notifiedGuardianIds: t.field({ type: ["String"], resolve: (r) => r.notifiedGuardianIds }),
  }),
});

interface FollowUpShape {
  id: string;
  recordId: string;
  asId: string;
  studentId: string;
  stepNumber: number;
  step: string;
  messageBn: string;
  waLink: string | null;
  sentStatus: string;
  outcome: string | null;
  followUpDate: string;
  sentAt: string | null;
}
const FollowUpRef = builder.objectRef<FollowUpShape>("AssignmentFollowUp");
FollowUpRef.implement({
  description: "Append-only escalation-ladder row (ADR-008).",
  fields: (t) => ({
    id: t.exposeString("id"),
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    studentId: t.exposeString("studentId"),
    stepNumber: t.exposeInt("stepNumber"),
    step: t.exposeString("step"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    sentStatus: t.exposeString("sentStatus"),
    outcome: t.string({ nullable: true, resolve: (r) => r.outcome }),
    followUpDate: t.exposeString("followUpDate"),
    sentAt: t.string({ nullable: true, resolve: (r) => r.sentAt }),
  }),
});

interface RateRowShape {
  key: string;
  scheduled: number;
  delivered: number;
  deliveryRatePct: number | null;
}
const RateRowRef = builder.objectRef<RateRowShape>("AssignmentRateRow");
RateRowRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    scheduled: t.exposeInt("scheduled"),
    delivered: t.exposeInt("delivered"),
    deliveryRatePct: t.int({ nullable: true, resolve: (r) => r.deliveryRatePct }),
  }),
});

interface SummaryShape {
  academicYearId: string;
  weekFrom: number;
  weekTo: number;
  scheduledTotal: number;
  deliveredTotal: number;
  suspendedWeeks: number[];
  byTeacher: RateRowShape[];
  byClass: RateRowShape[];
  byWeek: RateRowShape[];
  submissionRatePct: number | null;
  chaseVolume: number;
  attentionStudentIds: string[];
  commsPromptStudentIds: string[];
  openResubmissions: number;
  avgCheckingLatencyDays: number | null;
}
const SummaryRef = builder.objectRef<SummaryShape>("AssignmentSummary");
SummaryRef.implement({
  description: "AS-T5 roll-up: delivery/submission rates (suspended weeks excluded), chase volume, latency, D-#34 thresholds.",
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    weekFrom: t.exposeInt("weekFrom"),
    weekTo: t.exposeInt("weekTo"),
    scheduledTotal: t.exposeInt("scheduledTotal"),
    deliveredTotal: t.exposeInt("deliveredTotal"),
    suspendedWeeks: t.field({ type: ["Int"], resolve: (r) => r.suspendedWeeks }),
    byTeacher: t.field({ type: [RateRowRef], resolve: (r) => r.byTeacher }),
    byClass: t.field({ type: [RateRowRef], resolve: (r) => r.byClass }),
    byWeek: t.field({ type: [RateRowRef], resolve: (r) => r.byWeek }),
    submissionRatePct: t.int({ nullable: true, resolve: (r) => r.submissionRatePct }),
    chaseVolume: t.exposeInt("chaseVolume"),
    attentionStudentIds: t.field({ type: ["String"], resolve: (r) => r.attentionStudentIds }),
    commsPromptStudentIds: t.field({ type: ["String"], resolve: (r) => r.commsPromptStudentIds }),
    openResubmissions: t.exposeInt("openResubmissions"),
    avgCheckingLatencyDays: t.float({ nullable: true, resolve: (r) => r.avgCheckingLatencyDays }),
  }),
});

interface ChildAssignmentShape {
  recordId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  state: string;
  pending: boolean;
  daysLate: number;
  deliveryDate: string;
  dueDate: string | null;
  marks: number | null;
  totalMarks: number | null;
  result: string | null;
  feedback: string | null;
  isResubmission: boolean;
  /** Delivery-pass attachments on the item (≤5, D-#298) — empty when none. */
  attachmentIds?: string[];
}
const ChildAssignmentRef = builder.objectRef<ChildAssignmentShape>("ChildAssignment");
ChildAssignmentRef.implement({
  description: "Guardian-read view of one child's assignment record (AJ-8). Link-gated.",
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    weekNumber: t.exposeInt("weekNumber"),
    state: t.exposeString("state"),
    pending: t.exposeBoolean("pending"),
    daysLate: t.exposeInt("daysLate"),
    deliveryDate: t.exposeString("deliveryDate"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
    isResubmission: t.exposeBoolean("isResubmission"),
    attachmentIds: t.field({ type: ["String"], resolve: (r) => r.attachmentIds ?? [] }),
  }),
});

const DeliveryRosterInput = builder.inputType("AssignmentRosterEntryInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    present: t.boolean({ required: true }),
  }),
});

// ===========================================================================
// AS-T1 — schedule CRUD (admin) + expected grid + prep prompts
// ===========================================================================

builder.mutationField("upsertAssignmentSchedule", (t) =>
  t.field({
    type: ScheduleRef,
    description: "Set the year's term anchor + cadence weekdays (Principal/Office, D-#86).",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      termStartDate: t.arg.string({ required: true }),
      deliveryDayOfWeek: t.arg.int({ required: false }),
      dueDayOfWeek: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await upsertScheduleSvc({
        academicYearId: args.academicYearId,
        termStartDate: args.termStartDate,
        deliveryDayOfWeek: args.deliveryDayOfWeek ?? undefined,
        dueDayOfWeek: args.dueDayOfWeek ?? undefined,
      });
      return scheduleShape(doc as never);
    },
  }),
);

builder.mutationField("addAssignmentScheduleEntry", (t) =>
  t.field({
    type: ScheduleRef,
    description: "Add one rotation cell (cycleWeek × section × subject → teacher).",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      cycleWeek: t.arg.int({ required: true }),
      classId: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await addEntrySvc({
        academicYearId: args.academicYearId,
        cycleWeek: args.cycleWeek,
        classId: args.classId,
        classLevel: args.classLevel,
        sectionId: args.sectionId,
        subject: args.subject,
        teacherId: args.teacherId,
      });
      return scheduleShape(doc as never);
    },
  }),
);

builder.mutationField("removeAssignmentScheduleEntry", (t) =>
  t.field({
    type: ScheduleRef,
    description: "Remove one rotation cell.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      entryId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await removeEntrySvc(args.academicYearId, args.entryId);
      return scheduleShape(doc as never);
    },
  }),
);

builder.mutationField("updateAssignmentScheduleEntryTeacher", (t) =>
  t.field({
    type: ScheduleRef,
    description: "Reassign the teacher on one rotation cell (D-#328) — only the teacher changes.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      entryId: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await updateEntryTeacherSvc(args.academicYearId, args.entryId, args.teacherId);
      return scheduleShape(doc as never);
    },
  }),
);

const AssignmentLoadRowRef = builder.objectRef<AssignmentLoadRow>("AssignmentLoadRow").implement({
  description: "Planned (rotation) vs delivered/issued assignments for one subject or teacher (D-#329).",
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    planned: t.exposeInt("planned"),
    delivered: t.exposeInt("delivered"),
    issued: t.exposeInt("issued"),
  }),
});

const AssignmentLoadReportRef = builder.objectRef<AssignmentLoadReport>("AssignmentLoadReport").implement({
  description: "Assignment load: planned vs given, broken down by subject and by teacher (Principal/Office).",
  fields: (t) => ({
    bySubject: t.field({ type: [AssignmentLoadRowRef], resolve: (r) => r.bySubject }),
    byTeacher: t.field({ type: [AssignmentLoadRowRef], resolve: (r) => r.byTeacher }),
  }),
});

builder.queryField("assignmentLoadReport", (t) =>
  t.field({
    type: AssignmentLoadReportRef,
    description:
      "D-#329: assignments PLANNED (rotation cells) vs GIVEN (delivered items, all weeks; issued of those), " +
      "by subject and by teacher. Principal/Office (roster:manage).",
    authScopes: { hasPermission: "roster:manage" },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return loadReportSvc(args.academicYearId);
    },
  }),
);

builder.queryField("assignmentSchedule", (t) =>
  t.field({
    type: ScheduleRef,
    nullable: true,
    description: "The year's assignment schedule (staff read).",
    authScopes: { authenticated: true },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffScheduleRead(ctx);
      const doc = await getScheduleSvc(args.academicYearId);
      return doc ? scheduleShape(doc as never) : null;
    },
  }),
);

builder.queryField("expectedAssignmentsForWeek", (t) =>
  t.field({
    type: ExpectedWeekRef,
    description: "Week N of the computed grid: §4-rolled dates + delivered join (staff read).",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertStaffScheduleRead(ctx);
      return expectedWeekSvc(args.academicYearId, args.weekNumber);
    },
  }),
);

builder.queryField("myAssignmentPrepPrompts", (t) =>
  t.field({
    type: [PrepPromptRef],
    description: "D-#89 Sunday/Monday prep prompts for the calling teacher (empty other days).",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      date: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return prepPromptsSvc(
        args.academicYearId,
        ctx.auth.userId as string,
        args.date ? new Date(args.date) : undefined,
      );
    },
  }),
);

builder.mutationField("declareNoAssignment", (t) =>
  t.field({
    type: AssignmentNilDeclarationRef,
    description:
      "Declare an expected assignment cell as deliberately none for the week. Clears prep/report pending rows.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
      entryId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const schedule = await AssignmentSchedule.findOne({ academicYearId: args.academicYearId });
      const entry = schedule?.entries.id(args.entryId);
      await assertCanWrite(
        ctx,
        args.sectionId,
        entry?.subject ? await resolveSubjectId(entry.subject) : undefined,
      );
      return declareNoAssignmentSvc({
        academicYearId: args.academicYearId,
        weekNumber: args.weekNumber,
        entryId: args.entryId,
        sectionId: args.sectionId,
        reason: args.reason,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("removeNoAssignment", (t) =>
  t.field({
    type: "Boolean",
    description: "Remove an explicit 'no assignment' declaration for one expected assignment cell.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
      entryId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const schedule = await AssignmentSchedule.findOne({ academicYearId: args.academicYearId });
      const entry = schedule?.entries.id(args.entryId);
      await assertCanWrite(
        ctx,
        args.sectionId,
        entry?.subject ? await resolveSubjectId(entry.subject) : undefined,
      );
      return removeNoAssignmentSvc({
        academicYearId: args.academicYearId,
        weekNumber: args.weekNumber,
        entryId: args.entryId,
        sectionId: args.sectionId,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ===========================================================================
// AS-T2 — delivery + collection (teacher write-scope)
// ===========================================================================

const UpdateAssignmentResultRef = builder
  .objectRef<UpdateAssignmentItemResult>("UpdateAssignmentItemResult")
  .implement({
    description: "A delivered assignment after a tiered edit (D-#353).",
    fields: (t) => ({
      itemId: t.exposeString("itemId"),
      asId: t.exposeString("asId"),
      weekNumber: t.exposeInt("weekNumber"),
      subject: t.exposeString("subject"),
      status: t.exposeString("status"),
      estMinutes: t.exposeInt("estMinutes"),
      totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
      deliveryDate: t.exposeString("deliveryDate"),
      dueDate: t.exposeString("dueDate"),
    }),
  });

/** Load the item's real section so write-scope is asserted on IT, never on a
 *  client-supplied one (the module header's rule). */
async function assertCanWriteOnItem(ctx: AppContext, itemId: string) {
  const item = await AssignmentItem.findById(itemId).select("sectionId subject").lean();
  if (!item) throw new Error("AssignmentItem not found");
  await assertCanWrite(ctx, item.sectionId.toString(), await resolveSubjectId(item.subject));
}

builder.mutationField("updateAssignmentItem", (t) =>
  t.field({
    type: UpdateAssignmentResultRef,
    description:
      "Edit a delivered assignment (D-#353). DRAFT: estMinutes/totalMarks/setId/attachments. " +
      "ISSUED: descriptive only — estMinutes is FROZEN (weekly load already confirmed) and the " +
      "§4-resolved delivery/due dates are never editable. Own cell, or Principal/Office.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      itemId: t.arg.string({ required: true }),
      estMinutes: t.arg.int({ required: false }),
      totalMarks: t.arg.int({ required: false }),
      setId: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWriteOnItem(ctx, args.itemId);
      return updateAssignmentItemSvc({
        itemId: args.itemId,
        estMinutes: args.estMinutes ?? undefined,
        totalMarks: args.totalMarks ?? undefined,
        setId: args.setId ?? undefined,
        attachmentIds: args.attachmentIds ? [...args.attachmentIds] : undefined,
        actorId: ctx.auth.userId as string,
        isAdmin: ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE",
      });
    },
  }),
);

builder.mutationField("deleteAssignmentItem", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Delete a still-DRAFT delivered assignment (D-#353) — the fix path for a mistaken delivery. " +
      "ISSUED is refused (student records exist). Own cell, or Principal/Office.",
    authScopes: { hasPermission: "tracker:write" },
    args: { itemId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWriteOnItem(ctx, args.itemId);
      await deleteAssignmentItemSvc({
        itemId: args.itemId,
        actorId: ctx.auth.userId as string,
        isAdmin: ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE",
      });
      return true;
    },
  }),
);

builder.mutationField("deliverAssignment", (t) =>
  t.field({
    type: DeliverResultRef,
    description:
      "The delivery pass (AJ-3, AS-T6): DRAFT the item (dates §4-resolved server-side) + store the " +
      "present/absent roster + estMinutes. Per-student records are issued later by confirmAssignmentWeek. " +
      "Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
      entryId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      roster: t.arg({ type: [DeliveryRosterInput], required: true }),
      setId: t.arg.string({ required: false }),
      totalMarks: t.arg.int({ required: false }),
      estMinutes: t.arg.int({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const schedule = await AssignmentSchedule.findOne({ academicYearId: args.academicYearId });
      const entry = schedule?.entries.id(args.entryId);
      await assertCanWrite(
        ctx,
        args.sectionId,
        entry?.subject ? await resolveSubjectId(entry.subject) : undefined,
      );
      return deliverSvc({
        academicYearId: args.academicYearId,
        weekNumber: args.weekNumber,
        entryId: args.entryId,
        sectionId: args.sectionId, // service verifies it matches the entry
        roster: args.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
        setId: args.setId ?? undefined,
        totalMarks: args.totalMarks ?? undefined,
        estMinutes: args.estMinutes ?? undefined,
        attachmentIds: args.attachmentIds ? [...args.attachmentIds] : undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ===========================================================================
// AS-T6 — weekly load ceiling: reconcile read + trim + confirm gate (D-#274)
// ===========================================================================

interface WeekLoadItemShape {
  itemId: string;
  asId: string;
  subject: string;
  estMinutes: number;
  status: string;
}
const WeekLoadItemRef = builder.objectRef<WeekLoadItemShape>("AssignmentWeekLoadItem");
WeekLoadItemRef.implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    estMinutes: t.exposeInt("estMinutes"),
    status: t.exposeString("status"),
  }),
});

interface WeekLoadShape {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  totalMinutes: number;
  draftMinutes: number;
  overBy: number;
  withinCeiling: boolean;
  hasDrafts: boolean;
  items: WeekLoadItemShape[];
}
const WeekLoadRef = builder.objectRef<WeekLoadShape>("AssignmentWeekLoad");
WeekLoadRef.implement({
  description: "AS-T6 reconcile read: the section's week, per-subject minutes vs the 360 ceiling.",
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    sectionId: t.exposeString("sectionId"),
    weekNumber: t.exposeInt("weekNumber"),
    ceiling: t.exposeInt("ceiling"),
    totalMinutes: t.exposeInt("totalMinutes"),
    draftMinutes: t.exposeInt("draftMinutes"),
    overBy: t.exposeInt("overBy"),
    withinCeiling: t.exposeBoolean("withinCeiling"),
    hasDrafts: t.exposeBoolean("hasDrafts"),
    items: t.field({ type: [WeekLoadItemRef], resolve: (r) => r.items }),
  }),
});

builder.queryField("assignmentWeekLoad", (t) =>
  t.field({
    type: WeekLoadRef,
    description: "AS-T6: the section's weekly assignment load vs the 360-min ceiling (reconcile view).",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const section = await Section.findById(args.sectionId).select("classId").lean();
      if (!section) throw new Error("Section not found");
      // The reconcile owner (section class teacher / roster:manage) may read the
      // week load even without a teaching scope on its subjects; otherwise fall
      // back to the section teaching-scope read (the delivering subject teachers).
      try {
        await assertCanConfirmAssignmentWeek(ctx, args.sectionId);
      } catch {
        await assertCanRead(ctx, args.sectionId, section.classId.toString());
      }
      return weekLoadSvc(args.academicYearId, args.sectionId, args.weekNumber);
    },
  }),
);

interface SetMinutesShape {
  itemId: string;
  estMinutes: number;
}
const SetMinutesRef = builder.objectRef<SetMinutesShape>("AssignmentItemMinutesResult");
SetMinutesRef.implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    estMinutes: t.exposeInt("estMinutes"),
  }),
});

builder.mutationField("setAssignmentItemMinutes", (t) =>
  t.field({
    type: SetMinutesRef,
    description: "AS-T6: trim a DRAFT assignment's declared minutes (class teacher / roster:manage).",
    authScopes: { authenticated: true },
    args: {
      itemId: t.arg.string({ required: true }),
      estMinutes: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const item = await AssignmentItem.findById(args.itemId).select("sectionId").lean();
      if (!item) throw new Error("AssignmentItem not found");
      await assertCanConfirmAssignmentWeek(ctx, item.sectionId.toString());
      return setMinutesSvc(args.itemId, args.estMinutes);
    },
  }),
);

const ConfirmWeekRef = builder
  .objectRef<{
    academicYearId: string;
    sectionId: string;
    weekNumber: number;
    ceiling: number;
    totalMinutes: number;
    itemsIssued: number;
    recordsIssued: number;
  }>("ConfirmAssignmentWeekResult")
  .implement({
    fields: (t) => ({
      academicYearId: t.exposeString("academicYearId"),
      sectionId: t.exposeString("sectionId"),
      weekNumber: t.exposeInt("weekNumber"),
      ceiling: t.exposeInt("ceiling"),
      totalMinutes: t.exposeInt("totalMinutes"),
      itemsIssued: t.exposeInt("itemsIssued"),
      recordsIssued: t.exposeInt("recordsIssued"),
    }),
  });

builder.mutationField("confirmAssignmentWeek", (t) =>
  t.field({
    type: ConfirmWeekRef,
    description:
      "AS-T6 gate: confirm a section's week — HARD-BLOCKS if Σ estMinutes > 360, else issues every " +
      "DRAFT item's per-student records and flips them ISSUED. Class teacher / roster:manage.",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      weekNumber: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanConfirmAssignmentWeek(ctx, args.sectionId);
      return confirmWeekSvc({
        academicYearId: args.academicYearId,
        sectionId: args.sectionId,
        weekNumber: args.weekNumber,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("redeliverAssignmentRecord", (t) =>
  t.field({
    type: AsTransitionRef,
    description: "Absent student receives later: ABSENT_REDELIVER → GIVEN, item-wide due date kept.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      await assertRecordInSection(args.recordId, args.sectionId);
      return redeliverSvc(args.recordId, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("transitionAssignmentRecord", (t) =>
  t.field({
    type: AsTransitionRef,
    description: "One legal shared-engine transition (e.g. CHECKED→RETURNED). Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
      toState: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      await assertRecordInSection(args.recordId, args.sectionId);
      return transitionSvc(args.recordId, args.toState, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("sweepAssignmentChases", (t) =>
  t.field({
    type: "Int",
    description: "Move every past-due DUE record to CHASE (Office/Principal). Returns how many flipped.",
    authScopes: { hasPermission: "message:dispatch" },
    args: { itemId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertFollowUpAdmin(ctx); // D-#88 — Office owns the chase pipeline
      return sweepSvc(new Date(), args.itemId ?? undefined);
    },
  }),
);

builder.queryField("assignmentItems", (t) =>
  t.field({
    type: [ItemRef],
    description: "Delivered assignment items for a section. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: false }),
      weekNumber: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      const allowed = await allowedSubjectCodesForSection(ctx, args.sectionId, args.classId);
      const all = await listAssignmentItems({
        academicYearId: args.academicYearId ?? undefined,
        sectionId: args.sectionId,
        weekNumber: args.weekNumber ?? undefined,
      });
      const docs = allowed ? all.filter((d) => allowed.has(d.subject)) : all;
      return docs.map((d) => ({
        id: d._id.toString(),
        asId: d.asId,
        weekNumber: d.weekNumber,
        cycleWeek: d.cycleWeek,
        classId: d.classId.toString(),
        classLevel: d.classLevel,
        sectionId: d.sectionId.toString(),
        subject: d.subject,
        teacherId: d.teacherId.toString(),
        deliveryDate: dateOnlyISO(new Date(d.deliveryDate)),
        dueDate: dateOnlyISO(new Date(d.dueDate)),
        setId: d.setId ? d.setId.toString() : null,
        totalMarks: d.totalMarks ?? null,
      }));
    },
  }),
);

builder.queryField("assignmentRecords", (t) =>
  t.field({
    type: [AsRecordRef],
    description: "Per-student lifecycle records for an item. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      await assertItemSubjectReadable(ctx, args.sectionId, args.classId, args.itemId);
      const docs = await listAssignmentRecords(args.itemId);
      return docs.map((d) => ({
        id: d._id.toString(),
        asId: d.asId,
        studentId: d.studentId.toString(),
        state: d.state,
        stateDates: (d.stateDates ?? []).map((s) => ({
          state: s.state,
          at: new Date(s.at).toISOString(),
        })),
        dueDate: d.dueDate ? dateOnlyISO(new Date(d.dueDate)) : null,
        chaseCount: d.chaseCount,
        result: d.result ?? null,
        marks: d.marks ?? null,
        feedback: d.feedback ?? null,
        resubOf: d.resubOf ? d.resubOf.toString() : null,
      }));
    },
  }),
);

builder.queryField("assignmentItemCounts", (t) =>
  t.field({
    type: CountsRef,
    description: "Derived item counts + missing list (never typed, PRD §1). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      await assertItemSubjectReadable(ctx, args.sectionId, args.classId, args.itemId);
      return countsSvc(args.itemId);
    },
  }),
);

// ===========================================================================
// AS-T3 — checking + teacher-optional resubmission
// ===========================================================================

// Mutation: revertAssignmentRecord (D-#338 — undo the last lifecycle action) -------

interface AsRevertResultShape {
  recordId: string;
  asId: string;
  state: string;
  poppedStates: string[];
  chaseCount: number;
  result: string | null;
  marks: number | null;
  feedback: string | null;
  deletedResubmissionId: string | null;
}

const AsRevertResultRef = builder.objectRef<AsRevertResultShape>("AsRevertResult");
AsRevertResultRef.implement({
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    asId: t.exposeString("asId"),
    state: t.exposeString("state"),
    poppedStates: t.stringList({ resolve: (r) => r.poppedStates }),
    chaseCount: t.exposeInt("chaseCount"),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
    deletedResubmissionId: t.string({ nullable: true, resolve: (r) => r.deletedResubmissionId }),
  }),
});

builder.mutationField("revertAssignmentRecord", (t) =>
  t.field({
    type: AsRevertResultRef,
    description:
      "Undo the last lifecycle ACTION on an assignment record (D-#338): pops the trailing " +
      "same-timestamp stamp group and restores the previous state (untouched spawned resubmission " +
      "deleted; result/marks/feedback cleared on a CHECKED pop; chaseCount decremented). Acting " +
      "teacher: own action, same Dhaka day; Principal/Office: anytime.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
      const admin = ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE";
      await assertRecordInSection(args.recordId, args.sectionId);
      if (!admin) {
        await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      }
      return revertAssignmentRecordSvc({
        recordId: args.recordId,
        actorId: ctx.auth.userId as string,
        admin,
      });
    },
  }),
);

builder.mutationField("checkAssignmentRecord", (t) =>
  t.field({
    type: CheckResultRef,
    description:
      "Check a submitted record (AJ-5): result + optional marks (≤ totalMarks) + feedback. " +
      "NOTHING auto-spawns (D-#87). Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
      result: t.arg.string({ required: true }),
      marks: t.arg.int({ required: false }),
      feedback: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      await assertRecordInSection(args.recordId, args.sectionId);
      return checkSvc({
        recordId: args.recordId,
        result: args.result,
        marks: args.marks ?? undefined,
        feedback: args.feedback ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ===========================================================================
// RP-3 (D-#356) — the roster-pass parity: a section-wide read + the two passes
// + the individual outcome (marks + feedback, no auto-spawn).
// ===========================================================================

const AsOpenRecordRef = builder.objectRef<AsOpenRecordDTO>("AssignmentOpenRecord");
AsOpenRecordRef.implement({
  description:
    "A section's open assignment record across all weeks, enriched with the item's subject/dates " +
    "and the student's name — the row the roster-pass workspace renders (RP-3, D-#356).",
  fields: (t) => ({
    id: t.exposeString("id"),
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    deliveryDate: t.string({ nullable: true, resolve: (r) => r.deliveryDate }),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    state: t.exposeString("state"),
    chaseCount: t.exposeInt("chaseCount"),
    result: t.string({ nullable: true, resolve: (r) => r.result }),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.int({ nullable: true, resolve: (r) => r.totalMarks }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
    resubOf: t.string({ nullable: true, resolve: (r) => r.resubOf }),
    stampCount: t.exposeInt("stampCount"),
    lastStateAt: t.exposeString("lastStateAt"),
  }),
});

builder.queryField("assignmentOpenRecords", (t) =>
  t.field({
    type: [AsOpenRecordRef],
    description:
      "All of a section's assignment records in the given states, across all weeks (newest delivery-date " +
      "first), for the roster-pass workspace (RP-3). Read-scope + per-item subject-readability enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      states: t.arg({ type: ["String"], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      const rows = await listOpenAsRecordsSvc(args.sectionId, args.states as LifecycleState[]);
      // Per-item subject-readability: drop items the caller may not open (a
      // subject teacher never sees another subject's records — mirrors
      // assignmentRecords' assertItemSubjectReadable, applied set-wise).
      // D-#388 (owner, 2026-07-29): the class teacher sees the whole section again —
      // the workspace FOLDS other subjects away read-only rather than hiding them.
      // D-#386 had narrowed this to match homework; D-#388 moves both back together.
      // Writes stay grant-scoped in assertCanWrite, which no fold can bypass.
      const allowed = await allowedSubjectCodesForSection(ctx, args.sectionId, args.classId);
      return allowed ? rows.filter((r) => allowed.has(r.subject)) : rows;
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: assignmentItemTallies (D-#383 — twin of homeworkItemTallies)
// ---------------------------------------------------------------------------

const AsItemTallyRef = builder.objectRef<AssignmentItemTally>("AssignmentItemTally");
AsItemTallyRef.implement({
  description:
    "Per-item lifecycle tally for a section's assignment cards. submitted/checked/returned are " +
    "CUMULATIVE (a returned student still counts as submitted); pendingSubmission/absent are " +
    "current-state. Needed because the workspace fetches only OPEN rows and drops RETURNED ones " +
    "older than today, leaving a finished card with nothing but its absentees to show.",
  fields: (t) => ({
    asItemId: t.exposeString("asItemId"),
    total: t.exposeInt("total"),
    submitted: t.exposeInt("submitted"),
    checked: t.exposeInt("checked"),
    returned: t.exposeInt("returned"),
    pendingSubmission: t.exposeInt("pendingSubmission"),
    absent: t.exposeInt("absent"),
  }),
});

builder.queryField("assignmentItemTallies", (t) =>
  t.field({
    type: [AsItemTallyRef],
    description:
      "Pipeline counts per assignment item for a section, for the workspace card headers. " +
      "Read-scope + the same subject-readability filter as assignmentOpenRecords.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      // Same scope as assignmentOpenRecords above (D-#388) — the counts must cover
      // exactly the cards the caller can see, folded ones included.
      const allowed = await allowedSubjectCodesForSection(ctx, args.sectionId, args.classId);
      return assignmentItemTallies(args.sectionId, allowed);
    },
  }),
);

const AsSubmitPassEntryInput = builder.inputType("AsSubmitPassEntryInput", {
  fields: (t) => ({
    recordId: t.string({ required: true }),
    submitted: t.boolean({ required: true }),
  }),
});
const AsReturnPassEntryInput = builder.inputType("AsReturnPassEntryInput", {
  fields: (t) => ({
    recordId: t.string({ required: true }),
    returned: t.boolean({ required: true }),
  }),
});

const AsSubmitPassResultRef = builder
  .objectRef<{ submittedCount: number; chasedCount: number; unchangedCount: number }>("AsSubmitPassResult")
  .implement({
    fields: (t) => ({
      submittedCount: t.exposeInt("submittedCount"),
      chasedCount: t.exposeInt("chasedCount"),
      unchangedCount: t.exposeInt("unchangedCount"),
    }),
  });
const AsReturnPassResultRef = builder
  .objectRef<{ returnedCount: number; unchangedCount: number }>("AsReturnPassResult")
  .implement({
    fields: (t) => ({
      returnedCount: t.exposeInt("returnedCount"),
      unchangedCount: t.exposeInt("unchangedCount"),
    }),
  });

builder.mutationField("assignmentSubmitPass", (t) =>
  t.field({
    type: AsSubmitPassResultRef,
    description:
      "The submission roster pass (RP-3, D-#356): uncrossed → SUBMITTED; crossed → CHASE " +
      "FIRST-CROSS-ONLY, regardless of due date. Subject-teacher write-scope.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
      entries: t.arg({ type: [AsSubmitPassEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentItemSubjectId(args.itemId));
      await assertItemInSection(args.itemId, args.sectionId);
      return asSubmitPassSvc(
        args.itemId,
        args.entries.map((e) => ({ recordId: e.recordId, submitted: e.submitted })),
        ctx.auth.userId as string,
      );
    },
  }),
);

builder.mutationField("assignmentReturnPass", (t) =>
  t.field({
    type: AsReturnPassResultRef,
    description:
      "The return roster pass (RP-3, D-#356): each uncrossed CHECKED/RESUBMIT record → RETURNED. " +
      "Subject-teacher write-scope.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      itemId: t.arg.string({ required: true }),
      entries: t.arg({ type: [AsReturnPassEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentItemSubjectId(args.itemId));
      await assertItemInSection(args.itemId, args.sectionId);
      return asReturnPassSvc(
        args.itemId,
        args.entries.map((e) => ({ recordId: e.recordId, returned: e.returned })),
        ctx.auth.userId as string,
      );
    },
  }),
);

builder.mutationField("recordAssignmentOutcome", (t) =>
  t.field({
    type: CheckResultRef,
    description:
      "One-tap assignment check (RP-3, D-#356): fast-forwards the record to SUBMITTED then checks it " +
      "(result + optional marks ≤ totalMarks + feedback). NOTHING auto-spawns (D-#87). Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
      result: t.arg.string({ required: true }),
      marks: t.arg.int({ required: false }),
      feedback: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      await assertRecordInSection(args.recordId, args.sectionId);
      return recordAsOutcomeSvc({
        recordId: args.recordId,
        result: args.result,
        marks: args.marks ?? undefined,
        feedback: args.feedback ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("issueAssignmentResubmission", (t) =>
  t.field({
    type: ResubResultRef,
    description:
      "Teacher-explicit resubmission on any CHECKED record (D-#87 — never automatic): " +
      "original → RESUBMIT; new record, same AS_ID, fresh pass. Write-scope enforced.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      recordId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await assignmentRecordSubjectId(args.recordId));
      await assertRecordInSection(args.recordId, args.sectionId);
      return resubSvc(args.recordId, ctx.auth.userId as string);
    },
  }),
);

// ===========================================================================
// AS-T4 — Office follow-up (message:dispatch + Principal/Office, D-#88)
// ===========================================================================

builder.queryField("assignmentChaseList", (t) =>
  t.field({
    type: [ChaseEntryRef],
    description: "Office chase list: every CHASE record + contact + days overdue (D-#88).",
    authScopes: { hasPermission: "message:dispatch" },
    resolve: async (_root, _args, ctx) => {
      assertFollowUpAdmin(ctx);
      return chaseListSvc();
    },
  }),
);

builder.mutationField("escalateAssignmentChase", (t) =>
  t.field({
    type: EscalateResultRef,
    description:
      "Take the next ladder step (AJ-6): 1–2 in-app via the D-#72 emit() seam (skippable), " +
      "3+ WhatsApp message + wa.me link (manual send, ADR-003). Office/Principal only.",
    authScopes: { hasPermission: "message:dispatch" },
    args: {
      recordId: t.arg.string({ required: true }),
      skipInApp: t.arg.boolean({ required: false }),
      manualStep: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertFollowUpAdmin(ctx);
      if (args.manualStep && args.manualStep !== "CALL" && args.manualStep !== "OTHER") {
        throw new Error("manualStep is CALL or OTHER");
      }
      return escalateSvc({
        recordId: args.recordId,
        skipInApp: args.skipInApp ?? undefined,
        manualStep: (args.manualStep as "CALL" | "OTHER" | undefined) ?? undefined,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

builder.mutationField("recordAssignmentFollowUpOutcome", (t) =>
  t.field({
    type: FollowUpRef,
    description: "Stamp a PENDING manual step SENT/SKIPPED + outcome (the sheet's Sent Status).",
    authScopes: { hasPermission: "message:dispatch" },
    args: {
      followUpId: t.arg.string({ required: true }),
      sentStatus: t.arg.string({ required: true }),
      outcome: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertFollowUpAdmin(ctx);
      if (args.sentStatus !== "SENT" && args.sentStatus !== "SKIPPED") {
        throw new Error("sentStatus is SENT or SKIPPED");
      }
      const row = await outcomeSvc(
        args.followUpId,
        args.sentStatus,
        args.outcome ?? undefined,
        ctx.auth!.userId as string,
      );
      return followUpShape(row as never);
    },
  }),
);

builder.queryField("assignmentFollowUps", (t) =>
  t.field({
    type: [FollowUpRef],
    description: "The ladder history for one chased record (Office/Principal).",
    authScopes: { hasPermission: "message:dispatch" },
    args: { recordId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertFollowUpAdmin(ctx);
      const rows = await listFollowUpsSvc(args.recordId);
      return rows.map((r) => followUpShape(r as never));
    },
  }),
);

function followUpShape(r: {
  _id: { toString(): string };
  recordId: { toString(): string };
  asId: string;
  studentId: { toString(): string };
  stepNumber: number;
  step: string;
  messageBn: string;
  waLink?: string;
  sentStatus: string;
  outcome?: string;
  followUpDate: Date;
  sentAt?: Date;
}): FollowUpShape {
  return {
    id: r._id.toString(),
    recordId: r.recordId.toString(),
    asId: r.asId,
    studentId: r.studentId.toString(),
    stepNumber: r.stepNumber,
    step: r.step,
    messageBn: r.messageBn,
    waLink: r.waLink ?? null,
    sentStatus: r.sentStatus,
    outcome: r.outcome ?? null,
    followUpDate: new Date(r.followUpDate).toISOString(),
    sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
  };
}

// ===========================================================================
// AS-T5 — roll-ups + guardian read
// ===========================================================================

builder.queryField("assignmentSummary", (t) =>
  t.field({
    type: SummaryRef,
    description:
      "Delivery/submission rates by teacher/class/week (suspended weeks excluded), chase volume, " +
      "latency, thresholds (AJ-7). A TEACHER sees their own rows only.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekFrom: t.arg.int({ required: false }),
      weekTo: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // PRINCIPAL is unscoped; a TEACHER's summary is self-scoped (own delivery health).
      const teacherId = ctx.auth.role === "TEACHER" ? (ctx.auth.userId as string) : undefined;
      return summarySvc({
        academicYearId: args.academicYearId,
        weekFrom: args.weekFrom ?? undefined,
        weekTo: args.weekTo ?? undefined,
        teacherId,
      });
    },
  }),
);

builder.queryField("childAssignments", (t) =>
  t.field({
    type: [ChildAssignmentRef],
    description:
      "Guardian read (AJ-8): the linked child's assignments — pending, overdue with days late, " +
      "marks + result + feedback. Link-gated (assertGuardianOfStudent).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childAssignmentsSvc(args.studentId);
    },
  }),
);
