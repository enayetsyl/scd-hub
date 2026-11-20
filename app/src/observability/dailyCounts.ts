/**
 * Network / push-token failures as ONE daily count per device (D-#1657).
 *
 * These used to be one GlitchTip event per failed request (1,816 of 2,015 events in 31 days)
 * and told us nothing a count does not. Now each failure only bumps a per-day counter (by
 * operation name; push-token failures count as operation "push-token"), kept in memory and in
 * storage so it survives an app restart. The first time the app is opened on a LATER day, ONE
 * info message goes out for the past day(s): text "Network failures (daily count)", fingerprint
 * ["app-network-daily"], extra {date, total, topOperations, platform}. At most one send per
 * device per calendar day, and only for a day that has ended. Web: on first load. Native: on
 * the first foreground (AppState "active"). Never from the background.
 */
import { AppState, Platform } from "react-native";
import { getItem, setItem } from "../lib/storage";
import { captureAppMessage, sentryEnabled } from "./sentry";

const COUNTS_KEY = "scd.errorCounts.v1";
const SENT_KEY = "scd.errorCountsSentOn.v1";
const TOP_N = 8;

type DayCount = { total: number; ops: Record<string, number> };
type Counts = Record<string, DayCount>;

let counts: Counts = {};
let loaded: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function merge(into: Counts, from: Counts): void {
  for (const [date, c] of Object.entries(from)) {
    const t = (into[date] ??= { total: 0, ops: {} });
    t.total += c.total;
    for (const [op, n] of Object.entries(c.ops)) t.ops[op] = (t.ops[op] ?? 0) + n;
  }
}

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = await getItem(COUNTS_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Counts;
        if (stored && typeof stored === "object") merge(counts, stored);
      }
    } catch {
      /* unreadable storage — start from what is in memory */
    }
  })();
  return loaded;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void load().then(() => setItem(COUNTS_KEY, JSON.stringify(counts)).catch(() => undefined));
  }, 2000);
}

/** Count one failure against today. `operation` is the query/mutation name, or "push-token". */
export function countFailure(operation: string): void {
  if (!sentryEnabled) return;
  const t = (counts[dayKey()] ??= { total: 0, ops: {} });
  t.total += 1;
  t.ops[operation] = (t.ops[operation] ?? 0) + 1;
  schedulePersist();
}

/** Send the one daily message for past days, if not already sent today. */
export async function flushDailyCounts(now: Date = new Date()): Promise<void> {
  if (!sentryEnabled) return;
  try {
    await load();
    const today = dayKey(now);
    if ((await getItem(SENT_KEY)) === today) return;
    const past = Object.keys(counts).filter((d) => d < today).sort();
    if (past.length === 0) return;
    const merged: Counts = {};
    for (const d of past) merge(merged, { [d]: counts[d] });
    let total = 0;
    const ops: Record<string, number> = {};
    for (const d of past) {
      total += merged[d].total;
      for (const [op, n] of Object.entries(merged[d].ops)) ops[op] = (ops[op] ?? 0) + n;
    }
    const topOperations = Object.entries(ops)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([operation, n]) => ({ operation, count: n }));
    captureAppMessage("Network failures (daily count)", {
      fingerprint: ["app-network-daily"],
      extra: {
        date: past[past.length - 1],
        days: past.length > 1 ? past : undefined,
        total,
        topOperations,
        platform: Platform.OS,
      },
    });
    for (const d of past) delete counts[d];
    await setItem(SENT_KEY, today);
    await setItem(COUNTS_KEY, JSON.stringify(counts));
  } catch {
    /* reporting must never break the app */
  }
}

let started = false;
/** App boot: flush once on load; on native also on every return to the foreground. */
export function startDailyCountReporter(): void {
  if (started || !sentryEnabled) return;
  started = true;
  void flushDailyCounts();
  if (Platform.OS !== "web") {
    AppState.addEventListener("change", (s) => {
      if (s === "active") void flushDailyCounts();
    });
  }
}
