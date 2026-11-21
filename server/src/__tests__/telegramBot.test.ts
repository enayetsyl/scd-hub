/**
 * TB-1 — the Telegram bot (D-#1666, docs/prd-telegram-bot.md): account link, report flow, GitHub filing,
 * closed-ticket notice, webhook door. In-memory MongoDB, real services; Telegram / Gemini / GitHub are
 * the `setTelegramDeps` seams (no network).
 */
import express from "express";
import request from "supertest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { TelegramLink } from "../modules/telegram/models/TelegramLink";
import { TelegramLinkToken } from "../modules/telegram/models/TelegramLinkToken";
import { TelegramReport } from "../modules/telegram/models/TelegramReport";
import { createTelegramLink, myTelegramLink, unlinkTelegram, LINK_TOKEN_TTL_MS } from "../modules/telegram/services/TelegramLinkService";
import { handleUpdate, MAX_TICKETS_PER_DAY, MSG, type TgUpdate } from "../modules/telegram/services/TelegramBotService";
import { parseDraft } from "../modules/telegram/services/reportDraft";
import { sweepClosedIssues, startTelegramNoticeSweep, resetTelegramNoticeSweep, flushTelegramNoticeSweep } from "../modules/telegram/services/TelegramNoticeSweep";
import { TelegramBotError, TelegramHttpError, setTelegramDeps, type GithubApi, type GeminiBot, type TelegramApi } from "../modules/telegram/services/telegramDeps";
import { scrubBreadcrumb } from "../observability/sentry";
import { telegramDeps } from "../modules/telegram/services/telegramDeps";
import { flushWebhookWork, telegramWebhookRouter } from "../routes/telegramWebhook";

let mongo: MongoMemoryServer;
const sent: Array<{ chatId: number; text: string; kb?: unknown }> = [];
const downloads: string[] = [];

const tg: TelegramApi = {
  sendMessage: async (chatId, text, kb) => void sent.push({ chatId, text, kb }),
  editMessageText: async () => undefined,
  answerCallbackQuery: async () => undefined,
  downloadFile: async (id) => {
    downloads.push(id);
    return { data: Buffer.from(`bytes-${id}`), mime: id.startsWith("v") ? "audio/ogg" : "image/jpeg" };
  },
  getMe: async () => ({ username: "test_bot" }),
};

const GOOD = {
  title: "হাজিরা সেভ হচ্ছে না",
  screen: "হাজিরা",
  whatHappened: "সেভ চাপলে কিছু হয় না",
  expected: "সেভ হওয়ার কথা",
  steps: ["হাজিরা খুলুন", "সেভ চাপুন"],
  severity: "high",
  transcript: "সেভ করতে পারছি না",
};
const gen = jest.fn<Promise<string>, [{ model: string; parts: unknown[] }]>();
const allowance = jest.fn<Promise<"ok" | "off" | "cap">, []>(async () => "ok");
const gemini: GeminiBot = { generate: (r) => gen(r), allowance: () => allowance() };

const issues = new Map<number, { state: "open" | "closed"; labels: string[]; reason: string | null }>();
let nextIssue = 100;
const createIssue = jest.fn(async (i: { title: string; body: string; labels: string[] }) => {
  const number = nextIssue++;
  issues.set(number, { state: "open", labels: i.labels, reason: null });
  return { number, url: `https://github.test/issues/${number}` };
});
const uploadAsset = jest.fn(async (path: string) => `https://raw.test/bug-assets/${path}`);
const github: GithubApi = {
  ensureLabels: async () => undefined,
  uploadAsset: (p) => uploadAsset(p),
  createIssue: (i) => createIssue(i),
  getIssue: async (n) => {
    const i = issues.get(n);
    if (!i) throw new TelegramHttpError("github", 404);
    return i;
  },
};

let updateId = 1000;
const msg = (chatId: number, extra: Record<string, unknown>): TgUpdate => ({
  update_id: updateId++,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, from: { username: "tester" }, ...extra },
});
const press = (chatId: number, data: string): TgUpdate => ({
  update_id: updateId++,
  callback_query: { id: "cb", data, message: { message_id: 5, chat: { id: chatId, type: "private" } } },
});
const lastTo = (chatId: number) => [...sent].reverse().find((s) => s.chatId === chatId)?.text ?? "";
const ctxFor = (userId: Types.ObjectId, role = "TEACHER"): AppContext => ({ auth: { userId: userId.toString(), role } } as unknown as AppContext);

async function staff(name = "Test Teacher", role = "TEACHER"): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await mongoose.connection.collection("users").insertOne({ _id, name, role });
  return _id;
}
async function linkChat(chatId: number, userId: Types.ObjectId, role = "TEACHER") {
  await TelegramLink.create({ userId, role, chatId, active: true });
}

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "BOT_GEMINI_API_KEY", "BOT_GEMINI_MODEL", "BOT_GEMINI_FALLBACK_MODEL", "BOT_GITHUB_TOKEN", "TELEGRAM_GUARDIAN_ENABLED"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  for (const k of ENV_KEYS) (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]));
  setTelegramDeps();
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  // Nothing may outlive its test: background sweep and webhook work are awaited here.
  await flushTelegramNoticeSweep();
  await flushWebhookWork();
});

beforeEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  sent.length = 0;
  downloads.length = 0;
  issues.clear();
  gen.mockReset();
  createIssue.mockReset().mockImplementation(async (i) => {
    const number = nextIssue++;
    issues.set(number, { state: "open", labels: i.labels, reason: null });
    return { number, url: `https://github.test/issues/${number}` };
  });
  uploadAsset.mockReset().mockImplementation(async (path: string) => `https://raw.test/bug-assets/${path}`);
  allowance.mockReset().mockResolvedValue("ok");
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.BOT_GEMINI_API_KEY = "test-gemini";
  process.env.BOT_GEMINI_MODEL = "primary-model";
  process.env.BOT_GEMINI_FALLBACK_MODEL = "fallback-model";
  process.env.BOT_GITHUB_TOKEN = "test-gh";
  delete process.env.TELEGRAM_GUARDIAN_ENABLED;
  resetTelegramNoticeSweep();
  setTelegramDeps({ telegram: tg, gemini, github });
});

describe("account link", () => {
  test("deep link carries a one-time token; /start links the chat; a second use is refused", async () => {
    const uid = await staff();
    const { url, expiresAt } = await createTelegramLink(ctxFor(uid));
    expect(url).toMatch(/^https:\/\/t\.me\/test_bot\?start=[A-Za-z0-9_-]{32}$/);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(LINK_TOKEN_TTL_MS);
    const token = url.split("start=")[1];
    expect((await TelegramLinkToken.findOne())!.tokenHash).not.toContain(token); // only the hash is kept

    await handleUpdate(msg(7, { text: `/start ${token}` }));
    expect(lastTo(7)).toBe(MSG.linked);
    expect(await TelegramLink.countDocuments({ userId: uid, chatId: 7 })).toBe(1);
    expect((await myTelegramLink(ctxFor(uid))).linked).toBe(true);

    await handleUpdate(msg(8, { text: `/start ${token}` }));
    expect(lastTo(8)).toBe(MSG.badToken);
    expect(await TelegramLink.countDocuments()).toBe(1);
  });

  test("an expired token is refused", async () => {
    const uid = await staff();
    const { url } = await createTelegramLink(ctxFor(uid));
    await TelegramLinkToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await handleUpdate(msg(7, { text: `/start ${url.split("start=")[1]}` }));
    expect(lastTo(7)).toBe(MSG.badToken);
    expect(await TelegramLink.countDocuments()).toBe(0);
  });

  test("/stop and the app both unlink", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await handleUpdate(msg(7, { text: "/stop" }));
    expect(lastTo(7)).toBe(MSG.stopped);
    expect(await TelegramLink.countDocuments()).toBe(0);
    await linkChat(9, uid);
    await unlinkTelegram(ctxFor(uid));
    expect(await TelegramLink.countDocuments()).toBe(0);
  });

  test("an unlinked chat gets one short refusal and nothing is stored", async () => {
    await handleUpdate(msg(55, { text: "hello" }));
    await handleUpdate(msg(55, { photo: [{ file_id: "p1", width: 100, height: 100 }] }));
    expect(sent.map((s) => s.text)).toEqual([MSG.unlinked, MSG.unlinked]);
    expect(await TelegramReport.countDocuments()).toBe(0);
    expect(gen).not.toHaveBeenCalled();
  });

  test("guardian path is OFF by default (refused in the app and in the bot) and works once switched on", async () => {
    const gid = await staff("Parent", "GUARDIAN");
    await expect(createTelegramLink(ctxFor(gid, "GUARDIAN"))).rejects.toBeInstanceOf(TelegramBotError);
    process.env.TELEGRAM_GUARDIAN_ENABLED = "1";
    const { url } = await createTelegramLink(ctxFor(gid, "GUARDIAN"));
    delete process.env.TELEGRAM_GUARDIAN_ENABLED;
    await handleUpdate(msg(7, { text: `/start ${url.split("start=")[1]}` }));
    expect(lastTo(7)).toBe(MSG.badToken);
    expect(await TelegramLink.countDocuments()).toBe(0);
  });

  test("with no bot token the app link refuses and the bot does nothing", async () => {
    const uid = await staff();
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(createTelegramLink(ctxFor(uid))).rejects.toBeInstanceOf(TelegramBotError);
    expect((await myTelegramLink(ctxFor(uid))).available).toBe(false);
    await handleUpdate(msg(7, { text: "hi" }));
    expect(sent).toEqual([]);
  });
});

describe("report flow", () => {
  const photoMsg = (chat: number, id: string) => msg(chat, { photo: [{ file_id: `${id}-s`, width: 90, height: 90 }, { file_id: id, width: 1280, height: 720 }] });

  async function draftOne(chat = 7) {
    await handleUpdate(photoMsg(chat, "p1"));
    await handleUpdate(photoMsg(chat, "p2"));
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(chat, { voice: { file_id: "v1" } }));
  }

  test("photos, then a voice note, drafts a report with the three buttons", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await handleUpdate(photoMsg(7, "p1"));
    expect(lastTo(7)).toBe(MSG.photo);
    await draftOne();
    expect(gen).toHaveBeenCalledTimes(1);
    const parts = gen.mock.calls[0][0].parts as Array<Record<string, string>>;
    expect(parts.filter((p) => p.mime === "audio/ogg")).toHaveLength(1);
    expect(parts.filter((p) => p.mime === "image/jpeg")).toHaveLength(3); // p1 (first message) + p1, p2 (draftOne)
    const shown = sent[sent.length - 1];
    expect(shown.text).toContain(GOOD.title);
    expect(JSON.stringify(shown.kb)).toContain("ok:");
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    expect(r.state).toBe("DRAFTED");
    expect(r.transcript).toBe(GOOD.transcript);
  });

  test("ঠিক আছে files a GitHub issue with the screenshots on bug-assets and tells the reporter and the Principal", async () => {
    const uid = await staff("Reporter Name");
    const pid = await staff("The Principal", "PRINCIPAL");
    await linkChat(7, uid);
    await linkChat(99, pid, "PRINCIPAL");
    await draftOne();
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    await handleUpdate(press(7, `ok:${r._id}`));

    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(uploadAsset.mock.calls[0][0]).toMatch(/^tg\/\d{4}-\d{2}\/[0-9a-f]{24}-1\.jpg$/);
    const issue = createIssue.mock.calls[0][0];
    expect(issue.labels).toEqual(["bug-report", "from-telegram", "staff"]);
    expect(issue.title).toBe(GOOD.title);
    expect(issue.body).toContain("Reporter Name");
    expect(issue.body).toContain("![screenshot](https://raw.test/bug-assets/tg/");
    expect(issue.body.replace(/[0-9a-f]{24}/g, "")).not.toMatch(/\d{8,}/); // no phone-like numbers (random ids stripped first)
    expect(lastTo(7)).toBe("টিকিট #100 তৈরি হয়েছে — https://github.test/issues/100");
    expect(lastTo(99)).toContain("#100");
    const filed = (await TelegramReport.findById(r._id))!;
    expect(filed).toMatchObject({ state: "FILED", issueNumber: 100 });

    // A second tap on the same button files nothing more.
    await handleUpdate(press(7, `ok:${r._id}`));
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  test("সংশোধন: the next voice/text re-drafts from the previous draft + the correction", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await draftOne();
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    await handleUpdate(press(7, `fix:${r._id}`));
    expect(lastTo(7)).toBe(MSG.fixAsk);
    expect((await TelegramReport.findById(r._id))!.state).toBe("CORRECTING");

    gen.mockResolvedValueOnce(JSON.stringify({ ...GOOD, title: "সংশোধিত শিরোনাম" }));
    await handleUpdate(msg(7, { text: "শিরোনামে স্কুলের নাম নেই, ঠিক করুন" }));
    const parts = gen.mock.calls[1][0].parts as Array<{ text?: string }>;
    expect(parts[0].text).toContain("Previous draft");
    expect(parts[0].text).toContain("শিরোনামে স্কুলের নাম নেই");
    expect(lastTo(7)).toContain("সংশোধিত শিরোনাম");
    expect((await TelegramReport.findById(r._id))!.state).toBe("DRAFTED");
  });

  test("বাদ দিন and /cancel drop the report; text with no photo also drafts", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { text: "অ্যাপ হ্যাং করছে" }));
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    await handleUpdate(press(7, `no:${r._id}`));
    expect((await TelegramReport.findById(r._id))!.state).toBe("CANCELLED");
    await handleUpdate(msg(7, { text: "/cancel" }));
    expect(lastTo(7)).toBe(MSG.nothingOpen);
  });

  test("Gemini 503 on the first model falls back to the second", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockRejectedValueOnce(new TelegramHttpError("gemini", 503)).mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    expect(gen.mock.calls.map((c) => c[0].model)).toEqual(["primary-model", "fallback-model"]);
    expect(lastTo(7)).toContain(GOOD.title);
  });

  test("a model that times out (or drops the connection) falls back to the second (prod 21 Nov 2026)", async () => {
    const uid = await staff();
    await linkChat(8, uid);
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    gen.mockRejectedValueOnce(timeout).mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(8, { text: "সমস্যা" }));
    expect(gen.mock.calls.map((c) => c[0].model)).toEqual(["primary-model", "fallback-model"]);
    expect(lastTo(8)).toContain(GOOD.title);
    gen.mockClear();
    gen.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(8, { text: "/cancel" }));
    await handleUpdate(msg(8, { text: "আরেকটি সমস্যা" }));
    expect(gen.mock.calls.map((c) => c[0].model)).toEqual(["primary-model", "fallback-model"]);
  });

  test("bad JSON is repaired locally; hopeless output gives a clear Bangla error and no draft", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce("```json\n" + JSON.stringify(GOOD).replace("}", ",}") + "\n```");
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    expect(lastTo(7)).toContain(GOOD.title);

    await handleUpdate(msg(7, { text: "/new" }));
    gen.mockResolvedValue("not json at all");
    await handleUpdate(msg(7, { text: "আবার সমস্যা" }));
    expect(lastTo(7)).toContain("ঠিকমতো লিখতে পারিনি");
    expect(await TelegramReport.countDocuments({ state: "DRAFTED" })).toBe(0); // the bad output left no draft
  });

  test("the monthly cap stops a draft before any Gemini call", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    allowance.mockResolvedValue("cap");
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    expect(gen).not.toHaveBeenCalled();
    expect(lastTo(7)).toContain("সীমা শেষ");
  });

  test(`${MAX_TICKETS_PER_DAY} tickets a day per user, then a refusal`, async () => {
    const uid = await staff();
    await linkChat(7, uid);
    for (let i = 0; i < MAX_TICKETS_PER_DAY; i++) {
      await TelegramReport.create({ chatId: 7, userId: uid, role: "TEACHER", state: "FILED", open: false, filedAt: new Date(), issueNumber: i + 1 });
    }
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    const r = (await TelegramReport.findOne({ state: "DRAFTED" }))!;
    await handleUpdate(press(7, `ok:${r._id}`));
    expect(createIssue).not.toHaveBeenCalled();
    expect(lastTo(7)).toBe(MSG.limit);
    expect((await TelegramReport.findById(r._id))!.state).toBe("DRAFTED");
  });

  test("a GitHub failure puts the draft back so ঠিক আছে can be tapped again", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    createIssue.mockRejectedValueOnce(new TelegramHttpError("github", 500));
    await handleUpdate(press(7, `ok:${r._id}`));
    expect(lastTo(7)).toBe(MSG.fileFailed);
    expect((await TelegramReport.findById(r._id))!.state).toBe("DRAFTED");
    await handleUpdate(press(7, `ok:${r._id}`));
    expect((await TelegramReport.findById(r._id))!.state).toBe("FILED");
  });

  test("Telegram retries (same update_id) are handled once", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    const u = msg(7, { photo: [{ file_id: "p1", width: 10, height: 10 }] });
    await handleUpdate(u);
    await handleUpdate(u);
    expect((await TelegramReport.findOne({ chatId: 7 }))!.photoFileIds).toEqual(["p1"]);
    expect(sent).toHaveLength(1);
  });

  test("more than 5 photos are refused politely", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    for (let i = 0; i < 6; i++) await handleUpdate(photoMsg(7, `p${i}`));
    expect((await TelegramReport.findOne({ chatId: 7 }))!.photoFileIds).toHaveLength(5);
    expect(lastTo(7)).toBe(MSG.tooManyPhotos);
  });
});

describe("parseDraft", () => {
  test("normalises severity and rejects a report with no title or story", () => {
    expect(parseDraft(JSON.stringify({ ...GOOD, severity: "weird" }))!.draft.severity).toBe("medium");
    expect(parseDraft(JSON.stringify({ ...GOOD, title: "" }))).toBeNull();
    expect(parseDraft("nothing")).toBeNull();
  });
});

describe("closed-ticket notice", () => {
  test("tells the reporter once when the issue is closed", async () => {
    const uid = await staff();
    await TelegramReport.create({ chatId: 7, userId: uid, role: "TEACHER", state: "FILED", open: false, filedAt: new Date(), issueNumber: 5 });
    issues.set(5, { state: "open", labels: [], reason: null });
    expect(await sweepClosedIssues()).toBe(0);
    issues.set(5, { state: "closed", labels: [], reason: "completed" });
    expect(await sweepClosedIssues()).toBe(1);
    expect(lastTo(7)).toContain("#5");
    expect(await sweepClosedIssues()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  test("the scheduler hook is throttled and does nothing without a bot token", () => {
    expect(startTelegramNoticeSweep(1_000_000)).toBe(true);
    expect(startTelegramNoticeSweep(1_000_000 + 60_000)).toBe(false);
    resetTelegramNoticeSweep();
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(startTelegramNoticeSweep(5_000_000)).toBe(false);
  });
});

describe("webhook door", () => {
  const app = express().use("/triggers/telegram", telegramWebhookRouter);

  test("503 with no bot token, 401 on a wrong secret, 200 + handled on the right one", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await request(app).post("/triggers/telegram/webhook").send({})).status).toBe(503);
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    expect((await request(app).post("/triggers/telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", "nope").send({})).status).toBe(401);
    expect((await request(app).post("/triggers/telegram/webhook").send({})).status).toBe(401);
    const res = await request(app)
      .post("/triggers/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "test-secret")
      .send(msg(31, { text: "hello" }));
    expect(res.status).toBe(200);
    await flushWebhookWork();
    expect(lastTo(31)).toBe(MSG.unlinked);
  });
});

describe("review fixes", () => {
  const photoMsg = (chat: number, id: string, extra: Record<string, unknown> = {}) => msg(chat, { photo: [{ file_id: id, width: 1280, height: 720 }], ...extra });

  test("a failure AFTER createIssue never reverts or duplicates the ticket", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    setTelegramDeps({
      telegram: {
        ...tg,
        sendMessage: async (c, t, k) => {
          if (t.startsWith("টিকিট #")) throw new Error("telegram down");
          return tg.sendMessage(c, t, k);
        },
      },
      gemini,
      github,
    });
    await handleUpdate(press(7, `ok:${r._id}`));
    const filed = (await TelegramReport.findById(r._id).lean())!;
    expect([filed.state, filed.issueNumber]).toEqual(["FILED", (await createIssue.mock.results[0].value).number]);
    await handleUpdate(press(7, `ok:${r._id}`));
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  test("a photo album (3 parallel updates) makes ONE report with 3 photos, and never more than 5", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await Promise.all([photoMsg(7, "a1"), photoMsg(7, "a2"), photoMsg(7, "a3")].map((u) => handleUpdate(u)));
    expect(await TelegramReport.countDocuments({ chatId: 7 })).toBe(1);
    expect((await TelegramReport.findOne({ chatId: 7 }))!.photoFileIds).toHaveLength(3);
    await Promise.all([1, 2, 3, 4, 5].map((i) => handleUpdate(photoMsg(7, `b${i}`))));
    expect((await TelegramReport.findOne({ chatId: 7 }))!.photoFileIds).toHaveLength(5);
  });

  test("a photo caption is used as the text and drafts at once; a photo after a draft says it was added", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(photoMsg(7, "c1", { caption: "হাজিরা সেভ হয় না" }));
    expect(lastTo(7)).toContain(GOOD.title);
    expect((await TelegramReport.findOne({ chatId: 7 }))!.texts).toEqual(["হাজিরা সেভ হয় না"]);
    await handleUpdate(photoMsg(7, "c2"));
    expect(lastTo(7)).toBe(MSG.photoAdded);
  });

  test("a document or sticker gets a Bangla hint", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await handleUpdate(msg(7, { document: { file_id: "d1" } }));
    expect(lastTo(7)).toBe(MSG.useImage);
    await handleUpdate(msg(7, { sticker: { file_id: "s1" } }));
    expect(lastTo(7)).toBe(MSG.useImage);
  });

  test("a voice over 5 minutes or 5 MB is refused before Gemini; audio keeps its own mime", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    await handleUpdate(msg(7, { voice: { file_id: "v1", duration: 400 } }));
    await handleUpdate(msg(7, { audio: { file_id: "v2", duration: 10, file_size: 6 * 1024 * 1024 } }));
    expect(sent.map((x) => x.text)).toEqual([MSG.voiceTooLong, MSG.voiceTooLong]);
    expect(gen).not.toHaveBeenCalled();
    const mimes: Array<string | undefined> = [];
    setTelegramDeps({
      telegram: {
        ...tg,
        downloadFile: async (id, hint) => {
          mimes.push(hint);
          return tg.downloadFile(id, hint);
        },
      },
      gemini,
      github,
    });
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { audio: { file_id: "v3", duration: 10, mime_type: "audio/mp4" } }));
    expect(mimes).toContain("audio/mp4");
  });

  test("the feature switch (off) and the cap are checked before EACH Gemini call", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    allowance.mockResolvedValue("off");
    await handleUpdate(msg(7, { text: "সমস্যা" }));
    expect(gen).not.toHaveBeenCalled();
    allowance.mockReset().mockResolvedValueOnce("ok").mockResolvedValueOnce("ok").mockResolvedValueOnce("cap");
    gen.mockResolvedValueOnce("not json");
    await handleUpdate(msg(7, { text: "আবার" }));
    expect(gen).toHaveBeenCalledTimes(1); // the re-ask was stopped by the cap
  });

  test("a voice correction keeps the first transcript and appends the correction", async () => {
    const uid = await staff();
    await linkChat(7, uid);
    gen.mockResolvedValueOnce(JSON.stringify(GOOD));
    await handleUpdate(msg(7, { voice: { file_id: "v1", duration: 5 } }));
    const r = (await TelegramReport.findOne({ chatId: 7 }))!;
    await handleUpdate(press(7, `fix:${r._id}`));
    gen.mockResolvedValueOnce(JSON.stringify({ ...GOOD, transcript: "শিরোনাম বদলান" }));
    await handleUpdate(msg(7, { voice: { file_id: "v2", duration: 5 } }));
    const t = (await TelegramReport.findById(r._id))!.transcript;
    expect(t).toContain(GOOD.transcript);
    expect(t).toContain("সংশোধন: শিরোনাম বদলান");
  });

  test("a deactivated account cannot link and an existing link stops working", async () => {
    const uid = await staff();
    const { url } = await createTelegramLink(ctxFor(uid));
    await mongoose.connection.collection("users").updateOne({ _id: uid }, { $set: { active: false } });
    await handleUpdate(msg(7, { text: `/start ${url.split("start=")[1]}` }));
    expect(lastTo(7)).toBe(MSG.badToken);
    await linkChat(8, uid);
    await handleUpdate(msg(8, { text: "সমস্যা" }));
    expect(lastTo(8)).toBe(MSG.unlinked);
    expect(gen).not.toHaveBeenCalled();
  });

  test("View as: linking and unlinking are refused", async () => {
    const uid = await staff();
    const ctx = { auth: { userId: uid.toString(), role: "TEACHER", impersonatorId: new Types.ObjectId().toString() } } as unknown as AppContext;
    await expect(createTelegramLink(ctx)).rejects.toBeInstanceOf(TelegramBotError);
    await expect(unlinkTelegram(ctx)).rejects.toBeInstanceOf(TelegramBotError);
  });

  test("uploadAsset treats a 422 (already uploaded) as done, and a 422 on creating the branch as ready", async () => {
    setTelegramDeps(); // the REAL GitHub seam, with fetch mocked
    const calls: string[] = [];
    const spy = jest.spyOn(global, "fetch").mockImplementation((async (url: string, init?: { method?: string }) => {
      const u = String(url);
      calls.push(`${init?.method} ${u}`);
      if (init?.method === "GET") return new Response("{}", { status: 404 });
      if (u.endsWith("/git/blobs") || u.endsWith("/git/trees") || u.endsWith("/git/commits")) return new Response(JSON.stringify({ sha: "abc" }), { status: 201 });
      return new Response("{}", { status: 422 });
    }) as unknown as typeof fetch);
    try {
      const url = await telegramDeps().github.uploadAsset("tg/2026-11/x-1.jpg", Buffer.from("x"));
      expect(url).toMatch(/\/bug-assets\/tg\/2026-11\/x-1\.jpg$/);
      expect(calls.some((c) => c.startsWith("PUT ") && c.includes("/contents/"))).toBe(true);
    } finally {
      spy.mockRestore();
      setTelegramDeps({ telegram: tg, gemini, github });
    }
  });
});

describe("closed-ticket sweep (review fixes)", () => {
  const filed = (chatId: number, issueNumber: number, lastCheckedAt: Date | null, uid: Types.ObjectId) =>
    TelegramReport.create({ chatId, userId: uid, role: "TEACHER", state: "FILED", open: false, filedAt: new Date(), issueNumber, lastCheckedAt });

  test("not_planned gets a neutral message, a deleted issue is marked done silently, oldest-checked goes first", async () => {
    const uid = await staff();
    await filed(1, 11, new Date(2026, 0, 1), uid);
    await filed(2, 12, null, uid);
    await filed(3, 13, new Date(2025, 0, 1), uid);
    issues.set(11, { state: "closed", labels: [], reason: "not_planned" });
    issues.set(12, { state: "closed", labels: [], reason: "completed" });
    // 13 is not in the map: GitHub answers 404
    expect(await sweepClosedIssues()).toBe(2);
    expect(lastTo(1)).toContain("বন্ধ করা হয়েছে");
    expect(lastTo(1)).not.toContain("সমাধান হয়েছে");
    expect(lastTo(2)).toContain("সমাধান হয়েছে");
    expect(sent.some((x) => x.chatId === 3)).toBe(false);
    expect((await TelegramReport.findOne({ issueNumber: 13 }))!.notifiedClosedAt).not.toBeNull();
    expect((await TelegramReport.findOne({ issueNumber: 12 }))!.lastCheckedAt).not.toBeNull();
    // never-checked (12) went before the old-checked ones
    expect(sent.map((x) => x.chatId)[0]).toBe(2);
  });

  test("an open ticket is re-queued behind the others (lastCheckedAt moves)", async () => {
    const uid = await staff();
    await filed(1, 21, null, uid);
    issues.set(21, { state: "open", labels: [], reason: null });
    await sweepClosedIssues();
    expect((await TelegramReport.findOne({ issueNumber: 21 }))!.lastCheckedAt).not.toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe("breadcrumb scrub", () => {
  test("the bot token never survives in a breadcrumb url or message", () => {
    const b = scrubBreadcrumb({
      message: "POST https://api.telegram.org/bot123456:SECRET-abc/sendMessage",
      data: { url: "https://api.telegram.org/file/bot123456:SECRET-abc/photos/p.jpg", status_code: 200 } as Record<string, unknown>,
    });
    expect(JSON.stringify(b)).not.toContain("SECRET");
    expect(b.data!.url).toBe("https://api.telegram.org/file/bot***/photos/p.jpg");
    expect(b.message).toBe("POST https://api.telegram.org/bot***/sendMessage");
    expect(b.data!.status_code).toBe(200);
  });
});
