/**
 * Realtime event bus (D-#295) — the in-process pub/sub behind the SSE stream.
 *
 * Single-node posture (D-#73): one process serves everything, so a plain
 * EventEmitter IS the whole message fabric — no Redis, no queue. Publishers
 * (services) fire-and-forget; the /events/stream route fans each event out to
 * its connected listeners. If the process restarts, clients reconnect and
 * refetch — every event here is a "something changed, refetch" NUDGE, never a
 * data carrier, so a lost event costs at most one poll interval of staleness.
 *
 * Identity/operational plane. Payloads must stay non-sensitive (topic + ids),
 * because a topic's gate is checked once at subscribe time.
 */
import { EventEmitter } from "events";

/** Topics + the permission that may LISTEN to each (checked at subscribe). */
export const REALTIME_TOPICS = {
  /** The Office print queue changed (created / printed / delivered / cancelled). */
  print_queue: "roster:manage",
} as const;

export type RealtimeTopic = keyof typeof REALTIME_TOPICS;

export interface RealtimeEvent {
  topic: RealtimeTopic;
  /** Small, non-sensitive hint payload ("what changed"), never the data itself. */
  payload: Record<string, string | number | boolean | null>;
  at: string;
}

const bus = new EventEmitter();
// Every connected SSE client is a listener per topic; the default cap of 10
// would start warning at 10 concurrent office tabs.
bus.setMaxListeners(500);

export function publishRealtime(
  topic: RealtimeTopic,
  payload: RealtimeEvent["payload"] = {},
): void {
  try {
    bus.emit(topic, { topic, payload, at: new Date().toISOString() } satisfies RealtimeEvent);
  } catch (err) {
    // Best-effort by contract — a realtime hiccup must never break a mutation.
    console.error("[realtime] publish failed:", err);
  }
}

/** Subscribe to one topic; returns the unsubscribe function. */
export function subscribeRealtime(
  topic: RealtimeTopic,
  listener: (e: RealtimeEvent) => void,
): () => void {
  bus.on(topic, listener);
  return () => bus.off(topic, listener);
}

export const isRealtimeTopic = (t: string): t is RealtimeTopic => t in REALTIME_TOPICS;
