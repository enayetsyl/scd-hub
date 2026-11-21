/**
 * Outgoing kill switch (AL-1, D-#1677) — fail-closed "nothing goes out" on a dev database.
 *
 * One guard, called at every seam that reaches the outside world (Expo / web / chat push,
 * Telegram + GitHub, AI providers, Drive). Rule:
 *   - OUTGOING_NOTIFICATIONS=off            -> BLOCKED on any database.
 *   - database name ends in `_dev`          -> BLOCKED unless OUTGOING_NOTIFICATIONS=on exactly.
 *   - anything else                         -> allowed (prod behaviour unchanged).
 * Unknown database name (no live connection and no parsable MONGODB_URI): only the explicit
 * `off` blocks. We never block prod by accident because a name could not be read.
 * Notification / pop-up ROWS are still written; only the send is skipped.
 */
import mongoose from "mongoose";

export type OutgoingChannel = "expo" | "webpush" | "chat" | "telegram" | "github" | "ai" | "drive";

/** The database name: the live connection first, else parsed from MONGODB_URI. Never logged with the URI. */
export function currentDbName(): string | null {
  const live = mongoose.connection?.name;
  if (live) return live;
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(process.env.MONGODB_URI ?? "");
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export interface OutgoingState {
  /** "ON" = sends go out; "OFF" = blocked. */
  state: "ON" | "OFF";
  reason: "flag_off" | "dev_db" | "allowed";
}

export function outgoingState(): OutgoingState {
  const flag = process.env.OUTGOING_NOTIFICATIONS;
  if (flag === "off") return { state: "OFF", reason: "flag_off" };
  const name = currentDbName();
  if (name && name.endsWith("_dev") && flag !== "on") return { state: "OFF", reason: "dev_db" };
  return { state: "ON", reason: "allowed" };
}

const logged = new Set<OutgoingChannel>();

/** True when this channel may reach the outside world. Logs once per channel per process when it blocks. */
export function outgoingAllowed(channel: OutgoingChannel): boolean {
  const s = outgoingState();
  if (s.state === "ON") return true;
  if (!logged.has(channel)) {
    logged.add(channel);
    console.warn(`[outgoing] ${channel} blocked (${s.reason}) — set OUTGOING_NOTIFICATIONS=on to allow on a dev database`);
  }
  return false;
}

/** Test helper: forget which channels were already logged. */
export function resetOutgoingLog(): void {
  logged.clear();
}

/** /readyz: which secrets are PRESENT (booleans only — never values). */
export function outgoingKeysPresent(): Record<string, boolean> {
  const keys = [
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "BOT_GEMINI_API_KEY",
  ];
  return Object.fromEntries(keys.map((k) => [k, !!process.env[k]]));
}
