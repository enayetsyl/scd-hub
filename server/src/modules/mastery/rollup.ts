/**
 * Pure roll-up for the objective tree (OT-3, docs/prd-objective-tree.md §8.1, D-#925 / #927).
 * No database. The diagnosis engine (../diagnosis.ts) still runs on TAGGED rows only (D-#808);
 * everything here is computed on read from those tagged states.
 *
 *   rollUpObjective   — an untagged objective's state from its tagged children:
 *                         no child assessed                          ⇒ NOT_ASSESSED
 *                         any child WEAK                             ⇒ WEAK
 *                         EVERY child assessed and MASTERED/due      ⇒ MASTERED (REVISION_DUE if one is due)
 *                         any child still NOT_ASSESSED               ⇒ INSUFFICIENT (D-#943: never mastered
 *                                                                      on a half-checked objective)
 *                         any child IMPROVING / MASTERED / due       ⇒ IMPROVING
 *                         otherwise (all are INSUFFICIENT)           ⇒ INSUFFICIENT
 *   summarise         — counts per state + share mastered + share weak (a domain, a column)
 *   buildCatalogueTree — the tagged rows, the objectives (each with its tagged children) and the
 *                        domain buckets of one class × subject. A flat M-0 catalogue reads as
 *                        tagged objectives with no parent and no domain (`isTree: false`), so
 *                        every flat view renders exactly as before.
 */
import { MASTERY_STATES } from "@scd/shared";
import type { MasteryState } from "@scd/shared";

const GOOD: ReadonlySet<MasteryState> = new Set<MasteryState>(["MASTERED", "REVISION_DUE"]);

export function rollUpObjective(children: readonly MasteryState[]): MasteryState {
  const assessed = children.filter((s) => s !== "NOT_ASSESSED");
  if (assessed.length === 0) return "NOT_ASSESSED";
  if (assessed.includes("WEAK")) return "WEAK";
  // D-#943: mastered only when EVERY child was checked and is mastered — never on a half-checked objective.
  if (children.every((s) => GOOD.has(s))) return children.includes("REVISION_DUE") ? "REVISION_DUE" : "MASTERED";
  if (children.includes("NOT_ASSESSED")) return "INSUFFICIENT";
  if (assessed.some((s) => s === "IMPROVING" || GOOD.has(s))) return "IMPROVING";
  return "INSUFFICIENT";
}

export interface StateSummary {
  /** Every state, in MASTERY_STATES order (zeros included). */
  counts: { state: MasteryState; count: number }[];
  total: number;
  assessed: number;
  weak: number;
  mastered: number;
  /** MASTERED + REVISION_DUE ÷ all cells; null when there are none. */
  masteredPct: number | null;
  /** WEAK ÷ assessed cells (the heat-map colour); null when nothing is assessed. */
  weakPct: number | null;
}

export function summarise(states: readonly MasteryState[]): StateSummary {
  const by = new Map<MasteryState, number>();
  for (const s of states) by.set(s, (by.get(s) ?? 0) + 1);
  const total = states.length;
  const assessed = total - (by.get("NOT_ASSESSED") ?? 0);
  const weak = by.get("WEAK") ?? 0;
  const mastered = (by.get("MASTERED") ?? 0) + (by.get("REVISION_DUE") ?? 0);
  return {
    counts: MASTERY_STATES.map((state) => ({ state, count: by.get(state) ?? 0 })),
    total,
    assessed,
    weak,
    mastered,
    masteredPct: total > 0 ? Math.round((mastered / total) * 100) : null,
    weakPct: assessed > 0 ? Math.round((weak / assessed) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// The tree of one class × subject
// ---------------------------------------------------------------------------

export interface TreeRowLike {
  code: string;
  labelBn: string;
  chapterNumber?: number | null;
  strand?: string | null;
  order?: number;
  homeTipBn?: string | null;
  level?: "OBJECTIVE" | "SUB" | null;
  parentCode?: string | null;
  tagged?: boolean | null;
  domainCode?: string | null;
  prereqCodes?: string[] | null;
}

export interface ObjectiveNode {
  code: string;
  labelBn: string;
  chapterNumber: number | null;
  strand: string | null;
  domainCode: string | null;
  homeTipBn: string | null;
  /** True = the objective itself carries marks (no children). */
  tagged: boolean;
  /** Its tagged sub-objectives, in catalogue order (empty for a tagged objective). */
  childCodes: string[];
}

export interface DomainBucket {
  /** null = rows with no domain (skill strands, a flat catalogue). */
  code: string | null;
  objectiveCodes: string[];
  /** The tagged rows under it (objective itself, or its children). */
  taggedCodes: string[];
}

export interface CatalogueTree {
  /** True when any row is a sub-objective or names a domain. False ⇒ a flat M-0 catalogue. */
  isTree: boolean;
  tagged: TreeRowLike[];
  objectives: ObjectiveNode[];
  domains: DomainBucket[];
  byCode: Map<string, TreeRowLike>;
  /** A tagged code → the objective that owns it (itself for a tagged objective). */
  objectiveOf: (code: string) => ObjectiveNode | null;
}

/** Questions, rubric grades and evidence name only tagged rows; a flat row is tagged. */
export const isTaggedRow = (r: { tagged?: boolean | null }): boolean => r.tagged ?? true;

const shape = (r: TreeRowLike) => ({
  level: r.level ?? "OBJECTIVE",
  parentCode: r.parentCode ?? null,
  tagged: r.tagged ?? true,
  domainCode: r.domainCode ?? null,
});

/** `rows` in catalogue (book) order; LOCKED rows only — the caller filters. */
export function buildCatalogueTree(rows: readonly TreeRowLike[], domainOrder: readonly string[] = []): CatalogueTree {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const isTree = rows.some((r) => shape(r).level === "SUB" || shape(r).domainCode !== null);
  const tagged = rows.filter((r) => shape(r).tagged);
  const children = new Map<string, string[]>();
  for (const r of rows) {
    const s = shape(r);
    if (s.level === "SUB" && s.parentCode && s.tagged) children.set(s.parentCode, [...(children.get(s.parentCode) ?? []), r.code]);
  }
  const objectives: ObjectiveNode[] = rows
    .filter((r) => shape(r).level === "OBJECTIVE")
    .map((r) => {
      const s = shape(r);
      return {
        code: r.code,
        labelBn: r.labelBn,
        chapterNumber: r.chapterNumber ?? null,
        strand: r.strand ?? null,
        domainCode: s.domainCode,
        homeTipBn: r.homeTipBn ?? null,
        tagged: s.tagged,
        childCodes: s.tagged ? [] : children.get(r.code) ?? [],
      };
    });
  const objByCode = new Map(objectives.map((o) => [o.code, o]));
  const objectiveOf = (code: string): ObjectiveNode | null => {
    const r = byCode.get(code);
    if (!r) return null;
    const s = shape(r);
    return s.level === "SUB" ? objByCode.get(s.parentCode ?? "") ?? null : objByCode.get(code) ?? null;
  };

  const buckets = new Map<string | null, DomainBucket>();
  for (const o of objectives) {
    const key = o.domainCode;
    const b = buckets.get(key) ?? { code: key, objectiveCodes: [], taggedCodes: [] };
    b.objectiveCodes.push(o.code);
    b.taggedCodes.push(...(o.tagged ? [o.code] : o.childCodes));
    buckets.set(key, b);
  }
  const rank = (c: string | null) => {
    if (c === null) return Number.MAX_SAFE_INTEGER;
    const i = domainOrder.indexOf(c);
    return i >= 0 ? i : domainOrder.length;
  };
  const domains = [...buckets.values()].sort((a, b) => rank(a.code) - rank(b.code));
  return { isTree, tagged, objectives, domains, byCode, objectiveOf };
}

/** One objective's state for one student: its own (tagged) or rolled up from its children. */
export function objectiveState(o: Pick<ObjectiveNode, "code" | "tagged" | "childCodes">, stateOf: (code: string) => MasteryState): MasteryState {
  return o.tagged ? stateOf(o.code) : rollUpObjective(o.childCodes.map(stateOf));
}
