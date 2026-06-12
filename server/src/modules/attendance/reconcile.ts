/**
 * Staff name reconciliation (AT1.2, D-#67). The biometric export omits the ID
 * column, so rows are matched by NAME against active StaffProfiles, with
 * remembered StaffNameAlias mappings as the override. Pure: callers (the
 * service) load the candidates; this module only decides.
 *
 * Resolution order per row name:
 *   1. an alias mapping (explicit, remembered) wins;
 *   2. else a UNIQUE active-profile name match;
 *   3. else unmatched (ambiguous or unknown) — held for the Admin, never
 *      silently dropped (AT1.2).
 *
 * If the export ever regains its ID column, the importer should match on
 * `StaffProfile.schoolId` directly — name match is the fallback path (§4).
 */

/** Normalize a display name for matching: NFC, lowercase, collapsed whitespace. */
export function normalizeName(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface StaffCandidate {
  id: string;
  name: string;
}

export type NameMatch =
  | { kind: "matched"; staffProfileId: string; via: "name" | "alias" }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "unknown" };

/**
 * Match one normalized name. `byName` maps normalized profile name → profile ids
 * (a list — duplicates make the name ambiguous); `aliases` maps normalized alias
 * → profile id.
 */
export function matchName(
  norm: string,
  byName: Map<string, string[]>,
  aliases: Map<string, string>,
): NameMatch {
  const aliasHit = aliases.get(norm);
  if (aliasHit) return { kind: "matched", staffProfileId: aliasHit, via: "alias" };
  const ids = byName.get(norm) ?? [];
  if (ids.length === 1) return { kind: "matched", staffProfileId: ids[0], via: "name" };
  if (ids.length > 1) return { kind: "ambiguous", candidateIds: ids };
  return { kind: "unknown" };
}

/** Build the normalized name → ids index from active profiles. */
export function indexProfilesByName(profiles: StaffCandidate[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const p of profiles) {
    const norm = normalizeName(p.name);
    const list = byName.get(norm);
    if (list) list.push(p.id);
    else byName.set(norm, [p.id]);
  }
  return byName;
}
