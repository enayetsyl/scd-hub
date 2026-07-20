/**
 * Audit-log viewer operations (owner ask 2026-07-20) — Principal-only read
 * (audit:read) over the append-only audit log (ADR-008).
 */
import { gql } from "urql";

export interface AuditRowT {
  id: string;
  eventKind: string;
  eventAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  targetKind: string | null;
  targetId: string | null;
  metaJson: string | null;
}

export const AUDIT_LOG_QUERY = gql<
  { auditLog: AuditRowT[] },
  { before?: string | null; limit?: number | null; eventKind?: string | null; actorRole?: string | null }
>`
  query AuditLog($before: String, $limit: Int, $eventKind: String, $actorRole: String) {
    auditLog(before: $before, limit: $limit, eventKind: $eventKind, actorRole: $actorRole) {
      id eventKind eventAt actorId actorName actorRole targetKind targetId metaJson
    }
  }
`;
