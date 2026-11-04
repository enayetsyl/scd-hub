/**
 * Pure planning for the objective-tree import (prd-objective-tree §6, OT-1).
 *
 *   treeNodeHash    — the content fingerprint a redraft is compared on (order/book version excluded)
 *   planTreeImport  — given the validated file + the pair's existing rows + its latest round, what
 *                     to create / update / reject / delete / retire, the round action, the preview
 *                     counts and every refusal. The service only loads rows and writes the plan, so
 *                     the dry run and the apply are the same computation.
 *
 * Re-import rules (§6):
 *   - a code new to the pair                 → DRAFT, reviewState PROPOSED
 *   - DRAFT, file content unchanged (hash)   → untouched: keeps the decision AND any reviewer edit
 *   - DRAFT, file content changed            → content from the file, back to PROPOSED
 *   - DRAFT, gone from the file              → REJECTED "removed in redraft" (a reviewer-ADDED row,
 *                                               which never came from a file, is left alone; a flat
 *                                               M-0 draft with no review state is deleted as before)
 *   - LOCKED                                 → prd-mastery rule: label / home tip / question types /
 *                                               source text only (a legacy flat row may have its
 *                                               missing tree fields filled); anything structural
 *                                               moving is refused; gone ⇒ RETIRED, never deleted
 *   - RETIRED reappearing                    → refused (new code needed)
 * Round: an OPEN/SUBMITTED round is redrafted in place (SUBMITTED → OPEN); otherwise any row
 * entering review opens round N+1; label-only edits over a locked catalogue open none.
 */
import crypto from "node:crypto";
import { checkTreeInvariants, formatTreeViolation, type TreeFile, type TreeFileNode, type TreeNodeInput } from "@scd/shared";
import type { MasteryAssess, MasteryOutcomeLevel, MasteryOutcomeStatus, MasteryReviewRoundState, MasteryReviewState } from "@scd/shared";

export const REMOVED_IN_REDRAFT = "removed in redraft";

export interface ExistingTreeRow {
  code: string;
  status: MasteryOutcomeStatus;
  assess: MasteryAssess;
  chapterNumber: number | null;
  strand: string | null;
  labelBn: string;
  labelEn?: string;
  sourceText?: string;
  questionTypeCodes?: string[];
  homeTipBn?: string;
  level?: MasteryOutcomeLevel;
  parentCode?: string | null;
  domainCode?: string | null;
  tagged?: boolean;
  prereqCodes?: string[];
  reviewState?: MasteryReviewState;
  rejectReason?: string;
  mergedInto?: string;
  draftHash?: string | null;
  bookRef?: unknown;
  order: number;
}

export interface LatestRound {
  round: number;
  state: MasteryReviewRoundState;
}

export interface TreeRowWrite {
  code: string;
  fields: Record<string, unknown>;
}

export interface TreeImportPlan {
  errors: string[];
  create: TreeRowWrite[];
  /** DRAFT rows overwritten from the file and set back to PROPOSED. */
  backToProposed: TreeRowWrite[];
  /** LOCKED rows: allowed edits (label / home tip / QT / source text / legacy fills). */
  lockedUpdates: TreeRowWrite[];
  /** Rows whose decision is kept but whose `order` moved (no review effect). */
  reorder: { code: string; order: number }[];
  removedInRedraft: string[];
  deleteFlatDrafts: string[];
  retire: string[];
  kept: number;
  roundAction: "OPEN_NEW" | "REDRAFT" | "NONE";
  roundNumber: number | null;
  /** True when nothing at all would change (the no-op re-import). */
  noop: boolean;
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** The content a reviewer decides on. `order` and the book version are excluded on purpose. */
export function treeNodeHash(n: TreeFileNode): string {
  const content = [
    n.level, n.parentCode, n.domainCode, n.chapterNumber, n.strand, n.tagged, n.labelBn, n.sourceText,
    n.assess, n.questionTypeCodes ?? [], n.homeTipBn ?? null, n.prereqCodes, n.bookRef.chapter, n.bookRef.lesson,
    n.bookRef.exercises, n.legacyCodes, n.claudeNote,
  ];
  return crypto.createHash("sha1").update(JSON.stringify(content)).digest("hex");
}

/** The row fields a file node writes (status/review state added by the caller). */
export function treeNodeFields(n: TreeFileNode, order: number, bookVersion: string | null): Record<string, unknown> {
  return {
    chapterNumber: n.chapterNumber,
    strand: n.strand,
    labelBn: n.labelBn,
    sourceText: n.sourceText,
    assess: n.assess === "RUBRIC" ? "RUBRIC" : "QUESTION",
    questionTypeCodes: [...new Set(n.questionTypeCodes ?? [])],
    homeTipBn: n.homeTipBn ?? undefined,
    order,
    level: n.level,
    parentCode: n.parentCode,
    domainCode: n.domainCode,
    tagged: n.tagged,
    prereqCodes: n.prereqCodes,
    bookRef: { version: bookVersion, chapter: n.bookRef.chapter, lesson: n.bookRef.lesson, exercises: n.bookRef.exercises },
    claudeNote: n.claudeNote ?? undefined,
    legacyCodes: n.legacyCodes,
    draftHash: treeNodeHash(n),
  };
}

export function planTreeImport(tree: TreeFile, existing: ExistingTreeRow[], latest: LatestRound | null): TreeImportPlan {
  const plan: TreeImportPlan = {
    errors: [],
    create: [],
    backToProposed: [],
    lockedUpdates: [],
    reorder: [],
    removedInRedraft: [],
    deleteFlatDrafts: [],
    retire: [],
    kept: 0,
    roundAction: "NONE",
    roundNumber: null,
    noop: false,
  };
  const byCode = new Map(existing.map((e) => [e.code, e]));
  const fileCodes = new Set(tree.nodes.map((n) => n.code));
  const version = tree.source.book;

  tree.nodes.forEach((n, i) => {
    const order = i + 1;
    const e = byCode.get(n.code);
    const fields = treeNodeFields(n, order, version);
    if (!e) {
      plan.create.push({ code: n.code, fields });
      return;
    }
    if (e.status === "RETIRED") {
      plan.errors.push(`${n.code}: এই কোড অবসরে গেছে — আবার চালু করা যায় না, নতুন কোড দিন।`);
      return;
    }
    if (e.status === "LOCKED") {
      // Structure never moves once locked; a legacy flat row has no tree fields yet and may be filled.
      const moved: string[] = [];
      if ((e.level ?? "OBJECTIVE") !== n.level) moved.push("level");
      if ((e.parentCode ?? null) !== n.parentCode) moved.push("parentCode");
      if ((e.tagged ?? true) !== n.tagged) moved.push("tagged");
      if (e.domainCode && e.domainCode !== n.domainCode) moved.push("domainCode");
      if (e.prereqCodes !== undefined && !sameList(e.prereqCodes, n.prereqCodes)) moved.push("prereqCodes");
      if (e.assess !== fields.assess) moved.push("assess");
      if (moved.length > 0) {
        plan.errors.push(`${n.code}: লক করা শিখনফলের গঠন বদলানো যায় না (${moved.join(", ")}) — নতুন কোড দিন বা পুরোনোটি অবসরে দিন।`);
        return;
      }
      const set: Record<string, unknown> = {};
      if (e.labelBn !== n.labelBn) set.labelBn = n.labelBn;
      if ((e.sourceText ?? "") !== n.sourceText) set.sourceText = n.sourceText;
      if ((e.homeTipBn ?? null) !== (n.homeTipBn ?? null)) set.homeTipBn = n.homeTipBn ?? undefined;
      if (!sameList(e.questionTypeCodes, fields.questionTypeCodes as string[])) set.questionTypeCodes = fields.questionTypeCodes;
      if (e.order !== order) set.order = order;
      // Legacy fill: a flat M-0 row takes the tree fields it never had.
      if (e.level === undefined) Object.assign(set, { level: n.level, parentCode: n.parentCode, tagged: n.tagged });
      if (!e.domainCode) set.domainCode = n.domainCode;
      if (e.prereqCodes === undefined) set.prereqCodes = n.prereqCodes;
      if (!e.bookRef || typeof e.bookRef === "string") Object.assign(set, { bookRef: fields.bookRef, legacyCodes: n.legacyCodes });
      if (Object.keys(set).length > 0) {
        set.draftHash = fields.draftHash;
        plan.lockedUpdates.push({ code: n.code, fields: set });
      } else plan.kept += 1;
      return;
    }
    // DRAFT
    const restored = e.reviewState === "REJECTED" && e.rejectReason === REMOVED_IN_REDRAFT;
    if (e.draftHash && e.draftHash === fields.draftHash && !restored) {
      plan.kept += 1;
      if (e.order !== order) plan.reorder.push({ code: n.code, order });
      return;
    }
    plan.backToProposed.push({ code: n.code, fields });
  });

  for (const e of existing) {
    if (fileCodes.has(e.code) || e.status === "RETIRED") continue;
    if (e.status === "LOCKED") {
      plan.retire.push(e.code);
      continue;
    }
    if (!e.reviewState) plan.deleteFlatDrafts.push(e.code);
    else if (e.reviewState === "REJECTED" || !e.draftHash) continue; // already out / reviewer-added
    else plan.removedInRedraft.push(e.code);
  }

  const entersReview = plan.create.length + plan.backToProposed.length + plan.removedInRedraft.length;
  if (latest && (latest.state === "OPEN" || latest.state === "SUBMITTED")) {
    plan.roundAction = "REDRAFT";
    plan.roundNumber = latest.round;
  } else if (entersReview > 0) {
    plan.roundAction = "OPEN_NEW";
    plan.roundNumber = (latest?.round ?? 0) + 1;
  }
  plan.noop =
    plan.errors.length === 0 &&
    entersReview === 0 &&
    plan.lockedUpdates.length === 0 &&
    plan.reorder.length === 0 &&
    plan.deleteFlatDrafts.length === 0 &&
    plan.retire.length === 0;
  return plan;
}

/**
 * The §5 invariants on the catalogue as it would stand after the apply (REVIEW mode): file rows,
 * plus surviving rows the file does not list (reviewer-ADDED drafts). Rejected / merged-away /
 * retired / deleted rows do not count.
 */
export function mergedTreeViolations(
  tree: TreeFile,
  existing: ExistingTreeRow[],
  plan: TreeImportPlan,
  domainCodes: Iterable<string>,
  externalCodes: Iterable<string>,
): string[] {
  const fileCodes = new Set(tree.nodes.map((n) => n.code));
  const gone = new Set([...plan.removedInRedraft, ...plan.deleteFlatDrafts, ...plan.retire]);
  const nodes: TreeNodeInput[] = [...tree.nodes];
  for (const e of existing) {
    if (fileCodes.has(e.code) || gone.has(e.code) || e.status === "RETIRED") continue;
    if (e.reviewState === "REJECTED" || e.mergedInto) continue;
    nodes.push({
      code: e.code,
      level: e.level ?? "OBJECTIVE",
      parentCode: e.parentCode ?? null,
      domainCode: e.domainCode ?? null,
      chapterNumber: e.chapterNumber,
      strand: e.strand,
      tagged: e.tagged ?? true,
      prereqCodes: e.prereqCodes ?? [],
      exercises:
        e.bookRef && typeof e.bookRef === "object" && Array.isArray((e.bookRef as { exercises?: unknown }).exercises)
          ? ((e.bookRef as { exercises: string[] }).exercises)
          : [],
      labelBn: e.labelBn,
    });
  }
  return checkTreeInvariants({
    classToken: tree.classToken,
    subject: tree.subject,
    nodes,
    domainCodes,
    mode: "REVIEW",
    externalCodes,
  }).map(formatTreeViolation);
}
