import type { Types } from "mongoose";
import { ScopeGrant, type SupervisoryExtent } from "../models/ScopeGrant";
import { Section } from "../models/Section";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayStart } from "../../../lib/dhakaDay";

// ---------------------------------------------------------------------------
// Proxy window helpers (D-#20)
// ---------------------------------------------------------------------------

/** Day-start of a date in Asia/Dhaka time, returned as UTC Date (shared helper, D-#338). */
function dhakaDateStart(d: Date): Date {
  return dhakaDayStart(d);
}

/** Compute the exclusive window end: start_date + durationDays in Dhaka time. */
export function proxyWindowEnd(startDate: Date, durationDays: number): Date {
  const start = dhakaDateStart(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);
  return end;
}

/** True if `now` is within [startDate, startDate + durationDays) in Dhaka time. */
export function isProxyActive(startDate: Date, durationDays: number, now: Date = new Date()): boolean {
  const start = dhakaDateStart(startDate);
  const end = proxyWindowEnd(startDate, durationDays);
  return now >= start && now < end;
}

/** True iff the window has actually ELAPSED (`now >= end`) — distinct from merely
 *  "not active", which is also true before the window has even started. Conflating
 *  the two (bug, fixed here) permanently killed a future-dated grant the instant
 *  anyone resolved that teacher's scope, before it ever got a chance to activate. */
export function isProxyExpired(startDate: Date, durationDays: number, now: Date = new Date()): boolean {
  return now >= proxyWindowEnd(startDate, durationDays);
}

// ---------------------------------------------------------------------------
// Grant composition — resolver middleware reads this (ADR-017)
// ---------------------------------------------------------------------------

export interface TeachingScope {
  kind: "teaching";
  classId: string;
  sectionId: string;
  subjectId: string;
}

export interface SupervisoryScope {
  kind: "supervisory";
  extent: string;
  classId?: string;
  subjectId?: string;
  explicitSet?: Array<{ classId: string; subjectId: string }>;
}

export interface ProxyScope {
  kind: "proxy";
  classId: string;
  sectionId: string;
  /** The covered subject (D-#257) — content read is scoped to this subject + class only. */
  subjectId?: string;
  grantId: string;
}

export type ScopeItem = TeachingScope | SupervisoryScope | ProxyScope;

/** Compose the effective scope union for a teacher (ADR-017).
 *  Proxy grants are validated for the window at request time (D-#20).
 *  Returns { scopes, expiredProxyGrantIds } — callers audit expired grants. */
export async function composeTeacherScope(
  teacherId: string,
  now: Date = new Date(),
): Promise<{ scopes: ScopeItem[]; expiredProxyGrantIds: string[] }> {
  const grants = await ScopeGrant.find({
    teacherId,
    active: true,
  }).lean();

  const scopes: ScopeItem[] = [];
  const expiredProxyGrantIds: string[] = [];

  for (const g of grants) {
    if (g.kind === "teaching") {
      scopes.push({
        kind: "teaching",
        classId: g.classId!.toString(),
        sectionId: g.sectionId!.toString(),
        subjectId: (g as { subjectId?: Types.ObjectId }).subjectId!.toString(),
      });
    } else if (g.kind === "supervisory") {
      const sg = g as { extent?: string; classId?: Types.ObjectId; subjectId?: Types.ObjectId; explicitSet?: Array<{ classId: Types.ObjectId; subjectId: Types.ObjectId }> };
      scopes.push({
        kind: "supervisory",
        extent: sg.extent!,
        classId: sg.classId?.toString(),
        subjectId: sg.subjectId?.toString(),
        explicitSet: sg.explicitSet?.map((e) => ({
          classId: e.classId.toString(),
          subjectId: e.subjectId.toString(),
        })),
      });
    } else if (g.kind === "proxy") {
      const pg = g as { startDate?: Date; durationDays?: number; proxyStatus?: string; classId?: Types.ObjectId; sectionId?: Types.ObjectId; subjectId?: Types.ObjectId };
      if (pg.proxyStatus === "revoked") continue;
      if (!pg.startDate || pg.durationDays === undefined) continue;

      if (isProxyActive(pg.startDate, pg.durationDays, now)) {
        scopes.push({
          kind: "proxy",
          classId: pg.classId!.toString(),
          sectionId: pg.sectionId!.toString(),
          subjectId: pg.subjectId?.toString(),
          grantId: g._id.toString(),
        });
      } else if (isProxyExpired(pg.startDate, pg.durationDays, now)) {
        // Window has elapsed — record for audit stamping (D-#21)
        expiredProxyGrantIds.push(g._id.toString());
      }
      // else: not yet started (now < startDate) — correctly withheld from today's
      // scope, but NOT expired; leave the grant alone so it activates on schedule.
    }
  }

  return { scopes, expiredProxyGrantIds };
}

// ---------------------------------------------------------------------------
// GraphQL view mapping (myScopes / proxyGrants lookups)
// ---------------------------------------------------------------------------

/** Flat, client-facing view of a grant: every ObjectId stringified, dates ISO.
 *  Slice-4 follow-up — myScopes returns class/section/subject ids so the app's
 *  section picker can offer the teacher's own sections; the proxy fields drive
 *  the admin grant list (no more pasted GRANT_IDs). */
export interface ScopeGrantView {
  id: string;
  kind: string;
  active: boolean;
  teacherId: string | null;
  classId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  coveringTeacherId: string | null;
  absentTeacherId: string | null;
  startDate: string | null;
  durationDays: number | null;
  proxyStatus: string | null;
  // supervisory-only detail (null on teaching/proxy grants)
  extent: string | null;
  explicitSet: Array<{ classId: string; subjectId: string }> | null;
}

/** A lean ScopeGrant doc, loosely typed (the union hides optional fields). */
interface LeanGrant {
  _id: { toString(): string };
  kind: string;
  active: boolean;
  teacherId?: { toString(): string } | null;
  classId?: { toString(): string } | null;
  sectionId?: { toString(): string } | null;
  subjectId?: { toString(): string } | null;
  coveringTeacherId?: { toString(): string } | null;
  absentTeacherId?: { toString(): string } | null;
  startDate?: Date | null;
  durationDays?: number | null;
  proxyStatus?: string | null;
  extent?: string | null;
  explicitSet?: Array<{ classId?: { toString(): string }; subjectId?: { toString(): string } }> | null;
}

/** Pure mapper: lean grant doc → ScopeGrantView. */
export function grantView(g: LeanGrant): ScopeGrantView {
  return {
    id: g._id.toString(),
    kind: g.kind,
    active: g.active,
    teacherId: g.teacherId ? g.teacherId.toString() : null,
    classId: g.classId ? g.classId.toString() : null,
    sectionId: g.sectionId ? g.sectionId.toString() : null,
    subjectId: g.subjectId ? g.subjectId.toString() : null,
    coveringTeacherId: g.coveringTeacherId ? g.coveringTeacherId.toString() : null,
    absentTeacherId: g.absentTeacherId ? g.absentTeacherId.toString() : null,
    startDate: g.startDate ? new Date(g.startDate).toISOString() : null,
    durationDays: g.durationDays ?? null,
    proxyStatus: g.proxyStatus ?? null,
    extent: g.extent ?? null,
    explicitSet: g.explicitSet
      ? g.explicitSet.map((e) => ({
          classId: e.classId ? e.classId.toString() : "",
          subjectId: e.subjectId ? e.subjectId.toString() : "",
        }))
      : null,
  };
}

// ---------------------------------------------------------------------------
// Row-scope predicates (used by resolver middleware)
// ---------------------------------------------------------------------------

/** Can a teacher READ the given section? Teaching or supervisory or active proxy. */
export function canRead(scopes: ScopeItem[], sectionId: string, classId: string, subjectId?: string): boolean {
  for (const s of scopes) {
    if (s.kind === "teaching" && s.sectionId === sectionId) return true;
    if (s.kind === "proxy" && s.sectionId === sectionId) {
      if (!subjectId) return true;
      if (!s.subjectId || s.subjectId === subjectId) return true;
    }
    if (s.kind === "supervisory") {
      switch (s.extent) {
        case "whole_school": return true;
        case "grade_class": if (s.classId === classId) return true; break;
        case "subject_dept": if (subjectId && s.subjectId === subjectId) return true; break;
        case "explicit_set":
          if (s.explicitSet?.some((e) => e.classId === classId && (!subjectId || e.subjectId === subjectId))) return true;
          break;
      }
    }
  }
  return false;
}

/** Can a teacher WRITE (assemble sets / fill tracker) for the given section?
 *  Supervisory is read-only — write = teaching or active proxy only (D-#17/#18).
 *  A teaching grant is per-(section, subject) (ADR-017), so when the action names
 *  a subject the grant must match it — a Science teacher cannot check/transition
 *  English homework. Subject-less calls keep the section-wide behaviour. */
export function canWrite(scopes: ScopeItem[], sectionId: string, subjectId?: string): boolean {
  return scopes.some((s) => {
    if (s.kind === "teaching") {
      if (s.sectionId !== sectionId) return false;
      return !subjectId || s.subjectId === subjectId;
    }
    if (s.kind !== "proxy" || s.sectionId !== sectionId) {
      return false;
    }
    if (!subjectId) {
      return true;
    }
    return !s.subjectId || s.subjectId === subjectId;
  });
}

// ---------------------------------------------------------------------------
// Grant lifecycle mutations (D-#20)
// ---------------------------------------------------------------------------

export interface AssignProxyInput {
  coveringTeacherId: string;
  absentTeacherId?: string;
  classId: string;
  sectionId: string;
  /** The covered slot's subject (a cover is per-subject, D-#257) — scopes content read
   *  to that subject only, not the whole class. Absent for non-content-subject covers. */
  subjectId?: string;
  startDate: Date;
  durationDays: number;
  assignedBy: string;
}

export async function assignProxy(input: AssignProxyInput): Promise<string> {
  const grant = await ScopeGrant.create({
    teacherId: input.coveringTeacherId,
    kind: "proxy",
    active: true,
    coveringTeacherId: input.coveringTeacherId,
    absentTeacherId: input.absentTeacherId,
    classId: input.classId,
    sectionId: input.sectionId,
    subjectId: input.subjectId,
    startDate: input.startDate,
    durationDays: input.durationDays,
    proxyStatus: "active",
    createdBy: input.assignedBy,
  });

  await writeAudit({
    eventKind: "SCOPE_GRANT_ASSIGN",
    actorId: input.assignedBy,
    targetId: grant._id,
    targetKind: "ProxyGrant",
    meta: {
      coveringTeacherId: input.coveringTeacherId,
      classId: input.classId,
      sectionId: input.sectionId,
      durationDays: input.durationDays,
      startDate: input.startDate.toISOString(),
    },
  });

  return grant._id.toString();
}

/**
 * Revoke ALL active scope grants (teaching / supervisory / proxy) for a user — the
 * offboarding access-revocation step (HR-5/H6.3). Each revoked grant is audited
 * (`SCOPE_GRANT_REVOKE`, reusing the existing lifecycle event). Idempotent: a user
 * with no active grants revokes nothing and returns 0. Returns the count revoked.
 */
export async function revokeAllGrantsForUser(userId: string, revokedBy: string): Promise<number> {
  const grants = await ScopeGrant.find({ teacherId: userId, active: true }).select("_id kind").lean();
  for (const g of grants) {
    const patch: Record<string, unknown> = { active: false };
    if (g.kind === "proxy") patch.proxyStatus = "revoked";
    await ScopeGrant.findByIdAndUpdate(g._id, patch);
    await writeAudit({
      eventKind: "SCOPE_GRANT_REVOKE",
      actorId: revokedBy,
      targetId: g._id,
      targetKind: g.kind === "proxy" ? "ProxyGrant" : "ScopeGrant",
      meta: { reason: "offboarding_access_revoked", kind: g.kind },
    });
  }
  return grants.length;
}

export async function revokeProxy(grantId: string, revokedBy: string): Promise<void> {
  await ScopeGrant.findByIdAndUpdate(grantId, { proxyStatus: "revoked", active: false });
  await writeAudit({
    eventKind: "SCOPE_GRANT_REVOKE",
    actorId: revokedBy,
    targetId: grantId,
    targetKind: "ProxyGrant",
  });
}

export interface ExtendProxyInput {
  grantId: string;
  additionalDays: number;
  extendedBy: string;
}

export async function extendProxy(input: ExtendProxyInput): Promise<void> {
  const grant = await ScopeGrant.findById(input.grantId);
  if (!grant || grant.kind !== "proxy") throw new Error("Proxy grant not found");

  const pg = grant as unknown as { durationDays: number };
  const newDuration = pg.durationDays + input.additionalDays;
  await ScopeGrant.findByIdAndUpdate(input.grantId, { durationDays: newDuration });

  await writeAudit({
    eventKind: "SCOPE_GRANT_EXTEND",
    actorId: input.extendedBy,
    targetId: input.grantId,
    targetKind: "ProxyGrant",
    meta: { additionalDays: input.additionalDays, newDuration },
  });
}

// ---------------------------------------------------------------------------
// Teaching-grant lifecycle (subject-teacher assignment) — gated user:manage.
// A teaching grant = teacher teaches one subject in one section (ADR-017). The
// classId is derived from the section so the caller only passes section+subject.
// ---------------------------------------------------------------------------

export interface GrantTeachingInput {
  teacherId: string;
  sectionId: string;
  subjectId: string;
  assignedBy: string;
}

/** Assign (or reactivate) a teaching grant. Idempotent on
 *  (teacher, section, subject): a revoked grant is reactivated, never duplicated. */
export async function grantTeaching(input: GrantTeachingInput): Promise<string> {
  const section = await Section.findById(input.sectionId).select("classId").lean();
  if (!section) throw new Error("Section not found");
  const classId = section.classId.toString();

  const existing = await ScopeGrant.findOne({
    teacherId: input.teacherId,
    kind: "teaching",
    sectionId: input.sectionId,
    subjectId: input.subjectId,
  });

  let grantId: string;
  if (existing) {
    if (!existing.active) {
      existing.active = true;
      await existing.save();
    }
    grantId = existing._id.toString();
  } else {
    const grant = await ScopeGrant.create({
      teacherId: input.teacherId,
      kind: "teaching",
      active: true,
      classId,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      createdBy: input.assignedBy,
    });
    grantId = grant._id.toString();
  }

  await writeAudit({
    eventKind: "SCOPE_GRANT_ASSIGN",
    actorId: input.assignedBy,
    targetId: grantId,
    targetKind: "TeachingGrant",
    meta: { teacherId: input.teacherId, classId, sectionId: input.sectionId, subjectId: input.subjectId, kind: "teaching" },
  });

  return grantId;
}

/** Revoke a teaching grant (sets active=false; idempotent). */
export async function revokeTeaching(grantId: string, revokedBy: string): Promise<void> {
  const grant = await ScopeGrant.findById(grantId);
  if (!grant || grant.kind !== "teaching") throw new Error("Teaching grant not found");
  await ScopeGrant.findByIdAndUpdate(grantId, { active: false });
  await writeAudit({
    eventKind: "SCOPE_GRANT_REVOKE",
    actorId: revokedBy,
    targetId: grantId,
    targetKind: "TeachingGrant",
    meta: { kind: "teaching" },
  });
}

/** Active teaching grants for a section (the subject-teacher roster), newest first. */
export async function teachingGrantsForSection(sectionId: string): Promise<ScopeGrantView[]> {
  const grants = await ScopeGrant.find({ kind: "teaching", sectionId, active: true }).sort({ createdAt: -1 }).lean();
  return grants.map(grantView);
}

// ---------------------------------------------------------------------------
// Supervisory-grant lifecycle (read-oversight extents) — gated user:manage.
// A supervisory grant gives a teacher READ visibility (content + section trackers)
// at a configurable extent (ADR-017 / D-#17): whole_school (all), subject_dept
// (one subject across every class), grade_class (one class level across every
// subject), or explicit_set (a hand-picked set of (class, subject) pairs). It is
// READ-ONLY — canWrite ignores supervisory grants (D-#17). The model + canRead +
// contentScope already honour these extents; D-#262 just exposes the CRUD.
// ---------------------------------------------------------------------------

export interface SupervisoryPair {
  classId: string;
  subjectId: string;
}

export interface GrantSupervisoryInput {
  teacherId: string;
  extent: SupervisoryExtent;
  /** Required for subject_dept. */
  subjectId?: string;
  /** Required for grade_class. */
  classId?: string;
  /** Required (non-empty) for explicit_set. */
  explicitSet?: SupervisoryPair[];
  assignedBy: string;
}

/** Pure validation of a supervisory-grant request — each extent's required args.
 *  Returns an English error string, or null when valid (testable without a DB). */
export function validateSupervisoryGrant(input: {
  extent: string;
  subjectId?: string | null;
  classId?: string | null;
  explicitSet?: SupervisoryPair[] | null;
}): string | null {
  switch (input.extent) {
    case "whole_school":
      return null;
    case "subject_dept":
      return input.subjectId ? null : "subject_dept extent requires a subject";
    case "grade_class":
      return input.classId ? null : "grade_class extent requires a class";
    case "explicit_set":
      if (!input.explicitSet || input.explicitSet.length === 0)
        return "explicit_set extent requires at least one (class, subject) pair";
      if (input.explicitSet.some((e) => !e.classId || !e.subjectId))
        return "each explicit_set pair needs both a class and a subject";
      return null;
    default:
      return `unknown supervisory extent: ${input.extent}`;
  }
}

/** Assign (or reactivate) a supervisory grant. The single-target extents
 *  (whole_school / subject_dept / grade_class) are idempotent on
 *  (teacher, extent, target) — a revoked grant is reactivated, never duplicated;
 *  explicit_set always creates (the set may legitimately differ each time). */
export async function grantSupervisory(input: GrantSupervisoryInput): Promise<string> {
  const err = validateSupervisoryGrant(input);
  if (err) throw new Error(err);

  let grantId: string;
  const existing =
    input.extent === "explicit_set"
      ? null
      : await ScopeGrant.findOne({
          teacherId: input.teacherId,
          kind: "supervisory",
          extent: input.extent,
          ...(input.extent === "subject_dept" ? { subjectId: input.subjectId } : {}),
          ...(input.extent === "grade_class" ? { classId: input.classId } : {}),
        });

  if (existing) {
    if (!existing.active) {
      existing.active = true;
      await existing.save();
    }
    grantId = existing._id.toString();
  } else {
    const grant = await ScopeGrant.create({
      teacherId: input.teacherId,
      kind: "supervisory",
      active: true,
      extent: input.extent,
      subjectId: input.extent === "subject_dept" ? input.subjectId : undefined,
      classId: input.extent === "grade_class" ? input.classId : undefined,
      explicitSet: input.extent === "explicit_set" ? input.explicitSet : undefined,
      createdBy: input.assignedBy,
    });
    grantId = grant._id.toString();
  }

  await writeAudit({
    eventKind: "SCOPE_GRANT_ASSIGN",
    actorId: input.assignedBy,
    targetId: grantId,
    targetKind: "SupervisoryGrant",
    meta: {
      teacherId: input.teacherId,
      extent: input.extent,
      subjectId: input.subjectId,
      classId: input.classId,
      pairCount: input.explicitSet?.length,
      kind: "supervisory",
    },
  });

  return grantId;
}

/** Revoke a supervisory grant (sets active=false; idempotent). */
export async function revokeSupervisory(grantId: string, revokedBy: string): Promise<void> {
  const grant = await ScopeGrant.findById(grantId);
  if (!grant || grant.kind !== "supervisory") throw new Error("Supervisory grant not found");
  await ScopeGrant.findByIdAndUpdate(grantId, { active: false });
  await writeAudit({
    eventKind: "SCOPE_GRANT_REVOKE",
    actorId: revokedBy,
    targetId: grantId,
    targetKind: "SupervisoryGrant",
    meta: { kind: "supervisory" },
  });
}

/** Active supervisory grants (the admin oversight list), newest first.
 *  Pass a teacherId to scope to one teacher; omit to list all. */
export async function supervisoryGrants(teacherId?: string): Promise<ScopeGrantView[]> {
  const filter: Record<string, unknown> = { kind: "supervisory", active: true };
  if (teacherId) filter.teacherId = teacherId;
  const grants = await ScopeGrant.find(filter).sort({ createdAt: -1 }).lean();
  return grants.map(grantView);
}

/** Stamp an expiry audit event for a grant that was discovered expired at request time (D-#21). */
export async function stampProxyExpired(
  grantId: string,
  actorId: string,
  windowEndedAt: Date,
): Promise<void> {
  // Mark the DB row as expired so it doesn't appear in future compositions
  await ScopeGrant.findByIdAndUpdate(grantId, { proxyStatus: "expired", active: false });

  await writeAudit({
    eventKind: "PROXY_EXPIRED",
    actorId,
    targetId: grantId,
    targetKind: "ProxyGrant",
    windowEndedAt,
    meta: { detectedAt: new Date().toISOString() },
  });
}
