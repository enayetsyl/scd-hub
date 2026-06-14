/**
 * ref11 — the PURE REF-11 form validator (CO-1, prd-classroom-observation §5/§2.1,
 * D-#194). No DB, no clock, no I/O — every input is passed in, so the §5 acceptance
 * rules are deterministic + unit-testable (the classTestScoring/vocabScoring posture).
 *
 * The acceptance contract (§5):
 *   - EXACTLY 5 domain levels (1–4), one per OBSERVATION_DOMAIN (D1..D5, no dup), each
 *     with a non-empty note.
 *   - EXACTLY 2 gate results, one per OBSERVATION_GATE (G1,G2, no dup), PASS|BREACH.
 *   - EXACTLY 1 strength + 1 growth focus (both non-empty).
 *   - NO total/average is ever computed or stored — there is no sum here, by design.
 *   - A gate BREACH stands on its own regardless of the domain levels (§2.1): the
 *     validator never couples a gate result to the levels.
 *
 * `validateRef11Payload` THROWS a Ref11ValidationError (Bangla-friendly) on the first
 * violation and otherwise returns the normalised payload (trimmed notes/strings,
 * canonical domain/gate order). The optional carry-forward (`priorFocusProgress`) is
 * validated only when present (it belongs to a re-review, §4).
 */
import {
  OBSERVATION_DOMAINS,
  OBSERVATION_LEVELS,
  OBSERVATION_GATES,
  GATE_RESULTS,
  GROWTH_PROGRESS,
} from "@scd/shared";
import type {
  ObservationDomain,
  ObservationLevel,
  ObservationGate,
  GateResult,
  GrowthProgress,
} from "@scd/shared";

export class Ref11ValidationError extends Error {}

export interface DomainScoreInput {
  domain: string;
  level: number;
  note: string;
}
export interface GateScoreInput {
  gate: string;
  result: string;
  breachNote?: string | null;
}
export interface Ref11PayloadInput {
  domains: DomainScoreInput[];
  gates: GateScoreInput[];
  oneStrength: string;
  growthFocus: string;
  priorFocusProgress?: string | null;
}

export interface DomainScore {
  domain: ObservationDomain;
  level: ObservationLevel;
  note: string;
}
export interface GateScore {
  gate: ObservationGate;
  result: GateResult;
  breachNote: string | null;
}
export interface Ref11Payload {
  domains: DomainScore[];
  gates: GateScore[];
  oneStrength: string;
  growthFocus: string;
  priorFocusProgress: GrowthProgress | null;
}

function nonEmpty(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/**
 * Validate + normalise a REF-11 review payload. Returns the canonical payload
 * (domains in D1..D5 order, gates in G1,G2 order, trimmed text). Throws on any §5
 * violation. NEVER returns or stores a total/average.
 */
export function validateRef11Payload(input: Ref11PayloadInput): Ref11Payload {
  // --- domains: exactly 5, one per domain (no dup), level 1–4, note required ----
  if (!Array.isArray(input.domains) || input.domains.length !== OBSERVATION_DOMAINS.length) {
    throw new Ref11ValidationError(
      `Exactly ${OBSERVATION_DOMAINS.length} domain scores are required (one per domain D1–D5)`,
    );
  }
  const byDomain = new Map<string, DomainScore>();
  for (const d of input.domains) {
    if (!(OBSERVATION_DOMAINS as readonly string[]).includes(d.domain)) {
      throw new Ref11ValidationError(`Unknown domain: ${d.domain}`);
    }
    if (byDomain.has(d.domain)) {
      throw new Ref11ValidationError(`Duplicate domain score: ${d.domain}`);
    }
    if (!(OBSERVATION_LEVELS as readonly number[]).includes(d.level)) {
      throw new Ref11ValidationError(`Domain ${d.domain} level must be one of: ${OBSERVATION_LEVELS.join(", ")}`);
    }
    const note = nonEmpty(d.note);
    if (!note) throw new Ref11ValidationError(`Domain ${d.domain} requires a note`);
    byDomain.set(d.domain, {
      domain: d.domain as ObservationDomain,
      level: d.level as ObservationLevel,
      note,
    });
  }
  // Canonical D1..D5 order; every domain present (length + no-dup + membership ⇒ total).
  const domains = OBSERVATION_DOMAINS.map((dom) => byDomain.get(dom)!);

  // --- gates: exactly 2, one per gate (no dup), PASS|BREACH -----------------------
  // A BREACH stands on its own regardless of the levels (§2.1) — never coupled here.
  if (!Array.isArray(input.gates) || input.gates.length !== OBSERVATION_GATES.length) {
    throw new Ref11ValidationError(
      `Exactly ${OBSERVATION_GATES.length} gate results are required (one per gate G1,G2)`,
    );
  }
  const byGate = new Map<string, GateScore>();
  for (const g of input.gates) {
    if (!(OBSERVATION_GATES as readonly string[]).includes(g.gate)) {
      throw new Ref11ValidationError(`Unknown gate: ${g.gate}`);
    }
    if (byGate.has(g.gate)) {
      throw new Ref11ValidationError(`Duplicate gate result: ${g.gate}`);
    }
    if (!(GATE_RESULTS as readonly string[]).includes(g.result)) {
      throw new Ref11ValidationError(`Gate ${g.gate} result must be one of: ${GATE_RESULTS.join(", ")}`);
    }
    byGate.set(g.gate, {
      gate: g.gate as ObservationGate,
      result: g.result as GateResult,
      // breachNote is optional even on a BREACH (it stands on its own, §2.1).
      breachNote: nonEmpty(g.breachNote) || null,
    });
  }
  const gates = OBSERVATION_GATES.map((gate) => byGate.get(gate)!);

  // --- exactly one strength + one growth focus ------------------------------------
  const oneStrength = nonEmpty(input.oneStrength);
  if (!oneStrength) throw new Ref11ValidationError("One strength is required");
  const growthFocus = nonEmpty(input.growthFocus);
  if (!growthFocus) throw new Ref11ValidationError("One growth focus is required");

  // --- optional carry-forward (a re-review only, §4) ------------------------------
  let priorFocusProgress: GrowthProgress | null = null;
  if (input.priorFocusProgress !== undefined && input.priorFocusProgress !== null && nonEmpty(input.priorFocusProgress)) {
    if (!(GROWTH_PROGRESS as readonly string[]).includes(input.priorFocusProgress)) {
      throw new Ref11ValidationError(`priorFocusProgress must be one of: ${GROWTH_PROGRESS.join(", ")}`);
    }
    priorFocusProgress = input.priorFocusProgress as GrowthProgress;
  }

  return { domains, gates, oneStrength, growthFocus, priorFocusProgress };
}
