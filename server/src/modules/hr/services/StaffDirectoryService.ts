/**
 * StaffDirectoryService (HR-G2, prd-hr §H8.2/H8.3, D-#216/#217) — the PII-free
 * staff directory read that unblocks the H5.2 supervisor observation picker + the
 * chat staff-list.
 *
 * Returns a dedicated **`StaffDirectoryEntry { id, name, nameBn, designation,
 * category }`** — a distinct shape that STRUCTURALLY omits every H1.4 sensitive row
 * (NID/bank/salary/paymentMethod) and all personal bio/contact (dob/parents/spouse/
 * addresses/personal phone), the CT-3 `GuardianClassTestResult` precedent (a separate
 * type that *cannot* leak). The full record stays on the `staff` query (`staff:manage`).
 *
 * Two modes (the FIELD shape is identical PII-free in both — `observableOnly` only
 * narrows WHICH staff are returned, never which fields):
 *   • observableOnly:false → the general list: every active staff member (discovery,
 *     the student-roster posture — any non-Guardian staff caller; NO new permission).
 *   • observableOnly:true  → only the staff the caller may observe. Principal/Office
 *     (`performance:manage`/`staff:manage`) get everyone; a bounded supervisor gets the
 *     teachers assigned (RoutineSlot.teacherId) to a (class, subject) cell their
 *     SUPERVISORY scope covers (`composeTeacherScope`→`supervisoryCovers`, the H5.2
 *     authority). The teacher→StaffProfile hop is the FAIL-CLOSED phone-join
 *     (`resolveStaffProfileForUser`, D-#103/#185): a staff member who doesn't resolve
 *     (shared phone) is excluded from the observable subset but still appears in the
 *     general list — no masquerade, no wrong person.
 *
 * Reverse-join note (the PRD-flagged build risk, resolved): the assignment source is
 * `RoutineSlot` (the actual timetable assignment, "is assigned" — not the teaching
 * ScopeGrant "may teach"). `RoutineSlot.subject` is a ROUTINE_SUBJECTS enum; the
 * supervisory extent's `subjectId` refs the `Subject` collection, which only carries
 * the 5 general codes (BAN/ENG/MATH/SCI/BGS). So slot→subjectId is resolved via a
 * single Subject lookup for those 5; ARABIC/ISLAM/QURAN (and cross-grade subjectgroup
 * slots with no classId) carry no Subject row → they match only a class-based
 * (grade_class) or whole_school supervisory extent, never subject_dept. That matches
 * intent (a MATH subject-lead doesn't supervise an Arabic teacher).
 *
 * Identity/operational plane (StaffProfile/RoutineSlot/Subject); NO corpus path (ADR-005).
 */
import { StaffProfile, type IStaffProfile } from "../../foundation/models/StaffProfile";
import { Subject } from "../../foundation/models/Subject";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import {
  composeTeacherScope,
  type ScopeItem,
} from "../../foundation/services/ScopeGrantService";
import { supervisoryCovers } from "./observationScope";
import { resolveStaffProfileForUser } from "./staffMatch";

/** The PII-free directory shape (the only fields ever exposed — structural omission). */
export interface StaffDirectoryEntryShape {
  id: string;
  name: string;
  nameBn: string | null;
  designation: string | null;
  category: string;
}

function toEntry(s: IStaffProfile): StaffDirectoryEntryShape {
  return {
    id: s._id.toString(),
    name: s.name,
    nameBn: s.nameBn ?? null,
    designation: s.designation ?? null,
    category: s.category,
  };
}

function sortEntries(rows: IStaffProfile[]): StaffDirectoryEntryShape[] {
  return rows
    .map(toEntry)
    .sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)));
}

export interface StaffDirectoryOptions {
  callerUserId: string;
  /** Principal/Office (performance:manage || staff:manage) — sees everyone in both modes. */
  isManage: boolean;
  observableOnly: boolean;
  category?: string | null;
}

/**
 * The staff directory read. GUARDIAN denial + the authenticated gate are enforced in the
 * resolver; this service governs the set + the PII-free shape only.
 */
export async function listStaffDirectory(opts: StaffDirectoryOptions): Promise<StaffDirectoryEntryShape[]> {
  const baseFilter: Record<string, unknown> = { active: true };
  if (opts.category) baseFilter.category = opts.category;

  // The general list, or a privileged observableOnly caller, sees every active staff member.
  if (!opts.observableOnly || opts.isManage) {
    const all = (await StaffProfile.find(baseFilter).lean()) as unknown as IStaffProfile[];
    return sortEntries(all);
  }

  // Bounded supervisor, observableOnly:true — the supervisory-covered subset.
  const { scopes } = await composeTeacherScope(opts.callerUserId);
  const supervisory: ScopeItem[] = scopes.filter((s) => s.kind === "supervisory");
  if (supervisory.length === 0) return []; // fail-closed: no supervisory extent ⇒ nothing observable

  // subject code → Subject._id (foundation subject rows now include Islamic Studies
  // as well as the 5 general subjects; ARABIC/QURAN still remain non-Subject codes).
  const subjects = (await Subject.find({}).lean()) as unknown as { _id: { toString(): string }; code: string }[];
  const codeToSubjectId = new Map<string, string>(subjects.map((s) => [s.code, s._id.toString()]));

  // Every active, assigned, non-break slot — collect the teachers in covered cells.
  const slots = (await RoutineSlot.find({
    active: true,
    isBreak: false,
    teacherId: { $ne: null },
    ...liveWindow(),
  }).lean()) as unknown as {
    teacherId?: { toString(): string } | null;
    classId?: { toString(): string } | null;
    subject: string;
  }[];

  const coveredTeacherIds = new Set<string>();
  for (const slot of slots) {
    if (!slot.teacherId) continue;
    const classId = slot.classId ? slot.classId.toString() : null;
    const subjectId = codeToSubjectId.get(slot.subject) ?? null;
    if (supervisoryCovers(supervisory, classId, subjectId)) {
      coveredTeacherIds.add(slot.teacherId.toString());
    }
  }
  if (coveredTeacherIds.size === 0) return [];

  // Teacher (User) → StaffProfile via the FAIL-CLOSED phone-join; drop the unresolved.
  const byId = new Map<string, IStaffProfile>();
  for (const teacherUserId of coveredTeacherIds) {
    const profile = await resolveStaffProfileForUser(teacherUserId);
    if (!profile) continue; // shared/ambiguous phone ⇒ excluded from the observable subset (no masquerade)
    if (opts.category && profile.category !== opts.category) continue;
    byId.set(profile._id.toString(), profile);
  }
  return sortEntries([...byId.values()]);
}
