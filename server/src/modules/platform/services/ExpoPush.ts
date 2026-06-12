/**
 * ExpoPush (AT-4, §9.3 / D-#65) — the server-side Expo push transport. Push is
 * the ONLY automatic notification channel for attendance reminders (D-#65);
 * WhatsApp stays a manual `wa.me` click (ADR-003).
 *
 * No SDK dependency: a plain HTTPS POST to the Expo push service (same posture
 * as DriveStore's plain-fetch Drive REST). Best-effort — a transport failure is
 * logged and swallowed, never propagated to the caller (a push must never block
 * the attendance flow or the trigger endpoint). Tokens Expo reports as
 * `DeviceNotRegistered` are returned so the caller can prune them (stale install).
 *
 * In jest this module is mocked — no live Expo in CI (§9.3 / tests).
 */
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100; // Expo accepts up to 100 messages per request.

export interface ExpoPushMessage {
  to: string; // ExponentPushToken[...]
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushResult {
  /** Messages accepted by Expo (ticket status "ok"). */
  okCount: number;
  /** Tokens Expo rejected as DeviceNotRegistered — caller should deactivate. */
  deadTokens: string[];
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/** Pure: split tickets back to dead tokens, aligned to the sent order. */
export function deadTokensFromTickets(
  sentTokens: string[],
  tickets: ExpoTicket[],
): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = sentTokens[i];
      if (token) dead.push(token);
    }
  });
  return dead;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Best-effort send. Never throws — returns counts + dead tokens to prune. */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
  const result: ExpoPushResult = { okCount: 0, deadTokens: [] };
  if (messages.length === 0) return result;

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(batch),
      });
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      result.okCount += tickets.filter((t) => t.status === "ok").length;
      result.deadTokens.push(
        ...deadTokensFromTickets(batch.map((m) => m.to), tickets),
      );
    } catch (err) {
      // Expo unreachable — log and move on; the reminder is best-effort (D-#65).
      console.error("[ExpoPush] send failed:", err);
    }
  }
  return result;
}
