/**
 * Telegram bot go-live (TB-1, D-#1666). NOT run by CI or deploys — the owner approves, then the lead runs it
 * once on the server (env already holds the values; nothing is printed):
 *
 *   cd server && npx tsx scripts/telegram-set-webhook.ts            # setWebhook -> /triggers/telegram/webhook
 *   cd server && npx tsx scripts/telegram-set-webhook.ts --delete   # deleteWebhook (switch the bot off)
 *   cd server && npx tsx scripts/telegram-set-webhook.ts --info     # getWebhookInfo (url + pending count only)
 *
 * Needs TELEGRAM_BOT_TOKEN and (for set) TELEGRAM_WEBHOOK_SECRET. One bot = one webhook, so run it on prod only.
 */
import "dotenv/config";

const HOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || "https://scdhub.shafayet.me/triggers/telegram/webhook";

async function call(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; description?: string; result?: unknown };
}

async function main(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const arg = process.argv[2];
  if (arg === "--delete") {
    const r = await call("deleteWebhook", { drop_pending_updates: false });
    console.log(r.ok ? "webhook deleted" : `failed: ${r.description}`);
    return;
  }
  if (arg === "--info") {
    const r = await call("getWebhookInfo", {});
    const info = (r.result ?? {}) as { url?: string; pending_update_count?: number; last_error_message?: string };
    console.log(JSON.stringify({ url: info.url, pending: info.pending_update_count, lastError: info.last_error_message ?? null }));
    return;
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set");
  const r = await call("setWebhook", { url: HOOK_URL, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  console.log(r.ok ? `webhook set -> ${HOOK_URL}` : `failed: ${r.description}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "failed");
  process.exit(1);
});
