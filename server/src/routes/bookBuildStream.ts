/**
 * GET /book-builds/:jobId/stream — the live build log (SB-4, D-#418).
 *
 * Server-Sent Events: one-directional, no WebSocket, the workbench's proven choice for
 * exactly this. A build that fails on lesson 31's fit guard should say so WHILE it is
 * failing — the person watching is the one who can fix it, and a four-minute silence
 * followed by a report wastes the only window where that is cheap.
 *
 * IT TAILS THE DATABASE, not an in-process emitter, because the worker is a separate
 * process (D-#407) and cannot publish into this one. Two things fall out, both good:
 * a browser that reconnects gets the whole log from byte 0 rather than joining
 * mid-stream, and the log survives the worker dying.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { buildContext } from "../context";
import { callerHasPermission } from "@scd/shared";
import { BookBuildJob } from "../modules/support-book/models/BookBuildJob";
import { isBookDbReady } from "../bookDb";

export const bookBuildStreamRouter: Router = createRouter();

/** How often the DB is re-read. A render is minutes long; a second of latency on a
 *  log line is invisible, and a tighter poll would just tax Mongo for nothing. */
const POLL_MS = 1_000;
/** Stop following once the job has been terminal this long, so a forgotten tab does
 *  not poll forever. */
const LINGER_MS = 5_000;

bookBuildStreamRouter.get("/:jobId/stream", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "book:read")) {
    res.status(403).json({ error: "অনুমতি নেই" });
    return;
  }
  if (!isBookDbReady()) {
    res.status(503).json({ error: "বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Caddy and Cloudflare both buffer by default; without this the client sees nothing
  // until the response closes, which defeats the entire point of streaming.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let sent = 0;
  let closed = false;
  let terminalSince: number | null = null;

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  req.on("close", () => { closed = true; });

  const tick = async (): Promise<void> => {
    if (closed) return;
    const job = await BookBuildJob.findById(req.params.jobId).select("state log failureReason").lean();
    if (!job) {
      send("error", { message: "job not found" });
      closed = true;
      res.end();
      return;
    }

    const log = job.log ?? "";
    if (log.length > sent) {
      send("log", { chunk: log.slice(sent) });
      sent = log.length;
    }
    send("state", { state: job.state, failureReason: job.failureReason ?? null });

    const terminal = job.state === "SUCCEEDED" || job.state === "FAILED" || job.state === "CANCELLED";
    if (terminal) {
      // One extra beat after the terminal state so a late log flush is not lost.
      terminalSince ??= Date.now();
      if (Date.now() - terminalSince >= LINGER_MS) {
        send("done", { state: job.state });
        closed = true;
        res.end();
        return;
      }
    }
    setTimeout(() => { void tick(); }, POLL_MS);
  };

  await tick();
});
