/**
 * classTestAnchor — the ONE place that answers "who may touch this exam, and who
 * sat it?" for both class-test anchors (D-#507).
 *
 * A class test is anchored on EXACTLY ONE of:
 *   - a Section        — a general-subject exam for one section (every row before
 *                        D-#507); scope is the ordinary section grant, roster is
 *                        the section's active students.
 *   - a SubjectGroup   — a cross-class Arabic group (D-#48/#56); it has no section
 *                        and no single class level, so neither the section grant
 *                        nor the section roster can answer either question.
 *
 * WHY the group needs its own rule: teacher scopes (`assertCanWrite`) are grants
 * over SECTIONS. An Arabic group mixes students from 2–4 different classes, so
 * asking "do you write section X?" of a group exam is not a stricter or looser
 * check — it is a meaningless one. The routine is the honest source: it already
 * names the teacher of every group period, and it is the same source the
 * accountable-teacher default reads (`resolveSubjectTeacher`), so the two can
 * never disagree about whose group it is.
 *
 * Roles on a group exam mirror `assertCanWrite` exactly, so the two anchors behave
 * the same way for the same person: PRINCIPAL passes, OFFICE/GUARDIAN are refused
 * a write, and a TEACHER passes only if the routine names them on that group.
 */
import { Types } from "mongoose";
import type { AppContext } from "../../context";
import { assertCanRead, assertCanWrite, ForbiddenError } from "../../middleware/authz";
import { isAdminStaff } from "../foundation/services/RoleScope";
import { Student } from "../foundation/models/Student";
import { Section } from "../foundation/models/Section";
import { SectionMerge } from "../foundation/models/SectionMerge";
import { Class } from "../foundation/models/Class";
import { SubjectGroup } from "../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../routine/models/SubjectGroupMembership";
import { teachesSubjectGroup } from "./subjectTeacher";
import type { DelegatedAction } from "@scd/shared";

/** The anchor fields every caller already has on a `ClassTestShape`. */
export interface AnchoredTest {
  sectionId: string | null;
  classId: string | null;
  subjectGroupId: string | null;
  subject: string;
  /** The exam's accountable teacher — keeps the exam once its section is emptied. */
  teacherId?: string | null;
}

export function isGroupAnchored(test: AnchoredTest): boolean {
  return !!test.subjectGroupId;
}

/** A section that no longer holds any active student — the combined C4/C5 sections
 *  after the 2026-10-01 boys/girls split, or a merge's source sections. */
async function isEmptiedSection(sectionId: string): Promise<boolean> {
  return (await Student.countDocuments({ sectionId, active: true })) === 0;
}

/**
 * Run a section-scope check, letting the exam's OWN teacher through when its section
 * has since been emptied (owner report 2026-10-04). A split/merge moves the students
 * and ends the old section's routine rows, which expires the teacher's grant on it —
 * so an exam sat before the split, whose marks were not yet in, became unopenable for
 * the very teacher who has to enter them ("Something went wrong" on Science Test #4).
 * Narrow on purpose: only the exam's teacher, only when nobody sits in that section.
 */
async function withEmptiedSectionOwner(
  ctx: AppContext,
  test: AnchoredTest,
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
  } catch (err) {
    if (
      err instanceof ForbiddenError &&
      test.sectionId &&
      test.teacherId &&
      ctx.auth?.userId === test.teacherId &&
      (await isEmptiedSection(test.sectionId))
    ) {
      return;
    }
    throw err;
  }
}

/** Staff READ scope on the exam's unit. Principal/Office are unscoped, as before. */
export async function assertAnchorRead(ctx: AppContext, test: AnchoredTest): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdminStaff(ctx.auth)) return;
  if (test.subjectGroupId) {
    if (!(await teachesSubjectGroup(ctx.auth.userId, test.subjectGroupId, test.subject))) {
      throw new ForbiddenError();
    }
    return;
  }
  const { sectionId, classId } = test;
  if (!sectionId || !classId) throw new ForbiddenError();
  await withEmptiedSectionOwner(ctx, test, () => assertCanRead(ctx, sectionId, classId));
}

/**
 * WRITE scope on the exam's unit (create-adjacent actions, result entry, publish).
 * `subjectId` is only needed by the section path — a group grant does not exist to
 * be subject-scoped; the routine slot already carries the subject.
 */
export async function assertAnchorWrite(
  ctx: AppContext,
  test: AnchoredTest,
  subjectId: () => Promise<string>,
  action?: DelegatedAction,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (test.subjectGroupId) {
    if (ctx.auth.role === "PRINCIPAL") return;
    if (ctx.auth.role === "OFFICE" || ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
    if (!(await teachesSubjectGroup(ctx.auth.userId, test.subjectGroupId, test.subject))) {
      throw new ForbiddenError();
    }
    return;
  }
  const { sectionId } = test;
  if (!sectionId) throw new ForbiddenError();
  const subject = await subjectId();
  await withEmptiedSectionOwner(ctx, test, () => assertCanWrite(ctx, sectionId, subject, action));
}

/**
 * The students who sat this exam — the denominator for "complete" and the roster
 * the marks screen lists.
 *
 * Section anchor: the section's active students — or, once that section has been
 * emptied by a split/merge, who sat it (see `emptiedSectionRoster`). Group anchor: the
 * group's ACTIVE members, which is the whole point — those students come from
 * several sections and classes, and the section rosters they belong to are the
 * wrong answer in both directions (they include children who do not attend this
 * group, and exclude group members from other sections).
 */
export async function rosterStudentIds(test: AnchoredTest): Promise<string[]> {
  return (await resolveRoster(test)).ids;
}

/** The roster plus whether it came from an emptied section's fallback (the marks
 *  screen then names each child's CURRENT section, as it does for a group exam). */
async function resolveRoster(test: AnchoredTest): Promise<{ ids: string[]; movedOn: boolean }> {
  if (test.subjectGroupId) {
    const memberships = (await SubjectGroupMembership.find({
      groupId: new Types.ObjectId(test.subjectGroupId),
    })
      .select("studentId")
      .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
    if (memberships.length === 0) return { ids: [], movedOn: false };
    const ids = memberships.map((m) => m.studentId);
    const students = (await Student.find({ _id: { $in: ids }, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
    return { ids: students.map((s) => s._id.toString()), movedOn: false };
  }
  const students = (await Student.find({ sectionId: test.sectionId, active: true })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  if (students.length > 0 || !test.sectionId || !test.classId) {
    return { ids: students.map((s) => s._id.toString()), movedOn: false };
  }
  return { ids: await emptiedSectionRoster(test.sectionId, test.classId), movedOn: true };
}

/**
 * Who sat an exam whose section has since been emptied (owner report 2026-10-04).
 * Students carry no section history, so this is reconstructed:
 *   - a MERGE source section (D-#62) — the merge snapshot names exactly who left it;
 *   - otherwise (a split, e.g. the combined C4/C5 sections on 2026-10-01, which moved
 *     everyone into the class's new boys/girls sections) — the class's active students.
 * Without it the marks screen listed nobody, so a pre-split exam could never be scored.
 */
async function emptiedSectionRoster(sectionId: string, classId: string): Promise<string[]> {
  const merge = (await SectionMerge.findOne({ sourceSectionIds: new Types.ObjectId(sectionId) })
    .sort({ mergedAt: -1 })
    .select("moves")
    .lean()) as unknown as { moves: Array<{ studentId: Types.ObjectId; fromSectionId: Types.ObjectId }> } | null;
  const filter = merge
    ? { _id: { $in: merge.moves.filter((m) => m.fromSectionId.toString() === sectionId).map((m) => m.studentId) } }
    : { classId: new Types.ObjectId(classId) };
  const students = (await Student.find({ ...filter, active: true })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return students.map((s) => s._id.toString());
}

/**
 * The roster as the marks screen needs it: name + school id, plus — on a GROUP exam
 * only — which section each child comes from. A group mixes 2–4 classes, so without
 * that column a teacher marking eleven children has no way to tell two Fatimas
 * apart. On a section exam the column would repeat the header, so it stays null.
 */
export async function classTestRosterStudents(test: AnchoredTest): Promise<
  Array<{ id: string; schoolId: string; name: string; nameBn: string | null; sectionNameBn: string | null }>
> {
  const { ids, movedOn } = await resolveRoster(test);
  if (ids.length === 0) return [];
  const students = (await Student.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select("schoolId name nameBn sectionId")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    schoolId: string;
    name: string;
    nameBn?: string | null;
    sectionId?: Types.ObjectId | null;
  }>;

  let sectionNames = new Map<string, string>();
  // An emptied section's roster spans the class's new sections, so name them too.
  if (test.subjectGroupId || movedOn) {
    const sectionIds = [...new Set(students.filter((s) => s.sectionId).map((s) => s.sectionId!.toString()))];
    const sections = sectionIds.length
      ? ((await Section.find({ _id: { $in: sectionIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn code classId")
          .lean()) as unknown as Array<{
          _id: Types.ObjectId;
          nameBn?: string;
          code?: string;
          classId?: Types.ObjectId;
        }>)
      : [];
    // The class label is what actually distinguishes them (every class has a "মূল"
    // section, D-#1), so the label is "class · section".
    const classIds = [...new Set(sections.filter((s) => s.classId).map((s) => s.classId!.toString()))];
    const classes = classIds.length
      ? ((await Class.find({ _id: { $in: classIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn level")
          .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string; level?: number }>)
      : [];
    const classById = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? ""]));
    sectionNames = new Map(
      sections.map((s) => {
        const cls = s.classId ? classById.get(s.classId.toString()) ?? "" : "";
        const sec = s.nameBn || s.code || "";
        return [s._id.toString(), [cls, sec].filter(Boolean).join(" · ")];
      }),
    );
  }

  return students
    .map((s) => ({
      id: s._id.toString(),
      schoolId: s.schoolId,
      name: s.name,
      nameBn: s.nameBn ?? null,
      sectionNameBn: s.sectionId ? sectionNames.get(s.sectionId.toString()) ?? null : null,
    }))
    .sort((a, b) => (a.sectionNameBn ?? "").localeCompare(b.sectionNameBn ?? "") || a.name.localeCompare(b.name));
}

/** Just the count — the completion denominator, without shipping the ids. */
export async function rosterCount(test: AnchoredTest): Promise<number> {
  if (test.subjectGroupId) return (await rosterStudentIds(test)).length;
  return Student.countDocuments({ sectionId: test.sectionId, active: true });
}

/** The unit's Bangla name for display (group name, or null for a section — the
 *  callers that show a section already resolve class+section labels themselves). */
export async function groupNameBn(test: AnchoredTest): Promise<string | null> {
  if (!test.subjectGroupId) return null;
  const g = (await SubjectGroup.findById(test.subjectGroupId).select("nameBn").lean()) as {
    nameBn: string;
  } | null;
  return g?.nameBn ?? null;
}
