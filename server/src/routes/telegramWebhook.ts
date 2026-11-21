/**
 * Telegram webhook (TB-1, D-#1666): POST /triggers/telegram/webhook — mounted BEFORE the /triggers router.
 *
 * Auth is the `X-Telegram-Bot-Api-Secret-Token` header, which must equal TELEGRAM_WEBHOOK_SECRET (else 401).
 * No TELEGRAM_BOT_TOKEN (or no secret) → 503 and nothing runs. A good call is answered 200 at once and the
 * update is handled in the background (Telegram retries slow webhooks; the handler dedupes on update_id).
 * Not a browser surface — no CORS.
 */
import { timingSafeEqual } from "crypto";
import express, { Router as createRouter, type Router } from "express";
import { handleUpdate, type TgUpdate } from "../modules/telegram/services/TelegramBotService";
import { botEnabled, env } from "../modules/telegram/services/telegramDeps";

export const telegramWebhookRouter: Router = createRouter();
telegramWebhookRouter.use(express.json({ limit: "1mb" }));

const pending = new Set<Promise<unknown>>();
/** Resolves when every update accepted so far has been handled — tests await it; nothing leaks between tests. */
export const flushWebhookWork = async (): Promise<void> => {
  while (pending.size) await Promise.all([...pending]);
};

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

telegramWebhookRouter.post("/webhook", (req, res) => {
  const secret = env.webhookSecret();
  if (!botEnabled() || !secret) {
    res.status(503).json({ error: "Telegram bot is off" });
    return;
  }
  if (!sameSecret(req.header("x-telegram-bot-api-secret-token") ?? "", secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.status(200).json({ ok: true });
  const work: Promise<unknown> = handleUpdate(req.body as TgUpdate)
    .catch(() => undefined)
    .finally(() => pending.delete(work));
  pending.add(work);
});
