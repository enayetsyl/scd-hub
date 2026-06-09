import type { Types } from "mongoose";
import { ScopeGrant } from "../models/ScopeGrant";
import { writeAudit } from "../../platform/services/AuditService";

// ---------------------------------------------------------------------------
// Proxy window helpers (D-#20)
// ---------------------------------------------------------------------------

const DHAKA_TZ = "Asia/Dhaka";

/** Day-start of a date in Asia/Dhaka time, returned as UTC Date.
 *  We approximate by flooring to the UTC midnight of the local date string. */
function dhakaDateStart(d: Date): Date {
  const localStr = d.toLocaleDateString("en-CA", { timeZone: DHAKA_TZ }); // YYYY-MM-DD
  return new Date(`${localStr}T00:00:00+06:00`);
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
      const pg = g as { startDate?: Date; durationDays?: number; proxyStatus?: string; classId?: Types.ObjectId; sectionId?: Types.ObjectId };
      if (pg.proxyStatus === "revoked") continue;
      if (!pg.startDate || pg.durationDays === undefined) continue;

      if (isProxyActive(pg.startDate, pg.durationDays, now)) {
        scopes.push({
          kind: "proxy",
          classId: pg.classId!.toString(),
          sectionId: pg.sectionId!.toString(),
          grantId: g._id.toString(),
        });
      } else {
        // Window has elapsed — record for audit stamping (D-#21)
        expiredProxyGrantIds.push(g._id.toString());
      }
    }
  }

  return { scopes, expiredProxyGrantIds };
}

// ---------------------------------------------------------------------------
// Row-scope predicates (used by resolver middleware)
// ---------------------------------------------------------------------------

/** Can a teacher READ the given section? Teaching or supervisory or active proxy. */
export function canRead(scopes: ScopeItem[], sectionId: string, classId: string, subjectId?: string): boolean {
  for (const s of scopes) {
    if (s.kind === "teaching" && s.sectionId === sectionId) return true;
    if (s.kind === "proxy" && s.sectionId === sectionId) return true;
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
 *  Supervisory is read-only — write = teaching or active proxy only (D-#17/#18). */
export function canWrite(scopes: ScopeItem[], sectionId: string): boolean {
  return scopes.some(
    (s) =>
      (s.kind === "teaching" || s.kind === "proxy") && s.sectionId === sectionId,
  );
}

// ---------------------------------------------------------------------------
// Grant lifecycle mutations (D-#20)
// ---------------------------------------------------------------------------

export interface AssignProxyInput {
  coveringTeacherId: string;
  absentTeacherId?: string;
  classId: string;
  sectionId: string;
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
