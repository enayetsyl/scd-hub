/**
 * AuditQueryService (owner ask 2026-07-20) — the Principal's read over the
 * append-only audit log (ADR-008). Pure read: newest first, cursor-paged by
 * eventAt, optional eventKind/actorRole filters, actor names joined from BOTH
 * identity collections (staff Users and Guardians). Rows are returned with the
 * meta serialized to JSON — the viewer renders it verbatim.
 */
import { Types } from "mongoose";
import { Audit, type IAudit } from "../models/Audit";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";
import { auditKindLabel, type ActivityGroup } from "../auditLabels";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const AUDIT_PAGE_LIMIT_DEFAULT = 50;
export const AUDIT_PAGE_LIMIT_MAX = 200;

export interface AuditRowShape {
  id: string;
  eventKind: string;
  /** The kind's readable name + family (AL-1, D-#645) — resolved server-side so
   *  there is no app-side mirror to fall out of date with the union. */
  labelBn: string;
  labelEn: string;
  group: ActivityGroup;
  eventAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  /** "View as" rows only (D-#638): the account the Principal acted through. */
  onBehalfOfId: string | null;
  onBehalfOfName: string | null;
  targetKind: string | null;
  targetId: string | null;
  metaJson: string | null;
}

export interface AuditLogInput {
  /** Return rows strictly OLDER than this ISO instant (cursor for load-more). */
  before?: string | null;
  limit?: number | null;
  eventKind?: string | null;
  actorRole?: string | null;
  /** One person's rows — their own AND anything done through their account in a
   *  "View as" session (D-#638), which is the same pair `personActivity` uses. */
  actorId?: string | null;
  /** Dhaka calendar days, inclusive (AL-1, D-#645). Independent of `before`:
   *  the cursor still pages WITHIN the window. */
  from?: string | null;
  to?: string | null;
}

export async function auditLog(input: AuditLogInput = {}): Promise<AuditRowShape[]> {
  const limit = Math.min(Math.max(input.limit ?? AUDIT_PAGE_LIMIT_DEFAULT, 1), AUDIT_PAGE_LIMIT_MAX);
  const q: Record<string, unknown> = {};
  // `before` (the cursor) and from/to (the window) are ANDed onto one eventAt
  // clause — writing them as two keys would silently drop the earlier one.
  const eventAt: Record<string, Date> = {};
  const cursor = input.before ? new Date(input.before) : null;
  const windowEnd =
    input.to && DAY_RE.test(input.to) ? new Date(new Date(`${input.to}T23:59:59.999+06:00`).getTime() + 1) : null;
  // The upper bound is whichever of the two is tighter, so changing the range
  // mid-scroll cannot page a stale cursor back outside the window.
  const upper = [cursor, windowEnd].filter((d): d is Date => d != null && !Number.isNaN(d.getTime()));
  if (upper.length > 0) eventAt.$lt = new Date(Math.min(...upper.map((d) => d.getTime())));
  if (input.from && DAY_RE.test(input.from)) {
    const at = new Date(`${input.from}T00:00:00.000+06:00`);
    if (!Number.isNaN(at.getTime())) eventAt.$gte = at;
  }
  if (Object.keys(eventAt).length > 0) q.eventAt = eventAt;
  if (input.eventKind) q.eventKind = input.eventKind;
  if (input.actorRole) q.actorRole = input.actorRole;
  if (input.actorId && Types.ObjectId.isValid(input.actorId)) {
    const id = new Types.ObjectId(input.actorId);
    q.$or = [{ actorId: id }, { onBehalfOf: id }];
  }

  const rows = (await Audit.find(q)
    .sort({ eventAt: -1 })
    .limit(limit)
    .lean()) as unknown as IAudit[];

  // Actor names: staff live in Users, guardians in Guardians — try both.
  // Both ids resolve through the same lookup: on a "View as" row the actor is the
  // Principal and `onBehalfOf` is the borrowed account, so the viewer can read
  // "<Principal> (as <teacher>)" without a second query (D-#638).
  const actorIds = [
    ...new Set(
      rows.flatMap((r) => [r.actorId?.toString(), r.onBehalfOf?.toString()]).filter(Boolean),
    ),
  ] as string[];
  const [users, guardians] = await Promise.all([
    User.find({ _id: { $in: actorIds } }).select("name").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name?: string }>
    >,
    Guardian.find({ _id: { $in: actorIds } }).select("name").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name?: string }>
    >,
  ]);
  const nameById = new Map<string, string>();
  for (const u of users) if (u.name) nameById.set(u._id.toString(), u.name);
  for (const g of guardians) if (g.name && !nameById.has(g._id.toString())) nameById.set(g._id.toString(), g.name);

  return rows.map((r) => {
    const label = auditKindLabel(r.eventKind);
    return {
    id: r._id.toString(),
    eventKind: r.eventKind,
    labelBn: label.bn,
    labelEn: label.en,
    group: label.group,
    eventAt: new Date(r.eventAt).toISOString(),
    actorId: r.actorId ? r.actorId.toString() : null,
    actorName: r.actorId ? nameById.get(r.actorId.toString()) ?? null : null,
    actorRole: r.actorRole ?? null,
    onBehalfOfId: r.onBehalfOf ? r.onBehalfOf.toString() : null,
    onBehalfOfName: r.onBehalfOf ? nameById.get(r.onBehalfOf.toString()) ?? null : null,
    targetKind: r.targetKind ?? null,
    targetId: r.targetId ? r.targetId.toString() : null,
    metaJson: r.meta && Object.keys(r.meta).length > 0 ? JSON.stringify(r.meta) : null,
    };
  });
}
