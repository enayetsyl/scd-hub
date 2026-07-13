/**
 * Live event subscriber (D-#295) — the client half of GET /events/stream.
 *
 * Opens ONE authenticated SSE stream (fetch + ReadableStream, so the bearer
 * token travels in the Authorization HEADER — EventSource can't do that) and
 * calls `onEvent(topic)` for every push. The events are "something changed"
 * nudges; the caller refetches its query.
 *
 * WEB ONLY: React Native's fetch cannot stream response bodies, so native
 * builds return a no-op unsubscribe and keep their polling fallback. The
 * stream auto-reconnects with backoff (2s → 30s) and stops cleanly when the
 * returned unsubscribe runs.
 */
import { Platform } from "react-native";
import { REST_BASE } from "../graphql/client";
import { getToken } from "./tokenStore";

export type LiveEventHandler = (topic: string) => void;

const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

export function subscribeLiveEvents(topics: string[], onEvent: LiveEventHandler): () => void {
  if (Platform.OS !== "web" || topics.length === 0) return () => {};

  let stopped = false;
  let controller: AbortController | null = null;
  let backoff = BACKOFF_START_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;
    const token = getToken();
    if (!token) {
      scheduleRetry(); // not logged in (yet) — try again later
      return;
    }
    controller = new AbortController();
    try {
      const res = await fetch(
        `${REST_BASE}/events/stream?topics=${encodeURIComponent(topics.join(","))}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
      );
      if (!res.ok || !res.body) {
        // 401/403 = not entitled — retry slowly in case the session changes.
        backoff = BACKOFF_MAX_MS;
        scheduleRetry();
        return;
      }
      backoff = BACKOFF_START_MS; // healthy connection resets the ladder
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        let sep = buffer.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
          const topic = eventLine?.slice("event: ".length).trim();
          if (topic && topic !== "ready") onEvent(topic);
          sep = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // network drop / abort — fall through to reconnect
    }
    if (!stopped) scheduleRetry();
  }

  function scheduleRetry(): void {
    if (stopped) return;
    retryTimer = setTimeout(() => void connect(), backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }

  void connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
  };
}
