/**
 * Client-side pseudonym mapping for tracker entries (ux-audit F1 hydration).
 *
 * TrackerRecord entries are de-identified server-side as
 * pseudoStudentId = sha256(studentId) (ADR-005, TrackerService). The staff
 * client already holds the roster (identity plane, read-scoped), so it can
 * compute the same deterministic hash locally to match saved entries back to
 * roster rows — WITHOUT any server resolver that joins pseudonyms to identity
 * (the firewall stays one-way).
 *
 * js-sha256 is pure JS (no native module) so this ships over OTA updates;
 * expo-crypto would have required a new APK.
 */
import { sha256 } from "js-sha256";

/** Deterministic pseudonym for a student — must mirror TrackerService.pseudonymize. */
export function pseudoStudentId(studentId: string): string {
  return sha256(studentId);
}

const cache = new Map<string, string>();

/** Cached variant — rosters re-render often; hashing 30–90 ids once is enough. */
export function pseudoStudentIdCached(studentId: string): string {
  const hit = cache.get(studentId);
  if (hit) return hit;
  const h = sha256(studentId);
  cache.set(studentId, h);
  return h;
}

/** Build pseudoId → studentId lookup for a roster. */
export function buildPseudoMap(studentIds: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of studentIds) map.set(pseudoStudentIdCached(id), id);
  return map;
}
