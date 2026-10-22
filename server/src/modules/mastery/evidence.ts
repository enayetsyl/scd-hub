/**
 * Pure evidence computation for one confirmed paper (M-2, docs/prd-mastery.md §5.2,
 * D-#778/#787). No database: the service passes rows in and writes what comes out, so every
 * rule below is testable on its own and there is no second write path that could skip one.
 *
 *  - Exceptions only: a student with no result row is PRESENT with full marks everywhere.
 *  - ABSENT / NOT_SUBMITTED / VOID (or a NO_EVIDENCE / VOID_BEHAVIOUR tag) produce NO rows —
 *    never "weak". VOID and VOID_BEHAVIOUR produce a behaviour note instead.
 *  - Re-work (policy.reworkIsWeak) or a WEAK tag ⇒ signal WEAK; a LIGHT tag or whole-work
 *    re-work (policy.workReworkIsLight) ⇒ LIGHT. The mark itself is kept as entered.
 *  - Routing tags (ROUTE_STRAND, D-#787): on an ITEM of a listed type, tagged ⇒ a WEAK row on
 *    the strand LO, untagged ⇒ a GOOD row; the routed deduction is ADDED BACK to the item's
 *    own LO ("no double blame"). A WORK routing tag judges the whole work once.
 *  - A multi-LO item credits each LO in full (the scholarship D-#661 rule) until the owner
 *    decides otherwise (D-#776 open point).
 *  - Rubric papers: one row per rubric LO, earned = step − 1 of 3 (1→0 … 4→3).
 */
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { routeTargetCode } from "./catalogue";

export interface PaperLike {
  source: string;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  date: Date;
  items: { itemNo: number; qid?: string; loCodes: string[]; chapterNumber: number | null; questionTypeCode: string; marks: number }[];
  rubricLoCodes: string[];
}

export interface ResultLike {
  status?: "PRESENT" | "ABSENT" | "NOT_SUBMITTED" | "VOID";
  items: { itemNo: number; marks?: number; rework?: boolean; tags: string[] }[];
  workRework?: boolean;
  workTags: string[];
  rubric: { loCode: string; step: number }[];
}

export interface TagLike {
  code: string;
  effect: "WEAK" | "LIGHT" | "NO_EVIDENCE" | "VOID_BEHAVIOUR" | "ROUTE_STRAND";
  routeStrand?: string | null;
  routeSeq?: number | null;
  level?: "ITEM" | "WORK" | null;
  questionTypeCodes: string[];
  deductionMarks?: number | null;
  allScopes: boolean;
  scopes: { classToken: string; subject: string }[];
  active: boolean;
}

export interface EvidenceRow {
  studentId: string;
  loCode: string;
  chapterNumber: number | null;
  itemNo: number | null;
  qid?: string;
  earned: number;
  available: number;
  rubricStep?: number;
  rework: boolean;
  workRework: boolean;
  tags: string[];
  signal: "NONE" | "WEAK" | "LIGHT" | "GOOD";
  routed: boolean;
}

export interface EvidenceOutput {
  rows: EvidenceRow[];
  behaviourNotes: { studentId: string; reason: "VOID" | "VOID_BEHAVIOUR" }[];
  /** Students who produced no rows, and why (for the confirmation summary). */
  skipped: { studentId: string; reason: "ABSENT" | "NOT_SUBMITTED" | "VOID" | "NO_EVIDENCE" }[];
}

/** ISO-8601 week key, e.g. "2027-W05" — "separate weeks" for mastery (D-#779). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const inScope = (t: TagLike, p: PaperLike) =>
  t.active && (t.allScopes || t.scopes.some((s) => s.classToken === p.classToken && s.subject === p.subject));

export function computeEvidence(input: {
  paper: PaperLike;
  studentIds: string[];
  results: Map<string, ResultLike>;
  /** Tracker defaults (homework record): ABSENT / NOT_SUBMITTED / PRESENT. */
  statusDefaults: Map<string, "PRESENT" | "ABSENT" | "NOT_SUBMITTED">;
  tags: TagLike[];
  policy: { reworkIsWeak: boolean; workReworkIsLight: boolean };
  /** Live (non-retired) LO codes — a routing tag whose strand LO is missing writes nothing. */
  liveCodes: Set<string>;
  /** AS papers (M-4): the items each student was given; any other item is "not given" and
   *  writes nothing. Absent ⇒ everyone was given every item. */
  studentItems?: Map<string, Set<number>>;
}): EvidenceOutput {
  const { paper, results, statusDefaults, policy, liveCodes } = input;
  const tags = new Map(input.tags.filter((t) => inScope(t, paper)).map((t) => [t.code, t]));
  const itemRouting = [...tags.values()].filter((t) => t.effect === "ROUTE_STRAND" && t.level === "ITEM" && t.routeStrand);
  const workRouting = [...tags.values()].filter((t) => t.effect === "ROUTE_STRAND" && t.level === "WORK" && t.routeStrand);
  const scope = { classToken: paper.classToken, subject: paper.subject };
  const out: EvidenceOutput = { rows: [], behaviourNotes: [], skipped: [] };

  for (const studentId of input.studentIds) {
    const r = results.get(studentId);
    const status = r?.status ?? statusDefaults.get(studentId) ?? "PRESENT";
    if (status === "ABSENT" || status === "NOT_SUBMITTED") {
      out.skipped.push({ studentId, reason: status });
      continue;
    }
    if (status === "VOID") {
      out.skipped.push({ studentId, reason: "VOID" });
      out.behaviourNotes.push({ studentId, reason: "VOID" });
      continue;
    }
    const workTags = (r?.workTags ?? []).map((c) => tags.get(c)).filter((t): t is TagLike => Boolean(t));
    if (workTags.some((t) => t.effect === "VOID_BEHAVIOUR")) {
      out.skipped.push({ studentId, reason: "VOID" });
      out.behaviourNotes.push({ studentId, reason: "VOID_BEHAVIOUR" });
      continue;
    }
    if (workTags.some((t) => t.effect === "NO_EVIDENCE")) {
      out.skipped.push({ studentId, reason: "NO_EVIDENCE" });
      continue;
    }
    const workRework = Boolean(r?.workRework);
    const workCodes = workTags.map((t) => t.code);

    if (paper.source === "RUBRIC") {
      for (const loCode of paper.rubricLoCodes) {
        const step = r?.rubric.find((x) => x.loCode === loCode)?.step ?? 4;
        out.rows.push({
          studentId, loCode, chapterNumber: null, itemNo: null, earned: step - 1, available: 3, rubricStep: step,
          rework: false, workRework, tags: workCodes, signal: "NONE", routed: false,
        });
      }
      continue;
    }

    const workWeak = workTags.some((t) => t.effect === "WEAK");
    const workLight = (workRework && policy.workReworkIsLight) || workTags.some((t) => t.effect === "LIGHT");
    let voided = false;
    const given = input.studentItems?.get(studentId);

    for (const item of paper.items) {
      if (input.studentItems && !given?.has(item.itemNo)) continue;
      const ri = r?.items.find((x) => x.itemNo === item.itemNo);
      const itemTags = (ri?.tags ?? []).map((c) => tags.get(c)).filter((t): t is TagLike => Boolean(t));
      if (itemTags.some((t) => t.effect === "VOID_BEHAVIOUR")) {
        voided = true;
        continue;
      }
      if (itemTags.some((t) => t.effect === "NO_EVIDENCE")) continue;

      const earned = Math.min(item.marks, Math.max(0, ri?.marks ?? item.marks));
      const eligibleRoutes = itemRouting.filter((t) => t.questionTypeCodes.includes(item.questionTypeCode));
      const taggedRoutes = eligibleRoutes.filter((t) => itemTags.some((x) => x.code === t.code));
      const addBack = taggedRoutes.reduce((s, t) => s + (t.deductionMarks ?? 0), 0);
      const ownEarned = Math.min(item.marks, earned + addBack);
      const rework = Boolean(ri?.rework);
      const weak = (rework && policy.reworkIsWeak) || itemTags.some((t) => t.effect === "WEAK") || workWeak;
      const light = !weak && (itemTags.some((t) => t.effect === "LIGHT") || workLight);
      const signal = weak ? "WEAK" : light ? "LIGHT" : "NONE";
      const codes = [...new Set([...itemTags.map((t) => t.code), ...workCodes])];

      for (const loCode of item.loCodes) {
        out.rows.push({
          studentId, loCode, chapterNumber: item.chapterNumber, itemNo: item.itemNo, qid: item.qid,
          earned: ownEarned, available: item.marks, rework, workRework, tags: codes, signal, routed: false,
        });
      }
      for (const t of eligibleRoutes) {
        const target = routeTargetCode(scope, t.routeStrand!, t.routeSeq ?? 1);
        if (!liveCodes.has(target)) continue;
        const tagged = taggedRoutes.includes(t);
        out.rows.push({
          studentId, loCode: target, chapterNumber: item.chapterNumber, itemNo: item.itemNo, qid: item.qid,
          earned: tagged ? 0 : 1, available: 1, rework: false, workRework, tags: tagged ? [t.code] : [],
          signal: tagged ? "WEAK" : "GOOD", routed: true,
        });
      }
    }
    if (voided) out.behaviourNotes.push({ studentId, reason: "VOID_BEHAVIOUR" });

    for (const t of workRouting) {
      const target = routeTargetCode(scope, t.routeStrand!, t.routeSeq ?? 1);
      if (!liveCodes.has(target)) continue;
      const tagged = workCodes.includes(t.code);
      out.rows.push({
        studentId, loCode: target, chapterNumber: null, itemNo: null,
        earned: tagged ? 0 : 1, available: 1, rework: false, workRework, tags: tagged ? [t.code] : [],
        signal: tagged ? "WEAK" : "GOOD", routed: true,
      });
    }
  }
  return out;
}
