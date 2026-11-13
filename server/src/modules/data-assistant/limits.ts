/**
 * Rate, concurrency, time and size limits for the data assistant (docs/prd-data-assistant-mcp.md
 * §8.2; D-#1539). Both doors together, per person. In-process counters: the server is one
 * process (one VM), and a restart only forgets a minute's counts — the per-day count is read
 * from the `AiDataCall` log so it survives restarts.
 */
import { Types } from "mongoose";
import { dhakaDayStart } from "../../lib/dhakaDay";
import { AiDataCall } from "./models/AiDataCall";

export const LIMITS = {
  perMinute: 30,
  perDay: 600,
  inFlightPerPerson: 2,
  inFlightServer: 6,
  waitMs: 5000,
  callTimeoutMs: 15_000,
  replyBytes: 60 * 1024,
  argsBytes: 2048,
};

const minuteHits = new Map<string, number[]>();
const inFlight = new Map<string, number>();
let inFlightTotal = 0;

/** Test hook: clear every counter. */
export function resetLimits(): void {
  minuteHits.clear();
  inFlight.clear();
  inFlightTotal = 0;
}

export type LimitRefusal = { error: "rate_limited"; retryAfterS: number };

/** Counts one call against the per-minute and per-day limits; null = allowed. */
export async function checkRate(userId: string, now = Date.now()): Promise<LimitRefusal | null> {
  const hits = (minuteHits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= LIMITS.perMinute) {
    minuteHits.set(userId, hits);
    return { error: "rate_limited", retryAfterS: Math.max(1, Math.ceil((60_000 - (now - hits[0])) / 1000)) };
  }
  if (Types.ObjectId.isValid(userId)) {
    const today = await AiDataCall.countDocuments({ userId: new Types.ObjectId(userId), at: { $gte: dhakaDayStart(new Date(now)) }, outcome: { $ne: "limited" } });
    if (today >= LIMITS.perDay) {
      const tomorrow = dhakaDayStart(new Date(now)).getTime() + 86_400_000;
      return { error: "rate_limited", retryAfterS: Math.max(1, Math.ceil((tomorrow - now) / 1000)) };
    }
  }
  hits.push(now);
  minuteHits.set(userId, hits);
  return null;
}

/** Waits up to `waitMs` for a slot (2 per person, 6 server-wide). Returns a release fn, or null = busy. */
export async function acquireSlot(userId: string): Promise<(() => void) | null> {
  const deadline = Date.now() + LIMITS.waitMs;
  for (;;) {
    const mine = inFlight.get(userId) ?? 0;
    if (mine < LIMITS.inFlightPerPerson && inFlightTotal < LIMITS.inFlightServer) {
      inFlight.set(userId, mine + 1);
      inFlightTotal++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight.set(userId, Math.max(0, (inFlight.get(userId) ?? 1) - 1));
        inFlightTotal = Math.max(0, inFlightTotal - 1);
      };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export class ToolTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "ToolTimeout";
  }
}

/** Abandons the reply after `ms` (the service may still finish; its result is dropped). */
export function withTimeout<T>(p: Promise<T>, ms = LIMITS.callTimeoutMs): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => t && clearTimeout(t)),
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new ToolTimeout()), ms);
    }),
  ]);
}
