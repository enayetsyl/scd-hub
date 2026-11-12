/**
 * planYearChange (YC-4, prd-year-change section 3 step 1): a PURE dry run. It reads, never writes,
 * and returns every row `applyPrepare` would create or change, counts per class and the refusals.
 * The apply takes this same object, so the dry run and the write cannot drift.
 *
 * Owner rulings (2026-11-12): everyone is promoted one level by default, untick = repeats, a
 * separate LEFT mark, Class 5 -> Class 6; 2027 shape Nursery-C2 one section (Main), C3-C6 Boys/Girls;
 * class teachers pre-filled from the past year's teacher of the same level + section code; no roll
 * numbers; the Office types the school ID of an admission and uniqueness is checked here.
 */
import { Types } from "mongoose";
import { ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN } from "@scd/shared";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Student } from "../foundation/models/Student";
import { Enrolment } from "../foundation/models/Enrolment";
import { User } from "../foundation/models/User";
import { YearChangeRun } from "./models/YearChangeRun";
import { GuardianLink } from "../foundation/models/GuardianLink";
import { dhakaDayKey } from "../../lib/dhakaDay";
import { dayBefore } from "../foundation/services/EnrolmentService";
import { normalizePhone } from "../foundation/services/credentials";
import { emptyScheduleCopy, planScheduleCopy } from "./copy";
import {
  LEVEL_NAME_BN,
  SECTION_CODES,
  SECTION_LABEL_BN,
  defaultSections,
  validSectionShape,
  type AdmissionInput,
  type Decision,
  type PlanAdmissionRow,
  type PlanClassRow,
  type PlanClassTeacherRow,
  type PlanEnrolmentRow,
  type PlanInput,
  type PlanLeaverRow,
  type SectionCode,
  type YearChangePlan,
} from "./types";

const sid = (id: unknown): string => String(id);
/** School IDs compare numerically when numeric ("0104" = "104"), else trimmed upper-case. */
export function normSchoolId(id: string): string {
  const t = (id ?? "").trim();
  return /^[0-9]+$/.test(t) ? String(Number(t)) : t.toUpperCase();
}
const isCode = (c: unknown): c is SectionCode => typeof c === "string" && (SECTION_CODES as readonly string[]).includes(c);
const validLevel = (l: number): boolean => Number.isInteger(l) && l >= ROSTER_CLASS_LEVEL_MIN && l <= ROSTER_CLASS_LEVEL_MAX;

/** Which target section a child goes to: manual pick, else the same-named one, else by gender. */
function pickCode(
  shape: readonly SectionCode[],
  want: SectionCode | undefined,
  fromCode: string,
  gender: string | undefined,
): SectionCode | null {
  if (want) return shape.includes(want) ? want : null;
  if (shape.length === 1) return shape[0];
  if (isCode(fromCode) && fromCode !== "Main" && shape.includes(fromCode)) return fromCode;
  if (gender === "male" && shape.includes("Boys")) return "Boys";
  if (gender === "female" && shape.includes("Girls")) return "Girls";
  return null;
}

export async function planYearChange(input: PlanInput): Promise<YearChangePlan> {
  const refusals: string[] = [];
  const warnings: string[] = [];
  const empty = (fromLabel = "", toLabel = "", startKey = "", closeKey = ""): YearChangePlan => ({
    fromYearId: input.fromYearId,
    toYearId: input.toYearId,
    fromLabel,
    toLabel,
    startKey,
    closeKey,
    classes: [],
    enrolments: [],
    leavers: [],
    admissions: [],
    classTeachers: [],
    scheduleCopy: emptyScheduleCopy(input.copy),
    runId: null,
    reconcile: { removeEnrolments: [], removeAdmissions: [] },
    counts: {
      classesToCreate: 0,
      sectionsToCreate: 0,
      enrolmentsToCreate: 0,
      enrolmentsExisting: 0,
      promoted: 0,
      repeaters: 0,
      left: 0,
      admissionsToCreate: 0,
      admissionsExisting: 0,
      classTeachersToSet: 0,
      enrolmentsToUpdate: 0,
      enrolmentsToRemove: 0,
      admissionsToUpdate: 0,
      admissionsToRemove: 0,
    },
    refusals,
    warnings,
  });

  // --- 1. the two years ---------------------------------------------------------------------
  const [fromYear, toYear] = await Promise.all([
    Types.ObjectId.isValid(input.fromYearId) ? AcademicYear.findById(input.fromYearId).lean() : null,
    Types.ObjectId.isValid(input.toYearId) ? AcademicYear.findById(input.toYearId).lean() : null,
  ]);
  if (!fromYear) refusals.push("শিক্ষাবর্ষ (থেকে) পাওয়া যায়নি।");
  if (!toYear) refusals.push("শিক্ষাবর্ষ (পর্যন্ত) পাওয়া যায়নি।");
  if (!fromYear || !toYear) return empty();
  if (fromYear._id.equals(toYear._id)) refusals.push("দুটি শিক্ষাবর্ষ আলাদা হতে হবে।");
  if (toYear.startDate <= fromYear.startDate) refusals.push("নতুন শিক্ষাবর্ষ আগের বর্ষের পরে শুরু হতে হবে।");
  const startKey = dhakaDayKey(toYear.startDate);
  const closeKey = dayBefore(startKey);
  if (startKey > `${startKey.slice(0, 4)}-01-03`) {
    refusals.push(`নতুন শিক্ষাবর্ষ ৩ জানুয়ারির মধ্যে শুরু হতে হবে (এখন ${startKey})।`);
  }
  const plan = empty(fromYear.label, toYear.label, startKey, closeKey);
  // One prepared run per year pair (the exists/changed checks compare against its runId).
  const existingRun = await YearChangeRun.findOne({ fromYearId: fromYear._id, toYearId: toYear._id }).lean();
  if (existingRun) {
    plan.runId = existingRun.runId;
    if (existingRun.status !== "PREPARED") refusals.push(`রান ${existingRun.runId} উত্তরণ শুরু করেছে বা শেষ করেছে — নতুন প্রস্তুতি চলবে না।`);
  }

  // --- 2. past year: classes, sections, children --------------------------------------------
  const fromClasses = await Class.find({ academicYearId: fromYear._id }).lean();
  const fromLevelOfClass = new Map(fromClasses.map((c) => [sid(c._id), c.level]));
  const fromSections = await Section.find({ classId: { $in: fromClasses.map((c) => c._id) } }).lean();
  const fromSectionInfo = new Map(fromSections.map((s) => [sid(s._id), { level: fromLevelOfClass.get(sid(s.classId)) as number, code: s.code, teacher: s.classTeacherId ? sid(s.classTeacherId) : null }]));
  const students = await Student.find({ active: true, classId: { $in: fromClasses.map((c) => c._id) } })
    .select("schoolId name gender classId sectionId")
    .sort({ schoolId: 1 })
    .lean();
  const strays = await Student.countDocuments({ active: true, classId: { $nin: fromClasses.map((c) => c._id) } });
  if (strays > 0) warnings.push(`${strays} জন সক্রিয় শিক্ষার্থী ${fromYear.label} বর্ষের কোনো শ্রেণিতে নেই — তালিকায় ধরা হয়নি।`);

  // --- 3. decisions -------------------------------------------------------------------------
  const decisionOf = new Map<string, { decision: Decision; toSectionCode?: SectionCode }>();
  for (const p of input.promotions ?? []) {
    if (decisionOf.has(p.studentId)) {
      refusals.push(`একই শিক্ষার্থী দুইবার তালিকায় আছে (${p.studentId})।`);
      continue;
    }
    if (!["PROMOTE", "REPEAT", "LEFT"].includes(p.decision)) {
      refusals.push(`অচেনা সিদ্ধান্ত "${p.decision}" (${p.studentId})।`);
      continue;
    }
    if (p.toSectionCode !== undefined && !isCode(p.toSectionCode)) {
      refusals.push(`অচেনা শাখা "${p.toSectionCode}" (${p.studentId})।`);
      continue;
    }
    decisionOf.set(p.studentId, { decision: p.decision, toSectionCode: p.toSectionCode });
  }
  const activeIds = new Set(students.map((s) => sid(s._id)));
  for (const id of decisionOf.keys()) {
    if (!activeIds.has(id)) refusals.push(`${id}: এই শিক্ষার্থী ${fromYear.label} বর্ষে সক্রিয় নয় বা পাওয়া যায়নি।`);
  }

  // --- 4. class shapes ----------------------------------------------------------------------
  const shapeOverride = new Map<number, SectionCode[]>();
  for (const c of input.classPlan ?? []) {
    if (!validLevel(c.level)) {
      refusals.push(`শ্রেণির স্তর ${c.level} ঠিক নয়।`);
      continue;
    }
    if (!c.sections.every(isCode) || !validSectionShape(c.sections)) {
      refusals.push(`শ্রেণি ${c.level}: শাখা হবে একটি "মূল" অথবা "বালক"/"বালিকা"।`);
      continue;
    }
    shapeOverride.set(c.level, [...c.sections]);
  }

  // target levels per child
  type Resolved = { s: (typeof students)[number]; info: { level: number; code: string }; decision: Decision; want?: SectionCode; toLevel: number };
  const resolved: Resolved[] = [];
  for (const s of students) {
    const d = decisionOf.get(sid(s._id)) ?? { decision: "PROMOTE" as Decision };
    const info = fromSectionInfo.get(sid(s.sectionId)) ?? { level: fromLevelOfClass.get(sid(s.classId)) as number, code: "?", teacher: null };
    const toLevel = d.decision === "PROMOTE" ? info.level + 1 : info.level;
    if (d.decision !== "LEFT" && toLevel > ROSTER_CLASS_LEVEL_MAX) {
      refusals.push(`${s.schoolId} ${s.name}: শ্রেণি ${info.level}-এর পরের শ্রেণি নেই — "চলে গেছে" চিহ্নিত করুন বা একই শ্রেণিতে রাখুন।`);
      continue;
    }
    resolved.push({ s, info, decision: d.decision, want: d.toSectionCode, toLevel });
  }
  const admissionIn = (input.admissions ?? []).filter((a) => {
    if (!validLevel(a.level)) {
      refusals.push(`ভর্তি ${a.schoolId}: শ্রেণির স্তর ${a.level} ঠিক নয়।`);
      return false;
    }
    return true;
  });

  const levels = new Set<number>([6, ...fromClasses.map((c) => c.level), ...shapeOverride.keys(), ...admissionIn.map((a) => a.level)]);
  for (const r of resolved) if (r.decision !== "LEFT") levels.add(r.toLevel);
  const shapeOf = (level: number): SectionCode[] => shapeOverride.get(level) ?? defaultSections(level);

  // --- 5. next-year rows that already exist -------------------------------------------------
  const toClasses = await Class.find({ academicYearId: toYear._id }).lean();
  const toClassByLevel = new Map(toClasses.map((c) => [c.level as number, c]));
  const toSections = await Section.find({ classId: { $in: toClasses.map((c) => c._id) } }).lean();
  const toSectionKey = (classId: unknown, code: string): string => `${sid(classId)}:${code}`;
  const toSectionBy = new Map(toSections.map((s) => [toSectionKey(s.classId, s.code), s]));

  // --- 6. enrolment rows --------------------------------------------------------------------
  const existingToEnrol = await Enrolment.find({ academicYearId: toYear._id, studentId: { $in: students.map((s) => s._id) } }).lean();
  const enrolByStudent = new Map(existingToEnrol.map((e) => [sid(e.studentId), e]));

  const enrolments: PlanEnrolmentRow[] = [];
  const leavers: PlanLeaverRow[] = [];
  const leaverSet = new Set<string>(resolved.filter((r) => r.decision === "LEFT").map((r) => sid(r.s._id)));
  for (const r of resolved) {
    const base = { studentId: sid(r.s._id), schoolId: r.s.schoolId, name: r.s.name, fromLevel: r.info.level, fromSectionCode: r.info.code };
    if (r.decision === "LEFT") {
      leavers.push(base);
      continue;
    }
    const code = pickCode(shapeOf(r.toLevel), r.want, r.info.code, r.s.gender);
    if (!code) {
      refusals.push(`${r.s.schoolId} ${r.s.name}: কোন শাখায় যাবে ঠিক করা যায়নি (লিঙ্গ লিখুন বা শাখা বেছে দিন)।`);
      continue;
    }
    const have = enrolByStudent.get(base.studentId);
    let exists = false;
    let update = false;
    if (have) {
      const cls = toClassByLevel.get(r.toLevel);
      const sec = cls ? toSectionBy.get(toSectionKey(cls._id, code)) : undefined;
      const ours = have.status === "PLANNED" && !!have.runId && have.runId === plan.runId;
      if (ours && sec && have.sectionId.equals(sec._id)) exists = true;
      else if (ours) update = true;
      else refusals.push(`${r.s.schoolId} ${r.s.name}: ${toYear.label} বর্ষে আগে থেকেই অন্য তালিকাভুক্তি আছে — আগের প্রস্তুতি বাতিল করুন।`);
    }
    enrolments.push({
      ...base,
      decision: r.decision,
      outcome: r.decision === "PROMOTE" ? "PROMOTED" : "REPEATED",
      toLevel: r.toLevel,
      toSectionCode: code,
      exists,
      update,
    });
  }

  // --- 7. admissions ------------------------------------------------------------------------
  const admissions: PlanAdmissionRow[] = [];
  const seenIds = new Set<string>();
  // Every Student, active or not: ids are compared numerically ("0104" is "104").
  const everyone = await Student.find({}).select("schoolId active yearChangeRunId name nameBn gender phone classId sectionId").lean();
  const byNorm = new Map<string, typeof everyone>();
  for (const st of everyone) byNorm.set(normSchoolId(st.schoolId), [...(byNorm.get(normSchoolId(st.schoolId)) ?? []), st]);
  const matchedAdmissionIds = new Set<string>();
  for (const a of admissionIn as AdmissionInput[]) {
    const schoolId = (a.schoolId ?? "").trim();
    const name = (a.name ?? "").trim();
    const phone = normalizePhone(a.guardianPhone ?? "");
    const tag = `ভর্তি ${schoolId || "(আইডি নেই)"}`;
    if (!schoolId || !name) {
      refusals.push(`${tag}: আইডি ও নাম লাগবে।`);
      continue;
    }
    if (!phone) {
      refusals.push(`${tag}: অভিভাবকের ফোন লাগবে।`);
      continue;
    }
    if (!["male", "female", "other"].includes(a.gender)) {
      refusals.push(`${tag}: লিঙ্গ লাগবে।`);
      continue;
    }
    if (seenIds.has(normSchoolId(schoolId))) {
      refusals.push(`${tag}: একই আইডি তালিকায় দুইবার আছে।`);
      continue;
    }
    seenIds.add(normSchoolId(schoolId));
    const code = pickCode(shapeOf(a.level), a.sectionCode, "?", a.gender);
    if (!code) {
      refusals.push(`${tag}: কোন শাখায় যাবে ঠিক করা যায়নি।`);
      continue;
    }
    const clashes = byNorm.get(normSchoolId(schoolId)) ?? [];
    let exists = false;
    let changed = false;
    if (clashes.length) {
      const mine = clashes.length === 1 && !!clashes[0].yearChangeRunId && clashes[0].yearChangeRunId === plan.runId && clashes[0].active === false ? clashes[0] : null;
      if (!mine) {
        refusals.push(`${tag}: এই আইডি আগে থেকেই ব্যবহৃত (${clashes[0].schoolId})।`);
        continue;
      }
      matchedAdmissionIds.add(sid(mine._id));
      const cls = toClassByLevel.get(a.level);
      const sec = cls ? toSectionBy.get(toSectionKey(cls._id, code)) : undefined;
      changed =
        mine.schoolId !== schoolId ||
        mine.name !== name ||
        (mine.nameBn ?? "") !== (a.nameBn?.trim() ?? "") ||
        mine.gender !== a.gender ||
        (mine.phone ?? "") !== phone ||
        !sec ||
        !mine.sectionId.equals(sec._id);
      exists = !changed;
    }
    admissions.push({ schoolId, name, ...(a.nameBn ? { nameBn: a.nameBn.trim() } : {}), gender: a.gender, toLevel: a.level, toSectionCode: code, guardianPhone: phone, exists, changed });
  }

  // --- 7b. reconcile with the prepared run: rows of THIS run the plan no longer contains --------
  const reconcile = plan.reconcile;
  if (plan.runId) {
    const keepStudents = new Set<string>([...enrolments.map((e) => e.studentId), ...matchedAdmissionIds]);
    const runAdmissions = everyone.filter((st) => st.yearChangeRunId === plan.runId);
    const runAdmissionIds = new Set(runAdmissions.map((st) => sid(st._id)));
    for (const st of runAdmissions) {
      if (!matchedAdmissionIds.has(sid(st._id))) reconcile.removeAdmissions.push({ studentId: sid(st._id), schoolId: st.schoolId });
    }
    const planned = await Enrolment.find({ runId: plan.runId, academicYearId: toYear._id, status: "PLANNED" }).select("studentId").lean();
    const schoolOf = new Map(everyone.map((st) => [sid(st._id), st.schoolId]));
    const activeNow = new Set(everyone.filter((st) => st.active).map((st) => sid(st._id)));
    for (const e of planned) {
      const id = sid(e.studentId);
      if (keepStudents.has(id) || runAdmissionIds.has(id)) continue;
      reconcile.removeEnrolments.push({ studentId: id, schoolId: schoolOf.get(id) ?? id, reason: leaverSet.has(id) ? "চলে গেছে" : activeNow.has(id) ? "তালিকায় নেই" : "শিক্ষার্থী আর সক্রিয় নয়" });
    }
  }

  // --- 8. classes + sections + counts -------------------------------------------------------
  const classes: PlanClassRow[] = [];
  for (const level of [...levels].sort((x, y) => x - y)) {
    const shape = shapeOf(level);
    const fromRow = fromClasses.find((c) => c.level === level);
    const existing = toClassByLevel.get(level);
    const inCls = enrolments.filter((e) => e.toLevel === level);
    const sections = shape.map((code) => {
      const sec = existing ? toSectionBy.get(toSectionKey(existing._id, code)) : undefined;
      return {
        code,
        nameBn: SECTION_LABEL_BN[code],
        existingId: sec ? sid(sec._id) : null,
        children: inCls.filter((e) => e.toSectionCode === code).length + admissions.filter((a) => a.toLevel === level && a.toSectionCode === code).length,
      };
    });
    classes.push({
      level,
      nameBn: existing?.nameBn ?? fromRow?.nameBn ?? LEVEL_NAME_BN[level] ?? `শ্রেণি ${level}`,
      existingId: existing ? sid(existing._id) : null,
      sections,
      promotedIn: inCls.filter((e) => e.decision === "PROMOTE").length,
      repeaters: inCls.filter((e) => e.decision === "REPEAT").length,
      admissions: admissions.filter((a) => a.toLevel === level).length,
      total: sections.reduce((n, s) => n + s.children, 0),
      left: leavers.filter((l) => l.fromLevel === level).length,
    });
  }

  // --- 9. class teachers --------------------------------------------------------------------
  const chosen = new Map<string, string | null>();
  for (const t of input.classTeachers ?? []) {
    if (!validLevel(t.level) || !isCode(t.sectionCode)) {
      refusals.push(`শ্রেণি শিক্ষক: ${t.level}/${t.sectionCode} ঠিক নয়।`);
      continue;
    }
    chosen.set(`${t.level}:${t.sectionCode}`, t.teacherId);
  }
  const wanted: Array<{ level: number; code: SectionCode; teacherId: string; source: "PREFILLED" | "CHOSEN" }> = [];
  for (const c of classes) {
    for (const s of c.sections) {
      const key = `${c.level}:${s.code}`;
      if (chosen.has(key)) {
        const t = chosen.get(key);
        if (t) wanted.push({ level: c.level, code: s.code, teacherId: t, source: "CHOSEN" });
        continue;
      }
      const fromCls = fromClasses.find((x) => x.level === c.level);
      const past = fromCls ? fromSections.find((x) => x.classId.equals(fromCls._id) && x.code === s.code && x.classTeacherId) : undefined;
      if (past?.classTeacherId) wanted.push({ level: c.level, code: s.code, teacherId: sid(past.classTeacherId), source: "PREFILLED" });
    }
  }
  const teacherDocs = await User.find({ role: "TEACHER", _id: { $in: wanted.filter((w) => Types.ObjectId.isValid(w.teacherId)).map((w) => w.teacherId) } })
    .select("role")
    .lean();
  const teacherOk = new Set(teacherDocs.map((u) => sid(u._id)));
  const classTeachers: PlanClassTeacherRow[] = [];
  for (const w of wanted) {
    if (!teacherOk.has(w.teacherId)) {
      if (w.source === "CHOSEN") refusals.push(`শ্রেণি ${w.level} ${SECTION_LABEL_BN[w.code]}: বেছে নেওয়া শিক্ষক পাওয়া যায়নি বা শিক্ষক নন।`);
      else warnings.push(`শ্রেণি ${w.level} ${SECTION_LABEL_BN[w.code]}: আগের বছরের শ্রেণি শিক্ষক এখন শিক্ষক হিসেবে নেই — বাদ দেওয়া হলো।`);
      continue;
    }
    const cls = toClassByLevel.get(w.level);
    const sec = cls ? toSectionBy.get(toSectionKey(cls._id, w.code)) : undefined;
    classTeachers.push({ level: w.level, sectionCode: w.code, teacherId: w.teacherId, source: w.source, alreadySet: !!sec?.classTeacherId && sid(sec.classTeacherId) === w.teacherId });
  }

  // --- 10. counts ---------------------------------------------------------------------------
  plan.classes = classes;
  plan.enrolments = enrolments;
  plan.leavers = leavers;
  plan.admissions = admissions;
  plan.classTeachers = classTeachers;
  plan.counts = {
    classesToCreate: classes.filter((c) => !c.existingId).length,
    sectionsToCreate: classes.reduce((n, c) => n + c.sections.filter((s) => !s.existingId).length, 0),
    enrolmentsToCreate: enrolments.filter((e) => !e.exists && !e.update).length,
    enrolmentsExisting: enrolments.filter((e) => e.exists).length,
    promoted: enrolments.filter((e) => e.decision === "PROMOTE").length,
    repeaters: enrolments.filter((e) => e.decision === "REPEAT").length,
    left: leavers.length,
    admissionsToCreate: admissions.filter((a) => !a.exists && !a.changed).length,
    admissionsExisting: admissions.filter((a) => a.exists).length,
    classTeachersToSet: classTeachers.filter((t) => !t.alreadySet).length,
    enrolmentsToUpdate: enrolments.filter((e) => e.update).length,
    enrolmentsToRemove: reconcile.removeEnrolments.length,
    admissionsToUpdate: admissions.filter((a) => a.changed).length,
    admissionsToRemove: reconcile.removeAdmissions.length,
  };
  // --- 11. YC-6: routine + schedule copy ------------------------------------------------------
  plan.scheduleCopy = await planScheduleCopy(plan, input.copy, fromYear, toYear);
  refusals.push(...plan.scheduleCopy.routine.conflicts.map((c) => `রুটিন কপি: ${c}`));
  return plan;
}
