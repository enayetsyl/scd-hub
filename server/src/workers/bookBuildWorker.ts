#!/usr/bin/env node
/**
 * The book-render worker — a SEPARATE PROCESS from the school API (SB-4, D-#407/#423).
 *
 *   npm run worker:book --workspace=server
 *
 * Why its own process, restated because it is the whole reason this file exists:
 * Chromium is hundreds of MB per render and a 54-lesson book is minutes of work. An
 * OOM here must not take down attendance and homework. The VM has no swap, so under
 * real pressure the kernel kills rather than slows — and it should kill this.
 *
 * REQUIRED ON THE RENDER HOST (D-#413/#429):
 *   PUPPETEER_EXECUTABLE_PATH=/opt/chromium-pw/chrome-linux/chrome  ← NOT the snap
 *   BOOK_WORK_ROOT=/home/deploy/scdhub-book-work
 *   BOOK_MONGODB_URI=...                            ← the book plane (D-#404)
 *
 * IT NEEDS BOTH CONNECTIONS. An earlier version of this comment claimed the worker
 * "connects to the BOOK plane only", which read well and was wrong: filing a rendered
 * PDF writes a `StoredFile` row, and that model lives on the MAIN connection because
 * it is the shared file store the whole app uses. Without `connectDb()` the render
 * succeeds, both editions pass their audits, and then the job dies on
 * `storedfiles.insertOne() buffering timed out` — a failure that looks like Mongo
 * being down and is actually a connection that was never opened. Found by the first
 * real end-to-end render on 2026-08-02, which no mocked unit test could have caught.
 *
 * This does NOT weaken D-#404. The boundary is that no BOOK model may reach identity
 * by ref or populate; a worker holding both connections and writing to each
 * explicitly is exactly how the two planes are meant to be used together.
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../db";
import { connectBookDb, disconnectBookDb } from "../bookDb";
import { workerLoop } from "../modules/support-book/services/BookBuildWorker";
import { requeueStuckJobs } from "../modules/support-book/services/BookBuildService";

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}-${process.pid}`;
/** A job still RUNNING after this long lost its worker; hand it back to the queue. */
const STUCK_AFTER_MS = 30 * 60_000;

let stopping = false;

async function main(): Promise<void> {
  // Both planes. See the header — the book plane holds the jobs, the main plane holds
  // StoredFile, and filing a PDF touches both.
  await connectDb();
  await connectBookDb();
  console.log(`[book-worker] ${WORKER_ID} up`);

  // A worker killed mid-render leaves a RUNNING row that blocks the queue forever,
  // because claimNextJob refuses while anything is RUNNING. Clearing on boot is what
  // makes a crash self-healing rather than a morning of confusion.
  const requeued = await requeueStuckJobs(STUCK_AFTER_MS);
  if (requeued) console.log(`[book-worker] requeued ${requeued} stuck job(s)`);

  await workerLoop({
    workerId: WORKER_ID,
    shouldStop: () => stopping,
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // a second signal means "now"
    stopping = true;
    // Deliberately NOT killing an in-flight render: a half-written PDF that got
    // uploaded is worse than waiting for the current book to finish. The loop exits
    // after the job it is on.
    console.log(`[book-worker] ${sig} — finishing the current job, then exiting`);
  });
}

main()
  .then(async () => {
    await disconnectBookDb();
    await disconnectDb();
    console.log("[book-worker] stopped");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[book-worker] fatal:", err);
    await disconnectBookDb().catch(() => undefined);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
