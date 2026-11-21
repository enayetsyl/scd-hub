/**
 * TelegramLinkService — account link for the Telegram bot (TB-1, D-#1666, docs/prd-telegram-bot.md).
 *
 * App side: `createTelegramLink` mints a one-time token (15 min, single use; only its hash is stored)
 * and returns the `https://t.me/<bot>?start=<token>` deep link; `myTelegramLink` reports the state;
 * `unlinkTelegram` drops it. Bot side: `consumeLinkToken` (the `/start <token>` message) binds the chat,
 * `linkForChat` finds who a chat is, `unlinkChat` is `/stop`.
 *
 * Staff only for now. A guardian may link only when the `telegram_guardian` switch is ON (default OFF —
 * today read from env TELEGRAM_GUARDIAN_ENABLED=1; wiring it to the guardian release switch is a later
 * decision). Identity plane; no corpus path (ADR-005).
 */
import { createHash, randomBytes } from "crypto";
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { TelegramLink, type ITelegramLink } from "../models/TelegramLink";
import { TelegramLinkToken } from "../models/TelegramLinkToken";
import { TelegramBotError, botEnabled, botUsername } from "./telegramDeps";

export const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** The `telegram_guardian` switch. OFF unless the operator turns it on. */
export const guardianTelegramOn = (): boolean => process.env.TELEGRAM_GUARDIAN_ENABLED === "1";

/** A deactivated login must not keep a working bot. Guardians (not in User) pass this check. */
export async function accountActive(userId: Types.ObjectId | string, role: string): Promise<boolean> {
  const u = (await User.findById(userId).select("active").lean()) as { active?: boolean } | null;
  if (!u) return role === "GUARDIAN";
  return u.active !== false;
}

function who(ctx: AppContext): { userId: string; role: string } {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

/** Throws a Bangla refusal when this role may not link (guardian while the switch is OFF). */
export function assertMayLink(role: string): void {
  if (role === "GUARDIAN" && !guardianTelegramOn()) {
    throw new TelegramBotError("Telegram সুবিধাটি এখনো অভিভাবকদের জন্য চালু হয়নি।");
  }
}

export interface TelegramLinkView {
  linked: boolean;
  tgUsername: string | null;
  linkedAt: Date | null;
  /** False while the server has no bot token — the app hides the button. */
  available: boolean;
}

export async function myTelegramLink(ctx: AppContext): Promise<TelegramLinkView> {
  const { userId } = who(ctx);
  const link = (await TelegramLink.findOne({ userId: new Types.ObjectId(userId), active: true }).lean()) as ITelegramLink | null;
  return { linked: !!link, tgUsername: link?.tgUsername ?? null, linkedAt: link?.linkedAt ?? null, available: botEnabled() };
}

/** "View as" borrows another account: linking or unlinking THEIR Telegram is not the Principal's to do. */
function refuseViewAs(ctx: AppContext): void {
  if (ctx.auth?.impersonatorId) throw new TelegramBotError("অন্যের অ্যাকাউন্ট দেখার সময় Telegram যুক্ত বা বিচ্ছিন্ন করা যায় না।");
}

export async function createTelegramLink(ctx: AppContext, now = new Date()): Promise<{ url: string; expiresAt: Date }> {
  const { userId, role } = who(ctx);
  refuseViewAs(ctx);
  if (!botEnabled()) throw new TelegramBotError("Telegram বট এখনো চালু হয়নি।");
  assertMayLink(role);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS);
  await TelegramLinkToken.create({ tokenHash: hashToken(token), userId: new Types.ObjectId(userId), role, expiresAt });
  return { url: `https://t.me/${await botUsername()}?start=${token}`, expiresAt };
}

export async function unlinkTelegram(ctx: AppContext): Promise<boolean> {
  const { userId, role } = who(ctx);
  refuseViewAs(ctx);
  const res = await TelegramLink.deleteOne({ userId: new Types.ObjectId(userId) });
  if (res.deletedCount) {
    await writeAudit({ eventKind: "TELEGRAM_UNLINKED", actorId: userId, actorRole: role, meta: { via: "app" } }).catch(() => undefined);
  }
  return true;
}

/** The bot's `/start <token>`: validate (unused, unexpired) and bind the chat. Null = refused. */
export async function consumeLinkToken(token: string, chatId: number, tgUsername: string | null, now = new Date()): Promise<ITelegramLink | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const row = await TelegramLinkToken.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true },
  );
  if (!row) return null;
  if (row.role === "GUARDIAN" && !guardianTelegramOn()) return null;
  if (!(await accountActive(row.userId, row.role))) return null;
  // One chat belongs to one account, and one account has one chat: replace either old binding.
  await TelegramLink.deleteMany({ $or: [{ chatId }, { userId: row.userId }] });
  const link = await TelegramLink.create({ userId: row.userId, role: row.role, chatId, tgUsername, linkedAt: now, active: true });
  await writeAudit({ eventKind: "TELEGRAM_LINKED", actorId: row.userId, actorRole: row.role, meta: { via: "bot" } }).catch(() => undefined);
  return link;
}

export async function linkForChat(chatId: number): Promise<ITelegramLink | null> {
  const link = (await TelegramLink.findOne({ chatId, active: true }).lean()) as ITelegramLink | null;
  if (!link) return null;
  if (link.role === "GUARDIAN" && !guardianTelegramOn()) return null;
  if (!(await accountActive(link.userId, link.role))) return null;
  return link;
}

/** `/stop`. True when a link existed. */
export async function unlinkChat(chatId: number): Promise<boolean> {
  const link = (await TelegramLink.findOneAndDelete({ chatId }).lean()) as ITelegramLink | null;
  if (link) await writeAudit({ eventKind: "TELEGRAM_UNLINKED", actorId: link.userId, actorRole: link.role, meta: { via: "bot" } }).catch(() => undefined);
  return !!link;
}
