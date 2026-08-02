/**
 * MergeService — the single write path into a book's content (SB-1, D-#406/#408).
 *
 * Both authoring paths arrive here and nowhere else: a patch written in Claude
 * Desktop and uploaded, and one emitted by the in-app chat. `source` is recorded for
 * the rationale timeline and branched on NOWHERE — that is what stops the API route
 * becoming a second, softer way into a book.
 *
 * THE SEQUENCE (README §3.2 steps 8–9, and the order is load-bearing):
 *   1. Build the merge CANDIDATE — the current book with the patch's lessons
 *      substituted. The validator runs on the candidate, not on the patch alone,
 *      because half the checks (inventory order, duplicate lesson_no, layout refs)
 *      are only meaningful against the whole book.
 *   2. Validate. A RED refuses the merge; the patch is still STORED with its
 *      findings, because a refused validator report is often the most informative
 *      row in the timeline.
 *   3. On pass, replace each lesson WHOLESALE by lesson_no. No field-level merging
 *      (SCHEMA §5) — it is what makes two authors on two chapters safe.
 *   4. Stamp the policy-set hash and append the editorial event.
 *
 * Never banks multiple chapters: one patch, merged immediately, so a lost session
 * costs at most one lesson (README §3.2 step 9).
 */
import type { Types } from "mongoose";
import type { PatchSource } from "@scd/shared";
import { SupportBook, type ISupportBook } from "../models/SupportBook";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { LessonPatch, type ValidatorFinding } from "../models/LessonPatch";
import { writeBookEvent } from "../models/BookEvent";
import { validateBook, type ValidatorReport } from "./validator/index";
import { activePolicySet, letterInventoryFrom } from "./PolicySetService";

/**
 * A malformed patch ENVELOPE — not a validator verdict.
 *
 * There is deliberately no `PatchRejectedError`: a RED result is a normal outcome of
 * the authoring loop and is RETURNED (`merged: false`, with findings) for the caller
 * to render back to the author. Throwing for it would turn the most common editorial
 * event in the module into an exception, and into observability noise.
 */
export class PatchShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchShapeError";
  }
}

/** The SCHEMA §5 patch envelope. */
export interface PatchEnvelope {
  schema_version?: string;
  book_id: string;
  patch_id: string;
  task: string;
  lessons: Array<Record<string, unknown>>;
}

export interface SubmitPatchInput {
  patch: PatchEnvelope;
  source: PatchSource;
  actorId: Types.ObjectId;
  chatSessionId?: Types.ObjectId;
  escalationIds?: Types.ObjectId[];
}

export interface SubmitPatchResult {
  merged: boolean;
  patchId: Types.ObjectId;
  report: ValidatorReport;
  lessonNos: number[];
  policySetHash: string;
  /** Policy documents the set expected but did not find — surfaced, never swallowed. */
  policyMissing: string[];
}

/** Shape-check the envelope before anything touches the database. These are the
 *  errors a person can fix in ten seconds, so they should not arrive dressed as a
 *  validator finding. */
function assertShape(p: PatchEnvelope): void {
  if (!p || typeof p !== "object") throw new PatchShapeError("patch is not an object");
  for (const k of ["book_id", "patch_id", "task"] as const) {
    if (!p[k] || typeof p[k] !== "string") throw new PatchShapeError(`patch is missing "${k}"`);
  }
  if (!Array.isArray(p.lessons) || p.lessons.length === 0) {
    throw new PatchShapeError("patch carries no lessons");
  }
  for (const l of p.lessons) {
    if (typeof l.lesson_no !== "number") {
      throw new PatchShapeError("every lesson in a patch needs a numeric lesson_no");
    }
  }
}

/** Materialize the book as the validator expects it: top-level fields + lessons in
 *  NCTB order, with the patch's lessons substituted (or appended, for a new পাঠ). */
export async function buildCandidate(
  book: ISupportBook,
  patchLessons: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const existing = await SupportBookLesson.find({ bookId: book.bookId })
    .sort({ lessonNo: 1 })
    .lean();

  const patched = new Map<number, Record<string, unknown>>();
  for (const l of patchLessons) patched.set(l.lesson_no as number, l);

  const lessons: Array<Record<string, unknown>> = [];
  for (const e of existing) {
    const replacement = patched.get(e.lessonNo);
    if (replacement) {
      lessons.push(replacement);
      patched.delete(e.lessonNo);
    } else {
      lessons.push(toSchemaLesson(e));
    }
  }
  // A patch may introduce a পাঠ the book does not have yet.
  for (const l of [...patched.values()]) lessons.push(l);
  lessons.sort((a, b) => (a.lesson_no as number) - (b.lesson_no as number));

  return {
    schema_version: "1.3",
    book_id: book.bookId,
    class: book.classLevel,
    subject: book.subject,
    mode: book.mode ?? "R",
    title_bn: book.titleBn,
    has_text_en: book.hasTextEn,
    front_matter: book.frontMatter ?? {},
    layout_presets: book.layoutPresets ?? {},
    lessons,
  };
}

/** Mongo row -> the SCHEMA's snake_case lesson shape. The stored row is our model;
 *  `book.json` is the contract the render pipeline reads, so the translation lives
 *  here rather than leaking snake_case into the database. */
function toSchemaLesson(e: Record<string, unknown>): Record<string, unknown> {
  const signoff = (e.reviewerSignoff ?? {}) as Record<string, unknown>;
  return {
    lesson_no: e.lessonNo,
    nctb_title_bn: e.nctbTitleBn,
    nctb_pages: e.nctbPages ?? [],
    genre: e.genre,
    competency_codes: e.competencyCodes ?? [],
    outcome_codes: e.outcomeCodes ?? [],
    action: e.action,
    c_codes: e.cCodes ?? [],
    severity: e.severity,
    status: e.state,
    blocks: e.blocks ?? [],
    image_slots: e.imageSlots ?? [],
    nctb_omitted: e.nctbOmitted ?? [],
    bw_treatment: e.bwTreatment,
    reviewer_signoff: {
      by: signoff.by ?? null,
      date: signoff.date ?? null,
      checklist_passed: signoff.checklistPassed ?? false,
      self_reviewed: signoff.selfReviewed ?? false,
    },
    notes: e.notes ?? "",
    layout: e.layout ?? [],
  };
}

/** The SCHEMA lesson shape -> the stored row. */
function toLessonRow(l: Record<string, unknown>, bookId: string, policySetHash: string): Record<string, unknown> {
  const signoff = (l.reviewer_signoff ?? {}) as Record<string, unknown>;
  return {
    bookId,
    lessonNo: l.lesson_no,
    nctbTitleBn: l.nctb_title_bn,
    nctbPages: l.nctb_pages ?? [],
    genre: l.genre,
    competencyCodes: l.competency_codes ?? [],
    outcomeCodes: l.outcome_codes ?? [],
    action: l.action,
    cCodes: l.c_codes ?? [],
    severity: l.severity,
    blocks: l.blocks ?? [],
    imageSlots: l.image_slots ?? [],
    nctbOmitted: l.nctb_omitted ?? [],
    bwTreatment: l.bw_treatment,
    reviewerSignoff: {
      by: signoff.by ?? null,
      date: signoff.date ?? null,
      checklistPassed: signoff.checklist_passed ?? false,
      selfReviewed: signoff.self_reviewed ?? false,
    },
    notes: l.notes ?? "",
    layout: l.layout ?? [],
    policySetHash,
  };
}

/**
 * Validate a patch against the merge candidate and, on a green result, merge it.
 *
 * Returns `merged: false` with the findings when the validator refuses — it does NOT
 * throw for a RED, because a refused patch is a normal outcome of the loop that the
 * caller renders back to the author. It throws only for a malformed envelope or an
 * unknown book, which are not editorial outcomes.
 */
export async function submitPatch(input: SubmitPatchInput): Promise<SubmitPatchResult> {
  const { patch, source, actorId } = input;
  assertShape(patch);

  const book = await SupportBook.findOne({ bookId: patch.book_id });
  if (!book) throw new PatchShapeError(`unknown book: ${patch.book_id}`);

  const set = await activePolicySet(book.bookId);
  const inventory = letterInventoryFrom(set);
  const candidate = await buildCandidate(book, patch.lessons);
  const report = validateBook({
    book: candidate,
    classLevel: book.classLevel,
    subject: book.subject,
    letterInventory: inventory,
  });

  const lessonNos = patch.lessons.map((l) => l.lesson_no as number).sort((a, b) => a - b);

  // The patch row is written whether or not it merges — a rejected validator report
  // is evidence, and discarding it loses the most useful thing in the timeline.
  const stored = await LessonPatch.create({
    bookId: book.bookId,
    lessonNo: lessonNos[0],
    patchId: patch.patch_id,
    task: patch.task,
    source,
    payload: patch as unknown as Record<string, unknown>,
    findings: report.findings,
    validatorPassed: report.passed,
    status: report.passed ? "MERGED" : "REJECTED",
    policySetHash: set.hash,
    chatSessionId: input.chatSessionId,
    escalationIds: input.escalationIds ?? [],
    submittedBy: actorId,
    submittedAt: new Date(),
    ...(report.passed ? { mergedBy: actorId, mergedAt: new Date() } : {}),
  });

  if (!report.passed) {
    await writeBookEvent({
      bookId: book.bookId,
      lessonNo: lessonNos[0],
      kind: "PATCH_REJECTED",
      actorId,
      summary: `patch ${patch.patch_id} refused — ${report.redCount} RED`,
      refs: { patchId: stored._id, policySetHash: set.hash },
    });
    return {
      merged: false,
      patchId: stored._id,
      report,
      lessonNos,
      policySetHash: set.hash,
      policyMissing: set.missing,
    };
  }

  // ---- merge: wholesale by lesson_no, no field-level merging (SCHEMA §5) ----
  for (const l of patch.lessons) {
    const row = toLessonRow(l, book.bookId, set.hash);
    // Capture the outgoing patch id as a VALUE before the write. Reading it off the
    // document afterwards is a trap: the update sets `currentPatchId` to the NEW
    // patch, so a later read returns the incoming id and the supersede chain
    // silently links a patch to itself.
    const prior = await SupportBookLesson.findOne({ bookId: book.bookId, lessonNo: l.lesson_no });
    const priorPatchId = prior?.currentPatchId ? String(prior.currentPatchId) : null;
    await SupportBookLesson.findOneAndUpdate(
      { bookId: book.bookId, lessonNo: l.lesson_no },
      {
        $set: { ...row, currentPatchId: stored._id },
        // A brand-new পাঠ starts at the first state; an existing one keeps the state
        // it has earned. A merge changes CONTENT, never a lesson's position in the
        // workflow — moving it would silently undo a reviewer's sign-off.
        $setOnInsert: { state: "CONTENT_DRAFT" },
      },
      { upsert: true, new: true },
    );
    if (priorPatchId) {
      await LessonPatch.updateOne({ _id: priorPatchId }, { $set: { status: "SUPERSEDED" } });
      await LessonPatch.updateOne({ _id: stored._id }, { $set: { supersedes: priorPatchId } });
    }
  }

  await SupportBook.updateOne({ _id: book._id }, { $set: { policySetHash: set.hash } });

  await writeBookEvent({
    bookId: book.bookId,
    lessonNo: lessonNos[0],
    kind: "PATCH_MERGED",
    actorId,
    summary: `patch ${patch.patch_id} merged পাঠ ${lessonNos.join(", ")} (${source})` +
      (report.greyCount ? ` — ${report.greyCount} GREY` : ""),
    refs: { patchId: stored._id, policySetHash: set.hash },
  });

  return {
    merged: true,
    patchId: stored._id,
    report,
    lessonNos,
    policySetHash: set.hash,
    policyMissing: set.missing,
  };
}
