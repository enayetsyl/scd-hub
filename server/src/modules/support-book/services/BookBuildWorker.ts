/**
 * BookBuildWorker — claims a queued render, runs it, files the PDFs (SB-4, D-#407/#418).
 *
 * Runs in a SEPARATE PROCESS from the school API (D-#407). Chromium is hundreds of MB
 * per render and a 54-lesson book is minutes of work; an OOM here must not take down
 * attendance and homework.
 *
 * ── WHY THE LOG GOES THROUGH THE DATABASE ────────────────────────────────────
 * D-#418 wants the build log streamed live. But the worker is a different process
 * from the one serving SSE, so in-process pub/sub cannot reach the browser. Rather
 * than introduce a message bus for one feature, the worker appends to
 * `BookBuildJob.log` as each command finishes and the API's SSE route TAILS that field.
 * Latency is one poll interval, which is the right trade for a step measured in
 * minutes — and it means a reconnecting browser gets the whole log so far for free,
 * which a pub/sub stream would have to solve separately.
 *
 * ── FAILURE POSTURE ──────────────────────────────────────────────────────────
 * A failed render is a normal outcome: the job goes FAILED with a reason the assembler
 * reads, never an exception that pages anyone. The work directory is cleaned up in a
 * `finally` — a half-gigabyte of PNGs per abandoned render would fill the disk within
 * a week of ordinary use.
 */
import type { Types } from "mongoose";
import { BookBuildJob, type IBookBuildJob } from "../models/BookBuildJob";
import { BookImageAsset } from "../models/BookImageAsset";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { StoredFile } from "../../platform/models/StoredFile";
import { uploadToDrive, downloadFromDrive, DriveUnavailableError } from "../../platform/services/DriveStore";
import { materializeBookJson, claimNextJob } from "./BookBuildService";
import { renderBook, readPdf, cleanup, type CommandRunner } from "./BookRenderRunner";
import { writeBookEvent } from "../models/BookEvent";

/**
 * Append to the job's log. The SSE route tails this field (see the header).
 *
 * An AGGREGATION-PIPELINE update, so the concatenation happens server-side and is
 * atomic. A read-modify-write would drop a chunk whenever two writes overlapped —
 * which they do, because `onLog` fires from a callback that is not awaited.
 */
async function appendLog(jobId: Types.ObjectId, chunk: string): Promise<void> {
  await BookBuildJob.updateOne({ _id: jobId }, [
    { $set: { log: { $concat: [{ $ifNull: ["$log", ""] }, chunk] } } },
  ]).catch(() => undefined);
}

/**
 * Collect the COMPLIANT image for every slot in scope, keyed by the FILENAME
 * `book.json` names.
 *
 * The filename — not the slot id — is what the renderer resolves, so a slot whose
 * `filename` is missing is skipped here and caught by the validator's own image check
 * inside the spawned process. Duplicating that judgement would put two sources of
 * truth on the same question.
 */
export async function gatherCompliantImages(
  bookId: string,
  lessonNos: number[],
): Promise<{ images: Map<string, Buffer>; missing: string[] }> {
  const q: Record<string, unknown> = { bookId };
  if (lessonNos.length) q.lessonNo = { $in: lessonNos };
  const lessons = await SupportBookLesson.find(q).lean();

  const wanted = new Map<string, string>(); // slotId -> filename
  for (const l of lessons) {
    for (const raw of l.imageSlots ?? []) {
      const s = raw as Record<string, unknown>;
      if (typeof s.id === "string" && typeof s.filename === "string" && s.filename) {
        wanted.set(s.id, s.filename);
      }
    }
  }

  const images = new Map<string, Buffer>();
  const missing: string[] = [];
  for (const [slotId, filename] of wanted) {
    const asset = await BookImageAsset.findOne({ bookId, slotId, stage: "COMPLIANT", current: true }).lean();
    if (!asset) { missing.push(slotId); continue; }
    const file = await StoredFile.findById(asset.storedFileId).lean();
    if (!file) { missing.push(slotId); continue; }
    images.set(filename, await downloadFromDrive(file.driveFileId));
  }
  return { images, missing };
}

export interface RunJobOptions {
  /** Injected in tests; the real spawn otherwise. */
  runner?: CommandRunner;
  /** Injected in tests so no Drive call is made. */
  upload?: typeof uploadToDrive;
}

/**
 * Run one claimed job to completion. Never throws for an editorial outcome — a
 * refused validator or a failed render marks the job FAILED with a reason.
 */
export async function runJob(job: IBookBuildJob, opts: RunJobOptions = {}): Promise<IBookBuildJob> {
  const upload = opts.upload ?? uploadToDrive;
  const jobId = job._id;
  let workDir: string | null = null;

  try {
    const bookJson = await materializeBookJson(job.bookId, job.lessonNos);
    const { images, missing } = await gatherCompliantImages(job.bookId, job.lessonNos);
    if (missing.length) {
      await appendLog(jobId, `WARNING: ${missing.length} slot(s) have no compliant image: ${missing.join(", ")}\n`);
    }

    const result = await renderBook({
      bookId: job.bookId,
      bookJson,
      images,
      runner: opts.runner,
      onLog: (chunk) => { void appendLog(jobId, chunk); },
    });
    workDir = result.workDir;

    if (!result.ok) {
      await BookBuildJob.updateOne({ _id: jobId }, {
        $set: {
          state: "FAILED",
          finishedAt: new Date(),
          failureReason: result.failureReason,
          validatorReport: { text: result.validatorLog },
        },
      });
      await writeBookEvent({
        bookId: job.bookId, kind: "BUILD_FAILED", actorId: job.queuedBy,
        summary: `build failed — ${result.failureReason}`,
        refs: { buildJobId: jobId },
      });
      return (await BookBuildJob.findById(jobId))!;
    }

    // ---- file the PDFs ----
    const outputs: Array<{ profile: string; storedFileId: Types.ObjectId }> = [];
    for (const p of result.pdfPaths) {
      const bytes = await readPdf(p).catch(() => null);
      if (!bytes) { await appendLog(jobId, `WARNING: could not read ${p}\n`); continue; }
      const name = p.split(/[\\/]/).pop() ?? `${job.bookId}.pdf`;
      // The profile is in the filename the pipeline chose; use it rather than
      // guessing from the order, which changes if a profile is added.
      const profile = job.profiles.find((pr) => name.includes(pr)) ?? name;
      const driveFileId = await upload({
        name,
        mime: "application/pdf",
        data: bytes,
        year: String(new Date().getFullYear()),
        subfolder: `books/${job.bookId}/pdf`,
        appProperties: { bookId: job.bookId, profile, jobId: String(jobId) },
      });
      const stored = await StoredFile.create({
        kind: "book_pdf",
        mime: "application/pdf",
        sizeBytes: bytes.byteLength,
        originalName: name,
        driveFileId,
        uploadedBy: job.queuedBy,
      });
      outputs.push({ profile, storedFileId: stored._id });
    }

    // A render that reported success but filed NOTHING is not a success. Without this
    // the job would go green with an empty outputs list and the assembler would be
    // told the book was built, with nothing to download — the worst combination.
    if (outputs.length === 0) {
      const reason = "render reported success but produced no readable PDF";
      await appendLog(jobId, `${reason}\n`);
      await BookBuildJob.updateOne({ _id: jobId }, {
        $set: { state: "FAILED", finishedAt: new Date(), failureReason: reason },
      });
      await writeBookEvent({
        bookId: job.bookId, kind: "BUILD_FAILED", actorId: job.queuedBy,
        summary: reason, refs: { buildJobId: jobId },
      });
      return (await BookBuildJob.findById(jobId))!;
    }

    await BookBuildJob.updateOne({ _id: jobId }, {
      $set: {
        state: "SUCCEEDED",
        finishedAt: new Date(),
        outputs,
        validatorReport: { text: result.validatorLog },
      },
    });
    await writeBookEvent({
      bookId: job.bookId, kind: "BUILD_SUCCEEDED", actorId: job.queuedBy,
      summary: `build succeeded — ${outputs.length} edition(s)`,
      refs: { buildJobId: jobId },
    });
    return (await BookBuildJob.findById(jobId))!;
  } catch (e) {
    // Drive down, a disk full, a bug. Record it on the job rather than losing the
    // worker: the queue must keep draining.
    const reason = e instanceof DriveUnavailableError
      ? "Google Drive unavailable — the render succeeded but its PDFs could not be filed"
      : `worker error: ${(e as Error).message}`;
    await appendLog(jobId, `${reason}\n`).catch(() => undefined);
    await BookBuildJob.updateOne({ _id: jobId }, {
      $set: { state: "FAILED", finishedAt: new Date(), failureReason: reason },
    }).catch(() => undefined);
    return (await BookBuildJob.findById(jobId))!;
  } finally {
    // Half a gigabyte of PNGs per abandoned render fills the disk within a week.
    if (workDir) await cleanup(workDir);
  }
}

export interface WorkerLoopOptions extends RunJobOptions {
  workerId: string;
  /** How long to wait when the queue is empty. */
  idleMs?: number;
  /** Test seam: stop after N iterations instead of running forever. */
  maxIterations?: number;
  shouldStop?: () => boolean;
}

/**
 * Claim-and-run until told to stop. ONE job at a time — `claimNextJob` refuses while
 * anything is RUNNING, so even two worker processes cannot exceed the host's memory
 * budget (D-#423).
 */
export async function workerLoop(opts: WorkerLoopOptions): Promise<number> {
  const idleMs = opts.idleMs ?? 5_000;
  let ran = 0;
  for (let i = 0; opts.maxIterations === undefined || i < opts.maxIterations; i++) {
    if (opts.shouldStop?.()) break;
    const job = await claimNextJob(opts.workerId);
    if (!job) {
      if (opts.maxIterations !== undefined) continue; // tests do not sleep
      await new Promise((r) => setTimeout(r, idleMs));
      continue;
    }
    await runJob(job, opts);
    ran++;
  }
  return ran;
}
