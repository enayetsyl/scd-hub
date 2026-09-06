/**
 * Audit-log viewer operations (owner ask 2026-07-20) — Principal-only read
 * (audit:read) over the append-only audit log (ADR-008).
 */
import { gql } from "urql";

export interface AuditRowT {
  id: string;
  eventKind: string;
  /** Readable name + family, resolved server-side beside the kind union (AL-1,
   *  D-#645) — there is no app-side mirror to fall out of date. */
  labelBn: string;
  labelEn: string;
  group: string;
  eventAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  /** "View as" rows (D-#638): the account the Principal acted through. */
  onBehalfOfId: string | null;
  onBehalfOfName: string | null;
  targetKind: string | null;
  targetId: string | null;
  metaJson: string | null;
}

export const AUDIT_LOG_QUERY = gql<
  { auditLog: AuditRowT[] },
  {
    before?: string | null;
    limit?: number | null;
    eventKind?: string | null;
    actorRole?: string | null;
    from?: string | null;
    to?: string | null;
  }
>`
  query AuditLog(
    $before: String
    $limit: Int
    $eventKind: String
    $actorRole: String
    $from: String
    $to: String
  ) {
    auditLog(
      before: $before
      limit: $limit
      eventKind: $eventKind
      actorRole: $actorRole
      from: $from
      to: $to
    ) {
      id eventKind labelBn labelEn group eventAt actorId actorName actorRole
      onBehalfOfId onBehalfOfName targetKind targetId metaJson
    }
  }
`;
