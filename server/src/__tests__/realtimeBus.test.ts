/**
 * D-#295 — the in-process realtime bus behind /events/stream.
 *
 *   1. publish → every subscriber of that topic gets the event (topic, payload, at)
 *   2. unsubscribe stops delivery; other subscribers unaffected
 *   3. a publish with NO subscribers is a silent no-op (fire-and-forget contract)
 *   4. topic gating — isRealtimeTopic + the per-topic permission map
 */
import {
  publishRealtime,
  subscribeRealtime,
  isRealtimeTopic,
  REALTIME_TOPICS,
  type RealtimeEvent,
} from "../modules/realtime/bus";

describe("realtime bus (D-#295)", () => {
  test("publish fans out to every subscriber of the topic", () => {
    const a: RealtimeEvent[] = [];
    const b: RealtimeEvent[] = [];
    const offA = subscribeRealtime("print_queue", (e) => a.push(e));
    const offB = subscribeRealtime("print_queue", (e) => b.push(e));

    publishRealtime("print_queue", { op: "created", id: "x" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].topic).toBe("print_queue");
    expect(a[0].payload).toEqual({ op: "created", id: "x" });
    expect(typeof a[0].at).toBe("string");
    offA();
    offB();
  });

  test("unsubscribe stops delivery without affecting other listeners", () => {
    const a: RealtimeEvent[] = [];
    const b: RealtimeEvent[] = [];
    const offA = subscribeRealtime("print_queue", (e) => a.push(e));
    const offB = subscribeRealtime("print_queue", (e) => b.push(e));

    offA();
    publishRealtime("print_queue");

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    offB();
  });

  test("publishing with no subscribers is a silent no-op", () => {
    expect(() => publishRealtime("print_queue", { op: "printed" })).not.toThrow();
  });

  test("topic gate: known topics map to a listen permission; unknown strings are rejected", () => {
    expect(isRealtimeTopic("print_queue")).toBe(true);
    expect(isRealtimeTopic("nonsense")).toBe(false);
    expect(REALTIME_TOPICS.print_queue).toBe("roster:manage");
  });
});
