/**
 * TelegramBotService — what the bot does with one Telegram update (TB-1, D-#1666, docs/prd-telegram-bot.md).
 *
 * `handleUpdate` is idempotent (update_id is stored) and never throws. Flow, in Bangla:
 *   unlinked chat → one short refusal, no data · `/start <token>` links · `/stop` unlinks
 *   photos → collected (≤ 5) · voice or text → Gemini drafts the report → buttons ঠিক আছে / সংশোধন / বাদ দিন
 *   সংশোধন → the next voice/text re-drafts · ঠিক আছে → a GitHub issue (screenshots on the orphan `bug-assets`
 *   branch) → "টিকিট #N তৈরি হয়েছে" and every linked Principal chat is alerted · /new /cancel · 10 tickets/user/day.
 * All outside calls go through `telegramDeps()`; with no TELEGRAM_BOT_TOKEN nothing runs.
 */
import { Types } from "mongoose";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayStart } from "../../platform/services/AiUsageService";
import { TelegramLink } from "../models/TelegramLink";
import { TelegramReport, stateSet, type ITelegramReport, type ReportDraft } from "../models/TelegramReport";
import { TelegramUpdateSeen } from "../models/TelegramUpdateSeen";
import { consumeLinkToken, linkForChat, unlinkChat } from "./TelegramLinkService";
import { MAX_PHOTOS, draftReport } from "./reportDraft";
import { TelegramBotError, botEnabled, env, telegramDeps } from "./telegramDeps";

export const MAX_TICKETS_PER_DAY = 10;
export const MAX_VOICE_SECONDS = 5 * 60;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
const OPEN_STATES = ["COLLECTING", "DRAFTED", "CORRECTING"] as const;

export const MSG = {
  unlinked: "প্রথমে স্কুলের অ্যাপ থেকে Telegram যুক্ত করুন (প্রোফাইল → Telegram বট)।",
  linked: "যুক্ত হয়েছে ✓ এবার কোনো সমস্যা হলে স্ক্রিনশট পাঠান, তারপর ভয়েস নোটে বা লিখে সমস্যাটা বলুন।",
  badToken: "লিংকটি পুরোনো বা আগেই ব্যবহার করা হয়েছে। অ্যাপ থেকে নতুন লিংক নিন।",
  stopped: "Telegram বিচ্ছিন্ন হয়েছে। আবার যুক্ত হতে অ্যাপ থেকে লিংক নিন।",
  notLinked: "এই চ্যাট কোনো অ্যাকাউন্টে যুক্ত নেই।",
  photo: "ছবি পেলাম। এবার ভয়েস নোটে বা লিখে সমস্যাটা বলুন।",
  tooManyPhotos: `সর্বোচ্চ ${MAX_PHOTOS}টি ছবি নেওয়া যায়। এবার ভয়েস নোটে বা লিখে সমস্যাটা বলুন।`,
  writing: "লিখছি…",
  fixAsk: "কী ঠিক করতে হবে ভয়েস নোটে বা লিখে বলুন।",
  cancelled: "বাদ দেওয়া হয়েছে।",
  nothingOpen: "বাদ দেওয়ার মতো কোনো রিপোর্ট খোলা নেই।",
  fresh: "নতুন রিপোর্ট শুরু। স্ক্রিনশট পাঠান, তারপর ভয়েস নোটে বা লিখে সমস্যাটা বলুন।",
  pressButton: "নিচের বোতাম চাপুন — ঠিক আছে, সংশোধন বা বাদ দিন।",
  help: "সমস্যা জানাতে: স্ক্রিনশট পাঠান, তারপর ভয়েস নোটে বা লিখে বলুন। /new নতুন রিপোর্ট · /cancel বাদ · /stop বিচ্ছিন্ন।",
  limit: `আজ ${MAX_TICKETS_PER_DAY}টি টিকিট হয়ে গেছে — কাল আবার পাঠান।`,
  ticketOff: "টিকিট করার সুবিধাটি এখনো চালু হয়নি।",
  fileFailed: "টিকিট করতে পারিনি। একটু পরে আবার ‘ঠিক আছে’ চাপুন।",
  draftFailed: "এখন রিপোর্ট লিখতে পারছি না। একটু পরে আবার পাঠান।",
  noMedia: "ফাইলটি আনতে পারিনি। আবার পাঠান।",
  voiceTooLong: "ভয়েস নোট ৫ মিনিটের কম আর ৫ MB-র ছোট হতে হবে। ছোট করে আবার পাঠান।",
  useImage: "স্ক্রিনশট ছবি (Photo) হিসেবে পাঠান, ফাইল হিসেবে নয়। তারপর ভয়েস নোটে বা লিখে সমস্যাটা বলুন।",
  photoAdded: "ছবি যোগ হয়েছে — টিকিটে থাকবে। রিপোর্ট নতুন করে লেখাতে ‘সংশোধন’ চাপুন।",
};

const BUTTONS = (id: string) => [
  [
    { text: "✅ ঠিক আছে", data: `ok:${id}` },
    { text: "✏️ সংশোধন", data: `fix:${id}` },
    { text: "❌ বাদ দিন", data: `no:${id}` },
  ],
];

const SEVERITY_BN: Record<ReportDraft["severity"], string> = { low: "কম", medium: "মাঝারি", high: "বেশি" };

export function renderDraft(d: ReportDraft): string {
  const lines = [`📝 ${d.title}`];
  if (d.screen) lines.push(`স্ক্রিন: ${d.screen}`);
  lines.push(`কী হয়েছে: ${d.whatHappened}`);
  if (d.expected) lines.push(`কী হওয়ার কথা ছিল: ${d.expected}`);
  if (d.steps.length) lines.push("ধাপ:\n" + d.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  lines.push(`গুরুত্ব: ${SEVERITY_BN[d.severity]}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Telegram update shapes (only what we read)
// ---------------------------------------------------------------------------
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { username?: string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  voice?: { file_id: string; duration?: number; file_size?: number };
  audio?: { file_id: string; duration?: number; file_size?: number; mime_type?: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number; type: string } } };
}

const say = (chatId: number, text: string, kb?: Parameters<ReturnType<typeof telegramDeps>["telegram"]["sendMessage"]>[2]) =>
  telegramDeps().telegram.sendMessage(chatId, text, kb);

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
/** True the first time an update id is seen. */
async function firstTime(updateId: number): Promise<boolean> {
  try {
    await TelegramUpdateSeen.create({ updateId });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (!botEnabled()) return;
  try {
    if (typeof update?.update_id !== "number" || !(await firstTime(update.update_id))) return;
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (err) {
    // Never throw into the webhook; log the class only (no content, no tokens).
    console.error("[telegram] update failed:", err instanceof Error ? err.name : "error");
  }
}

async function onMessage(m: TgMessage): Promise<void> {
  if (m.chat.type !== "private") return;
  const chatId = m.chat.id;
  const text = (m.text ?? "").trim();

  if (text.startsWith("/start")) {
    const token = text.split(/\s+/)[1];
    if (token) {
      const link = await consumeLinkToken(token, chatId, m.from?.username ?? null);
      await say(chatId, link ? MSG.linked : MSG.badToken);
      return;
    }
  }
  if (text === "/stop") {
    await say(chatId, (await unlinkChat(chatId)) ? MSG.stopped : MSG.notLinked);
    return;
  }

  const link = await linkForChat(chatId);
  if (!link) {
    await say(chatId, MSG.unlinked);
    return;
  }
  const me = { chatId, userId: link.userId, role: link.role };

  if (text.startsWith("/")) {
    if (text === "/new") {
      await TelegramReport.updateMany({ chatId, state: { $in: [...OPEN_STATES] } }, { $set: stateSet("CANCELLED") });
      await openReport(me);
      await say(chatId, MSG.fresh);
    } else if (text === "/cancel") {
      const res = await TelegramReport.updateMany({ chatId, state: { $in: [...OPEN_STATES] } }, { $set: stateSet("CANCELLED") });
      await say(chatId, res.modifiedCount ? MSG.cancelled : MSG.nothingOpen);
    } else {
      await say(chatId, MSG.help);
    }
    return;
  }

  if (m.photo?.length) {
    const biggest = [...m.photo].sort((x, y) => y.width * y.height - x.width * x.height).find((q) => Math.max(q.width, q.height) <= 1600) ?? m.photo[0];
    const before = await openReport(me);
    // Conditional push: at most ${MAX_PHOTOS} even when an album arrives as parallel updates.
    const pushed = await TelegramReport.updateOne({ _id: before._id, [`photoFileIds.${MAX_PHOTOS - 1}`]: { $exists: false } }, { $push: { photoFileIds: biggest.file_id } });
    if (!pushed.modifiedCount) {
      await say(chatId, MSG.tooManyPhotos);
      return;
    }
    const caption = (m.caption ?? "").trim();
    if (caption && before.state !== "DRAFTED") await onInput(me, { text: caption });
    else await say(chatId, before.state === "DRAFTED" ? MSG.photoAdded : MSG.photo);
    return;
  }

  const voice = m.voice ?? m.audio;
  if (voice) {
    if ((voice.duration ?? 0) > MAX_VOICE_SECONDS || (voice.file_size ?? 0) > MAX_VOICE_BYTES) {
      await say(chatId, MSG.voiceTooLong);
      return;
    }
    const mime = m.voice ? "audio/ogg" : (m.audio?.mime_type ?? "audio/mpeg");
    await onInput(me, { voiceId: voice.file_id, voiceMime: mime, text: (m.caption ?? "").trim() || undefined });
    return;
  }
  if (text) await onInput(me, { text });
  else await say(chatId, MSG.useImage); // a document, sticker, video ... : tell them how
}

type Me = { chatId: number; userId: Types.ObjectId; role: string };

/** Atomic get-or-create of the chat's one open report (a unique partial index backs it; the loser of a race re-reads). */
async function openReport(me: Me): Promise<ITelegramReport> {
  const find = () => TelegramReport.findOne({ chatId: me.chatId, open: true });
  try {
    const row = await TelegramReport.findOneAndUpdate(
      { chatId: me.chatId, open: true },
      { $setOnInsert: { userId: me.userId, role: me.role, state: "COLLECTING" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (row) return row;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  return (await find())!;
}

async function fetchMedia(items: Array<{ id: string; mime: string }>): Promise<Array<{ mime: string; data: string }>> {
  const out: Array<{ mime: string; data: string }> = [];
  for (const it of items) {
    const f = await telegramDeps().telegram.downloadFile(it.id, it.mime);
    if (it.mime.startsWith("audio/") && f.data.length > MAX_VOICE_BYTES) throw new TelegramBotError(MSG.voiceTooLong);
    out.push({ mime: f.mime, data: f.data.toString("base64") });
  }
  return out;
}

async function onInput(me: Me, input: { voiceId?: string; voiceMime?: string; text?: string }): Promise<void> {
  const report = await openReport(me);
  if (report.state === "DRAFTED" && report.draft) {
    await say(me.chatId, MSG.pressButton);
    await say(me.chatId, renderDraft(report.draft), BUTTONS(report._id.toString()));
    return;
  }
  const correcting = report.state === "CORRECTING" && !!report.draft;
  await say(me.chatId, MSG.writing);
  try {
    const newVoice = input.voiceId ? await fetchMedia([{ id: input.voiceId, mime: input.voiceMime ?? "audio/ogg" }]) : [];
    const oldVoices = correcting ? [] : await fetchMedia(report.voiceFileIds.map((id, i) => ({ id, mime: report.voiceMimes[i] ?? "audio/ogg" })));
    const photos = await fetchMedia(report.photoFileIds.slice(0, 3).map((id) => ({ id, mime: "image/jpeg" })));
    const result = await draftReport({
      voices: [...oldVoices, ...newVoice],
      photos,
      texts: [...report.texts, ...(input.text && !correcting ? [input.text] : [])],
      previous: correcting ? report.draft : null,
      correctionText: correcting ? input.text : undefined,
      refId: report._id.toString(),
    });
    // The first transcript is kept; a correction's words are appended, never overwritten.
    const transcript = correcting
      ? [report.transcript, result.transcript && result.transcript !== report.transcript ? `সংশোধন: ${result.transcript}` : "", input.text ? `সংশোধন: ${input.text}` : ""].filter(Boolean).join(String.fromCharCode(10).repeat(2))
      : result.transcript || report.transcript;
    await TelegramReport.updateOne(
      { _id: report._id },
      {
        $set: { ...stateSet("DRAFTED"), draft: result.draft, transcript },
        ...(correcting ? {} : { $push: { ...(input.voiceId ? { voiceFileIds: input.voiceId, voiceMimes: input.voiceMime ?? "audio/ogg" } : {}), ...(input.text ? { texts: input.text } : {}) } }),
      },
    );
    await say(me.chatId, renderDraft(result.draft), BUTTONS(report._id.toString()));
  } catch (err) {
    await say(me.chatId, err instanceof TelegramBotError ? err.message : MSG.draftFailed);
    if (!(err instanceof TelegramBotError)) console.error("[telegram] draft failed:", err instanceof Error ? err.name : "error");
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
async function onCallback(cb: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const { telegram } = telegramDeps();
  await telegram.answerCallbackQuery(cb.id).catch(() => undefined);
  const chatId = cb.message?.chat.id;
  const [action, id] = (cb.data ?? "").split(":");
  if (!chatId || !id || !Types.ObjectId.isValid(id)) return;
  const link = await linkForChat(chatId);
  if (!link) {
    await say(chatId, MSG.unlinked);
    return;
  }
  const report = await TelegramReport.findOne({ _id: id, chatId, userId: link.userId });
  if (!report || !(OPEN_STATES as readonly string[]).includes(report.state)) return;
  const retire = () => (cb.message ? telegram.editMessageText(chatId, cb.message.message_id, report.draft ? renderDraft(report.draft) : "…").catch(() => undefined) : undefined);

  if (action === "no") {
    await TelegramReport.updateOne({ _id: report._id }, { $set: stateSet("CANCELLED") });
    await retire();
    await say(chatId, MSG.cancelled);
  } else if (action === "fix" && report.state === "DRAFTED") {
    await TelegramReport.updateOne({ _id: report._id }, { $set: stateSet("CORRECTING") });
    await say(chatId, MSG.fixAsk);
  } else if (action === "ok" && report.state === "DRAFTED" && report.draft) {
    await fileReport(report, link.userId, link.role, chatId, retire);
  }
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------
const clean = (s: string) => s.replace(/@/g, "@​"); // never ping anyone from a public issue

function issueBody(d: ReportDraft, r: ITelegramReport, name: string, images: string[], at: Date): string {
  const lines = [
    "## কী হয়েছে",
    clean(d.whatHappened),
    "",
    "## কী হওয়ার কথা ছিল",
    clean(d.expected || "—"),
    "",
    "## স্ক্রিন",
    clean(d.screen || "—"),
    "",
    "## ধাপ",
    ...(d.steps.length ? d.steps.map((s, i) => `${i + 1}. ${clean(s)}`) : ["—"]),
    "",
    `**গুরুত্ব:** ${SEVERITY_BN[d.severity]}`,
  ];
  if (r.transcript) lines.push("", "## ভয়েস নোটের লেখা", clean(r.transcript));
  if (images.length) lines.push("", "## স্ক্রিনশট", ...images.map((u) => `![screenshot](${u})`));
  lines.push("", "---", `জানিয়েছেন: ${clean(name)} (${r.role.toLowerCase()}) · ${at.toISOString().slice(0, 10)} · Telegram বট`);
  return lines.join("\n");
}

async function fileReport(report: ITelegramReport, userId: Types.ObjectId, role: string, chatId: number, retire: () => unknown): Promise<void> {
  const { github } = telegramDeps();
  if (!env.githubToken()) {
    await say(chatId, MSG.ticketOff);
    return;
  }
  const today = await TelegramReport.countDocuments({ userId, state: "FILED", filedAt: { $gte: dhakaDayStart(new Date()) } });
  if (today >= MAX_TICKETS_PER_DAY) {
    await say(chatId, MSG.limit);
    return;
  }
  // Claim the report so a double tap files once.
  const at = new Date();
  const claimed = await TelegramReport.findOneAndUpdate({ _id: report._id, state: "DRAFTED" }, { $set: { ...stateSet("FILED"), filedAt: at } }, { new: true });
  if (!claimed || !claimed.draft) return;
  let issue: { number: number; url: string };
  try {
    const month = at.toISOString().slice(0, 7);
    const urls: string[] = [];
    let n = 0;
    for (const fileId of claimed.photoFileIds) {
      n += 1;
      try {
        const f = await telegramDeps().telegram.downloadFile(fileId, "image/jpeg");
        urls.push(await github.uploadAsset(`tg/${month}/${claimed._id.toString()}-${n}.jpg`, f.data));
      } catch {
        /* a screenshot that will not upload must not stop the ticket */
      }
    }
    const user = (await User.findById(userId).select("name").lean()) as { name?: string } | null;
    const labels = ["bug-report", "from-telegram", role === "GUARDIAN" ? "guardian" : "staff"];
    await github.ensureLabels(labels);
    issue = await github.createIssue({ title: clean(claimed.draft.title), body: issueBody(claimed.draft, claimed, user?.name ?? "—", urls, at), labels });
  } catch (err) {
    // Only a failure BEFORE the issue exists puts the draft back; once createIssue returned we never revert.
    await TelegramReport.updateOne({ _id: claimed._id }, { $set: { ...stateSet("DRAFTED"), filedAt: null } });
    console.error("[telegram] filing failed:", err instanceof Error ? err.name : "error");
    await say(chatId, MSG.fileFailed);
    return;
  }
  // The public issue exists: record it first, then every follow-up in its own catch-all.
  const follow = async (label: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[telegram] ${label} failed:`, err instanceof Error ? err.name : "error");
    }
  };
  await follow("record issue", () => TelegramReport.updateOne({ _id: claimed._id }, { $set: { issueNumber: issue.number, issueUrl: issue.url } }));
  await follow("retire buttons", retire);
  await follow("confirm", () => say(chatId, `টিকিট #${issue.number} তৈরি হয়েছে — ${issue.url}`));
  await follow("audit", () => writeAudit({ eventKind: "TELEGRAM_TICKET_FILED", actorId: userId, actorRole: role, meta: { issueNumber: issue.number } }));
  await follow("alert principals", () => alertPrincipals(issue.number, issue.url, claimed.draft!.title, chatId));
}

async function alertPrincipals(num: number, url: string, title: string, exceptChat: number): Promise<void> {
  const links = await TelegramLink.find({ role: "PRINCIPAL", active: true, chatId: { $ne: exceptChat } }).lean();
  for (const l of links) await say(l.chatId, `🆕 নতুন টিকিট #${num}: ${title}\n${url}`).catch(() => undefined);
}
