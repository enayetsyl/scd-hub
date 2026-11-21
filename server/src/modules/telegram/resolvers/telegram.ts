/**
 * Telegram bot link (TB-1, D-#1666, docs/prd-telegram-bot.md).
 *
 *   myTelegramLink · createTelegramLink · unlinkTelegram — the caller's OWN link (SELF, on the gate test's
 *   OPEN_FIELDS). Staff only for now: a guardian is refused in the service while `telegram_guardian` is OFF.
 *
 * The bot itself runs on the webhook (routes/telegramWebhook.ts), not through GraphQL.
 * Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { expectedGraphQLError } from "../../../observability/sentry";
import { createTelegramLink, myTelegramLink, unlinkTelegram, type TelegramLinkView } from "../services/TelegramLinkService";
import { TelegramBotError } from "../services/telegramDeps";

const TelegramLinkRef = builder.objectRef<TelegramLinkView>("TelegramLink").implement({
  description: "Whether the caller's account is linked to a Telegram chat.",
  fields: (t) => ({
    linked: t.exposeBoolean("linked"),
    available: t.exposeBoolean("available", { description: "False while the server has no bot token." }),
    tgUsername: t.string({ nullable: true, resolve: (l) => l.tgUsername }),
    linkedAt: t.string({ nullable: true, resolve: (l) => l.linkedAt?.toISOString() ?? null }),
  }),
});

const TelegramDeepLinkRef = builder.objectRef<{ url: string; expiresAt: Date }>("TelegramDeepLink").implement({
  fields: (t) => ({
    url: t.exposeString("url"),
    expiresAt: t.string({ resolve: (l) => l.expiresAt.toISOString() }),
  }),
});

builder.queryField("myTelegramLink", (t) =>
  t.field({
    type: TelegramLinkRef,
    authScopes: { authenticated: true },
    resolve: (_r, _a, ctx) => myTelegramLink(ctx),
  }),
);

builder.mutationField("createTelegramLink", (t) =>
  t.field({
    type: TelegramDeepLinkRef,
    description: "A one-time t.me deep link (15 minutes, single use) that links the caller's Telegram chat.",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => {
      try {
        return await createTelegramLink(ctx);
      } catch (e) {
        if (e instanceof TelegramBotError) throw expectedGraphQLError(e.message);
        throw e;
      }
    },
  }),
);

builder.mutationField("unlinkTelegram", (t) =>
  t.boolean({
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => {
      try {
        return await unlinkTelegram(ctx);
      } catch (e) {
        if (e instanceof TelegramBotError) throw expectedGraphQLError(e.message);
        throw e;
      }
    },
  }),
);
