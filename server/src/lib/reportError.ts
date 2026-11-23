/**
 * Report a failure that must NOT undo the user's action (AL-6): log it and send it to the server's Sentry (GlitchTip,
 * observability/sentry.ts) when that is configured. Never throws.
 */
export async function reportSilentFailure(where: string, err: unknown, extra?: Record<string, unknown>): Promise<void> {
  console.error(`[${where}]`, err);
  try {
    const m = await import("../observability/sentry");
    if (m.sentryEnabled) m.Sentry.captureException(err, { tags: { where }, ...(extra ? { extra } : {}) });
  } catch {
    /* telemetry must never fail the caller */
  }
}

/** A short Bangla reason for a caught error (the service's own Bangla sentence when it has one). */
export function reasonBn(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  return /[ঀ-৿]/.test(m) ? m : "অজানা সমস্যা — অফিসকে জানান";
}
