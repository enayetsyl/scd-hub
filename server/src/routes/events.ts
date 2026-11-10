/**
 * GET /events/stream — the Server-Sent-Events push channel (D-#295).
 *
 * The app opens ONE authenticated stream (`?topics=print_queue,...`) and the
 * server pushes a tiny "changed" event whenever a subscribed topic fires on the
 * in-process bus — the client then refetches the affected query. Cross-device
 * realtime with zero new infra: plain HTTP streaming through Caddy/Cloudflare
 * (both pass `text/event-stream` unbuffered).
 *
 * Auth: the same bearer JWT as the other REST routes (the client uses
 * fetch-streaming, so the Authorization HEADER works — no token-in-URL).
 * Each topic has its own permission gate (bus.ts), checked at subscribe time;
 * a caller lacking a topic's permission simply doesn't get that topic.
 * A 25s heartbeat comment keeps proxies from idling the connection out.
 */
import { Router as createRouter, type Router, type Request, type Response } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../context";
import {
  REALTIME_TOPICS,
  isRealtimeTopic,
  subscribeRealtime,
  type RealtimeTopic,
} from "../modules/realtime/bus";
import { AiAssistMessage } from "../modules/ai-assist/models/AiAssistMessage";
import { assertCanWatchMessage } from "../modules/ai-workspace/services/ProjectChatService";

export const HEARTBEAT_MS = 25_000;

export const eventsRouter: Router = createRouter();

eventsRouter.get("/stream", (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const requested = String(req.query.topics ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  // Only known topics the CALLER may hear survive; an empty result is a 403 —
  // silently streaming nothing would read as a healthy connection.
  const topics = requested.filter(
    (t): t is RealtimeTopic => isRealtimeTopic(t) && callerHasPermission(ctx.auth!, REALTIME_TOPICS[t]),
  );
  if (topics.length === 0) {
    res.status(403).json({ error: "No subscribable topics" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // belt-and-braces against proxy buffering
  res.flushHeaders();

  // An immediate hello so the client knows the stream (and its auth) is live.
  res.write(`event: ready\ndata: ${JSON.stringify({ topics })}\n\n`);

  const unsubscribes = topics.map((topic) =>
    subscribeRealtime(topic, (e) => {
      res.write(`event: ${e.topic}\ndata: ${JSON.stringify(e)}\n\n`);
    }),
  );
  const heartbeat = setInterval(() => {
    res.write(`: hb ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    for (const off of unsubscribes) off();
  });
});

/**
 * GET /events/ai-chat/:messageId — one AI Workspace answer as it streams (W-2, D-#1205).
 *
 * The answer is written into its message row every ~400 ms by ProjectChatService; this route
 * TAILS that row (the BookBuild log pattern), so it works whichever process answers, and a
 * reconnect gets the whole text so far. Events: `delta` {text, status} whenever the text or
 * status changes; the stream ends once the answer is done / failed / stopped. Members of the
 * message's project only. Web only — React Native fetch cannot stream (the phone polls).
 */
export const AI_CHAT_TAIL_MS = 500;

eventsRouter.get("/ai-chat/:messageId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const messageId = String(req.params.messageId);
  try {
    await assertCanWatchMessage(ctx.auth, messageId);
  } catch {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastText = "";
  let lastStatus = "";
  let closed = false;
  const tick = async () => {
    if (closed) return;
    const m = await AiAssistMessage.findById(messageId).select("text status error").lean().catch(() => null);
    if (!m) return finish();
    const status = m.status ?? "done";
    if (m.text !== lastText || status !== lastStatus) {
      lastText = m.text ?? "";
      lastStatus = status;
      res.write(`event: delta\ndata: ${JSON.stringify({ text: lastText, status, error: m.error ?? null })}\n\n`);
    }
    if (status !== "running" && status !== "queued") finish();
  };
  const timer = setInterval(() => void tick(), AI_CHAT_TAIL_MS);
  const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 15_000);
  function finish(): void {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    res.write(`event: end\ndata: {}\n\n`);
    res.end();
  }
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
  });
  void tick();
});
