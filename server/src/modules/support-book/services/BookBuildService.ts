/**
 * BookBuildService — the assembly gate, the book-folder materializer, and the job
 * queue (SB-4, D-#406/#407/#413/#417/#426).
 *
 * THE GATE RUNS BEFORE ANYTHING EXPENSIVE. A render is minutes of Chromium; refusing
 * a doomed build at queue time costs nothing and tells the person the actual reason
 * while they are still looking at it.
 *
 * Materialization is the other half: Mongo is the source of truth (D-#406), and
 * `book.json` is written from the lesson rows at build time. The render pipeline reads
 * that file and nothing else, which is what keeps the vendored CLI unmodified
 * (D-#407) and what makes the export escape hatch a one-liner rather than a feature.
 */
import type { Types } from "mongoose";
import type { BuildScope } from "@scd/shared";
import { SupportBook, type ISupportBook } from "../models/SupportBook";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { BookBuildJob, type IBookBuildJob } from "../models/BookBuildJob";
import { BookEscalation } from "../models/BookEscalation";
import { bookStaleness } from "./BookImageService";
import { writeBookEvent } from "../models/BookEvent";

export class BuildGateError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join("; "));
    this.name = "BuildGateError";
    this.reasons = reasons;
  }
}

/** Support books render two editions; storybooks six. The adapter knows, the engine
 *  does not (D-#421). */
export function profilesFor(book: ISupportBook): string[] {
  return book.bookType === "STORYBOOK"
    ? ["screen-bn", "print-archive-bn", "a4-home-bn", "screen-en", "print-archive-en", "a4-home-en"]
    : ["print-colour", "bw-photocopy"];
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Everything that must be true before a render is worth starting.
 *
 * Each reason is a SENTENCE a person can act on, not a code — this list is shown at
 * the moment someone presses build, and "3 stale files: L012-img-01 COMPLIANT, …" is
 * actionable where "GATE_FAILED" is not.
 */
export async function assemblyGate(bookId: string, lessonNos: number[]): Promise<GateResult> {
  const reasons: string[] = [];

  const book = await SupportBook.findOne({ bookId }).lean<ISupportBook>();
  if (!book) return { ok: false, reasons: [`unknown book: ${bookId}`] };

  // 1. Staleness (D-#417) — the silent one. A stale COMPLIANT still builds a valid
  //    PDF; it just prints the old picture.
  const stale = await bookStaleness(bookId);
  if (stale.blocksAssembly) {
    const named = stale.stale.map((s) => `${s.slotId} ${s.stage}`).join(", ");
    reasons.push(`${stale.stale.length} stale file(s) — re-run before assembly: ${named}`);
  }

  // 2. Unresolved escalations on any lesson in scope. ANSWERED counts: someone still
  //    has to apply the ruling.
  const escQuery: Record<string, unknown> = { bookId, state: { $in: ["OPEN", "ANSWERED"] } };
  if (lessonNos.length) escQuery.lessonNo = { $in: lessonNos };
  const openEsc = await BookEscalation.find(escQuery).lean();
  if (openEsc.length) {
    const where = openEsc.map((e) => `পাঠ ${e.lessonNo}/${e.targetId ?? e.target}`).join(", ");
    reasons.push(`${openEsc.length} unresolved escalation(s): ${where}`);
  }

  // 3. Lessons in scope must exist.
  const lessonQuery: Record<string, unknown> = { bookId };
  if (lessonNos.length) lessonQuery.lessonNo = { $in: lessonNos };
  const lessons = await SupportBookLesson.find(lessonQuery).lean();
  if (!lessons.length) reasons.push("no lessons in scope");

  return { ok: reasons.length === 0, reasons };
}

/**
 * `book.json` as the render pipeline expects it (SCHEMA field names, VERBATIM).
 *
 * The stored row is our model; this file is the contract the frozen CLI reads, so the
 * snake_case translation lives here rather than leaking into the database.
 */
export async function materializeBookJson(
  bookId: string,
  lessonNos: number[] = [],
): Promise<Record<string, unknown>> {
  const book = await SupportBook.findOne({ bookId }).lean<ISupportBook>();
  if (!book) throw new BuildGateError([`unknown book: ${bookId}`]);

  const q: Record<string, unknown> = { bookId };
  if (lessonNos.length) q.lessonNo = { $in: lessonNos };
  const rows = await SupportBookLesson.find(q).sort({ lessonNo: 1 }).lean();

  return {
    schema_version: "1.3",
    book_id: book.bookId,
    class: book.classLevel,
    subject: book.subject,
    mode: book.mode ?? "R",
    title_bn: book.titleBn,
    base_nctb_print_year: book.baseNctbPrintYear,
    has_text_en: book.hasTextEn,
    status: book.status,
    front_matter: book.frontMatter ?? {},
    layout_presets: book.layoutPresets ?? {},
    lessons: rows.map((e) => {
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
    }),
    version_log: book.versionLog ?? [],
  };
}

export interface QueueBuildInput {
  bookId: string;
  scope: BuildScope;
  lessonNos?: number[];
  queuedBy: Types.ObjectId;
  /** Skip the gate. PRINCIPAL only — and the override is recorded, never silent. */
  force?: boolean;
}

/** Queue a render. Refuses on a failed gate unless forced. */
export async function queueBuild(input: QueueBuildInput): Promise<IBookBuildJob> {
  const lessonNos = input.lessonNos ?? [];
  const gate = await assemblyGate(input.bookId, lessonNos);
  if (!gate.ok && !input.force) throw new BuildGateError(gate.reasons);

  const book = await SupportBook.findOne({ bookId: input.bookId }).lean<ISupportBook>();
  if (!book) throw new BuildGateError([`unknown book: ${input.bookId}`]);

  const job = await BookBuildJob.create({
    bookId: input.bookId,
    scope: input.scope,
    lessonNos,
    profiles: profilesFor(book),
    state: "QUEUED",
    queuedBy: input.queuedBy,
    queuedAt: new Date(),
    outputs: [],
    log: gate.ok ? "" : `GATE OVERRIDDEN:\n  ${gate.reasons.join("\n  ")}\n`,
  });

  await writeBookEvent({
    bookId: input.bookId,
    kind: "BUILD_QUEUED",
    actorId: input.queuedBy,
    summary: `build queued (${input.scope}${lessonNos.length ? ` পাঠ ${lessonNos.join(",")}` : ""})` +
      (gate.ok ? "" : " — GATE OVERRIDDEN"),
    reason: gate.ok ? undefined : gate.reasons.join("; "),
    refs: { buildJobId: job._id },
  });

  return job;
}

/**
 * Atomically claim the oldest queued job. Returns null when nothing is waiting OR
 * another worker is already running one — concurrency 1 is enforced HERE rather than
 * by convention, because the constraint is about the host's memory (D-#423) and a
 * second worker process must not be able to violate it by starting.
 */
export async function claimNextJob(workerId: string): Promise<IBookBuildJob | null> {
  const running = await BookBuildJob.findOne({ state: "RUNNING" }).lean();
  if (running) return null;

  return BookBuildJob.findOneAndUpdate(
    { state: "QUEUED" },
    { $set: { state: "RUNNING", startedAt: new Date(), workerId } },
    { sort: { queuedAt: 1 }, new: true },
  );
}

/** Hand a job back to the queue — used when a worker is killed mid-render, so a
 *  stuck RUNNING row is recoverable rather than permanently blocking the queue. */
export async function requeueStuckJobs(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const res = await BookBuildJob.updateMany(
    { state: "RUNNING", startedAt: { $lt: cutoff } },
    { $set: { state: "QUEUED" }, $unset: { workerId: "", startedAt: "" } },
  );
  return res.modifiedCount ?? 0;
}
