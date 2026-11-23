/**
 * Collection lists for the dev copy + mask + fake generator (AL-2, prd-academic-loop-2027 section 9.2 / 9.3).
 *
 * Lists are MODEL names; the real collection names are read from each registered model
 * (`Model.collection.collectionName`) so nothing is hand-typed. A model that does not exist yet (built by
 * a later slice, e.g. MasteryState / QuestionUse) is listed with `future: true` and is skipped with a note;
 * any other missing name is a hard error.
 */
import * as fs from "fs";
import * as path from "path";
import mongoose from "mongoose";

export interface ModelRef {
  model: string;
  /** Built by a later slice: tolerated while missing. */
  future?: boolean;
}

const m = (model: string, future = false): ModelRef => ({ model, ...(future ? { future } : {}) });

/** Section 9.2 step 5: copied prod -> dev (mongodump --nsInclude / mongorestore --drop). */
export const COPY_MODELS: ModelRef[] = [
  m("User"), m("StaffProfile"), m("Guardian"), m("GuardianLink"), m("Student"), m("Enrolment"),
  m("Class"), m("Section"), m("SectionMerge"), m("Subject"), m("AcademicYear"), m("AcademicPause"),
  m("ClassTeacherAssignment"), m("ScopeGrant"), m("RoleTemplateOverride"),
  // routine
  m("RoutineSlot"), m("PeriodGrid"), m("Room"), m("SubjectGroup"), m("SubjectGroupMembership"),
  m("HolidayException"), m("ScheduleWindow"),
  m("AssignmentSchedule"),
  // content
  m("ContentArtifact"), m("QuestionHint"), m("SessionHomeGuide"),
  // mastery catalogue
  m("MasteryDomain"), m("MasteryChapter"), m("MasteryOutcome"), m("MasteryQuestionType"), m("MasteryTag"),
  m("MasteryPolicy"), m("MasteryEnablement"), m("MasteryCatalogueReview"), m("MasterySequence"),
  m("MasteryExclusion"),
  m("LessonProgressConfig"), m("SyllabusTarget"),
  // the prepared 2027 year change (prod ran Prepare on 21 Nov 2026): without its run row the copied 2027
  // classes / enrolments are orphans and the dev rehearsal cannot cut over
  m("YearChangeRun"),
];

/** Section 9.2 step 3: old dev operational + mastery-seed data, emptied before the copy / by the mask script. */
export const WIPE_MODELS: ModelRef[] = [
  // tracker items / records
  m("HomeworkItem"), m("HomeworkStudentRecord"), m("HomeworkNilDeclaration"), m("HomeworkReconciliation"),
  m("AssignmentItem"), m("AssignmentStudentRecord"), m("AssignmentNilDeclaration"), m("AssignmentFollowUp"),
  m("AssignmentGiftAward"), m("TrackerRecord"),
  // class tests
  m("ClassTest"), m("ClassTestResult"), m("ClassTestCorrectionNote"),
  // class notes, lessons, attendance
  m("ClassNote"), m("LessonDelivery"), m("LessonCatchup"), m("StudentAttendanceDay"), m("AttendanceCorrectionNote"),
  // mastery papers / results / evidence / states / assignments / sheets / actions (extra classes ride on MasteryPaper)
  m("MasteryPaper"), m("MasteryResult"), m("MasteryEvidence"), m("MasteryState", true),
  m("MasteryAssignment"), m("MasteryAssignmentSheet"), m("MasteryAction"),
  m("IntegrityCase"), m("QuestionUse", true),
  m("Notification"), m("Audit"), m("PrintRequest"),
];

/** Section 9.3 "Tag and remove": the fake run's declared side-effect collections (every scenario adds its own). */
export const FAKE_BASE_MODELS: ModelRef[] = [
  m("MasteryEvidence"), m("MasteryState", true), m("MasteryAction"), m("IntegrityCase"), m("QuestionUse", true),
  m("Notification"), m("Audit"), m("StaffMistake"), m("StaffMistakeNote"),
  m("MarkEscalation"), m("MarkReminderAck"), m("PrintRequest"),
];

/** Never copied (documentation of section 9.2 step 6; the runbook prints it). */
export const NEVER_COPIED_NOTE =
  "push devices / web-push subscriptions, notifications, audits, AI settings/keys/usage, HR/payroll/finance, files, login throttles, sessions, chat";

/** Require every model file so `mongoose.models` holds all registered models. Idempotent. */
export function loadAllModels(): void {
  const modulesDir = path.resolve(__dirname, "../../modules");
  for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    const modelsDir = path.join(modulesDir, mod.name, "models");
    if (!fs.existsSync(modelsDir)) continue;
    for (const f of fs.readdirSync(modelsDir)) {
      if (!/\.(ts|js)$/.test(f) || f.endsWith(".d.ts")) continue;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(path.join(modelsDir, f));
    }
  }
}

export interface ResolvedCollections {
  /** model name -> collection name, in input order. */
  found: Array<{ model: string; collection: string }>;
  /** future models that are not registered yet. */
  skipped: string[];
}

/** Resolve model names to collection names. Throws on a missing non-future model. */
export function resolveCollections(refs: ModelRef[]): ResolvedCollections {
  loadAllModels();
  const found: ResolvedCollections["found"] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (seen.has(r.model)) continue;
    seen.add(r.model);
    if (!mongoose.modelNames().includes(r.model)) {
      if (r.future) skipped.push(r.model);
      else missing.push(r.model);
      continue;
    }
    found.push({ model: r.model, collection: mongoose.model(r.model).collection.collectionName });
  }
  if (missing.length) throw new Error(`dev collections: model(s) not registered: ${missing.join(", ")}`);
  return { found, skipped };
}

/** The `--nsInclude` argument list for a database: `--nsInclude=<db>.<collection>` per entry (bare tokens, no quotes, no spaces). */
export function nsIncludeFlags(dbName: string, refs: ModelRef[]): string[] {
  return resolveCollections(refs).found.map((f) => `--nsInclude=${dbName}.${f.collection}`);
}
