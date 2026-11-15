/**
 * The AI worker's connections and one pass (split from aiJobWorker.ts so tests can drive them;
 * aiJobWorker.ts runs `main()` on import).
 *
 * Book lifecycle (docs/prd-book-lifecycle.md §14.1, D-#1603): the worker now ALSO opens the book plane,
 * because the AI edit job reads and writes book text there. Optional, like the API's: a missing
 * BOOK_MONGODB_URI is a normal state (book jobs are simply not run), a broken one is logged.
 */
import { connectDb } from "../db";
import { connectBookDb, BookDbNotConfiguredError, isBookDbReady } from "../bookDb";
import { workerTick } from "../modules/ai-workspace/services/JobService";
import { bookEditWorkerTick, type JobDeps } from "../modules/book-lifecycle/services/editJob";
import { BookEditJob } from "../modules/book-lifecycle/models/BookEditJob";
import { Types } from "mongoose";

export async function openWorkerPlanes(uris: { main?: string; book?: string } = {}): Promise<{ book: boolean }> {
  await connectDb(uris.main);
  try {
    await connectBookDb(uris.book);
  } catch (err) {
    if (err instanceof BookDbNotConfiguredError) console.log("[ai-worker] book plane not configured — book edit jobs are not run");
    else console.error("[ai-worker] book plane failed to open (book edit jobs are not run):", err);
  }
  return { book: isBookDbReady() };
}

/** One pass: workspace items (concurrency `concurrency`) and, when the book plane is open, book
 *  edit jobs (one job at a time; each job's chapters strictly in order). Returns items/jobs started. */
export async function aiWorkerPass(concurrency: number, inFlight: Set<string>, bookInFlight: Set<string>, bookDeps: JobDeps = {}): Promise<number> {
  const started = await workerTick(concurrency, {}, inFlight);
  const books = isBookDbReady() ? await bookEditWorkerTick(bookDeps, bookInFlight, 1, { wait: false }) : 0;
  return started + books;
}

/**
 * On SIGTERM: give the book jobs in flight up to `timeoutMs` to finish; any that are still running are put
 * back to `queued` (their running chapter too) so the next worker takes them — not left "running" until
 * the 20-minute stale sweep, with a deploy's new worker blind to them.
 */
export async function drainBookJobs(bookInFlight: Set<string>, timeoutMs = 60_000, step = 500): Promise<{ requeued: number }> {
  const until = Date.now() + timeoutMs;
  while (bookInFlight.size && Date.now() < until) await new Promise((r) => setTimeout(r, step));
  if (!bookInFlight.size || !isBookDbReady()) return { requeued: 0 };
  const res = await BookEditJob.updateMany(
    { _id: { $in: [...bookInFlight].map((x) => new Types.ObjectId(x)) }, status: "running" },
    { $set: { status: "queued", "chapters.$[r].status": "queued" } },
    { arrayFilters: [{ "r.status": "running" }] },
  );
  return { requeued: res.modifiedCount };
}
