/**
 * Watching one AI Workspace answer as it is written (W-2, D-#1205).
 *
 * WEB: GET /events/ai-chat/:messageId — fetch-streaming SSE with the bearer token in the
 * header (the liveEvents pattern; EventSource cannot send it). Each `delta` frame carries the
 * whole answer so far, so a dropped frame costs nothing.
 * PHONE: React Native's fetch cannot stream a body, so the caller polls instead
 * (`usePollWhile` in the chat screen). This function returns null there.
 */
import { Platform } from "react-native";
import { REST_BASE } from "../graphql/client";
import { getToken } from "./tokenStore";

export interface ChatDelta {
  text: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  error: string | null;
}

/** Streams one answer; returns an unsubscribe, or null where streaming is not possible. */
export function watchAiAnswer(messageId: string, onDelta: (d: ChatDelta) => void, onEnd: () => void): (() => void) | null {
  if (Platform.OS !== "web") return null;
  const controller = new AbortController();
  let ended = false;
  const end = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  void (async () => {
    try {
      const token = getToken();
      const res = await fetch(`${REST_BASE}/events/ai-chat/${encodeURIComponent(messageId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return end();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const lines = frame.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7).trim();
          const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (event === "delta" && data) {
            try {
              onDelta(JSON.parse(data) as ChatDelta);
            } catch {
              // a torn frame — the next one carries the whole text again
            }
          }
          if (event === "end") return end();
          sep = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // aborted or dropped — the caller refetches on end
    }
    end();
  })();
  return () => {
    ended = true;
    controller.abort();
  };
}
