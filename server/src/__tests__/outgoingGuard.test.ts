/**
 * AL-1 (D-#1677) — the dev "nothing goes out" kill switch. Pure guard + each seam: on a `_dev`
 * database with no flag the network function is NOT called; the Notification row is still written.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { currentDbName, outgoingAllowed, outgoingKeysPresent, outgoingState, resetOutgoingLog } from "../lib/outgoing";
import { sendExpoPush } from "../modules/platform/services/ExpoPush";
import { meteredGeminiFetch } from "../modules/platform/ai/meteredFetch";
import { aiSend, AiFeatureOffError } from "../modules/platform/ai/aiRouter";
import type { AiRoute } from "../modules/platform/services/AiSettingService";
import fs from "fs";
import os from "os";
import path from "path";
import { DeepseekProvider } from "../modules/platform/ai/deepseekProvider";
import { GeminiProvider } from "../modules/platform/ai/geminiProvider";
import { uploadToDrive, downloadFromDrive, deleteFromDrive, listDriveFolder, DriveUnavailableError } from "../modules/platform/services/DriveStore";
import { webPushChannel } from "../modules/notifications/services/webPushChannel";
import { emit, registerChannel } from "../modules/notifications/services/NotificationService";
import { Notification } from "../modules/notifications/models/Notification";
import { setTelegramDeps, telegramDeps, TelegramHttpError } from "../modules/telegram/services/telegramDeps";
import type { AiSendInput } from "../modules/platform/ai/provider";

const SAVED = { uri: process.env.MONGODB_URI, flag: process.env.OUTGOING_NOTIFICATIONS };
afterEach(() => {
  if (SAVED.uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = SAVED.uri;
  if (SAVED.flag === undefined) delete process.env.OUTGOING_NOTIFICATIONS; else process.env.OUTGOING_NOTIFICATIONS = SAVED.flag;
  resetOutgoingLog();
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
const useDb = (name: string, flag?: string) => {
  process.env.MONGODB_URI = `mongodb://u:p@host1:27017,host2:27017/${name}?retryWrites=true`;
  if (flag === undefined) delete process.env.OUTGOING_NOTIFICATIONS; else process.env.OUTGOING_NOTIFICATIONS = flag;
};

describe("pure guard (no connection: name parsed from MONGODB_URI)", () => {
  it("a _dev database blocks", () => {
    useDb("scdhub_dev");
    expect(currentDbName()).toBe("scdhub_dev");
    expect(outgoingState()).toEqual({ state: "OFF", reason: "dev_db" });
    expect(outgoingAllowed("expo")).toBe(false);
  });
  it("_dev + OUTGOING_NOTIFICATIONS=on allows", () => {
    useDb("scdhub_dev", "on");
    expect(outgoingAllowed("expo")).toBe(true);
  });
  it("off blocks on a prod-named database", () => {
    useDb("scdhub", "off");
    expect(outgoingState().reason).toBe("flag_off");
    expect(outgoingAllowed("ai")).toBe(false);
  });
  it("a prod-named database allows", () => {
    useDb("scdhub");
    expect(outgoingAllowed("expo")).toBe(true);
  });
  it("an unknown database name never blocks unless the flag is off", () => {
    delete process.env.MONGODB_URI;
    delete process.env.OUTGOING_NOTIFICATIONS;
    expect(currentDbName()).toBeNull();
    expect(outgoingAllowed("expo")).toBe(true);
    process.env.OUTGOING_NOTIFICATIONS = "off";
    expect(outgoingAllowed("expo")).toBe(false);
  });
  it("logs once per channel, and /readyz keys are booleans only", () => {
    useDb("x_dev");
    outgoingAllowed("expo");
    outgoingAllowed("expo");
    expect(console.warn).toHaveBeenCalledTimes(1);
    process.env.DEEPSEEK_API_KEY = "secret-value";
    const keys = outgoingKeysPresent();
    expect(keys.DEEPSEEK_API_KEY).toBe(true);
    expect(JSON.stringify(keys)).not.toContain("secret-value");
    delete process.env.DEEPSEEK_API_KEY;
  });
});

describe("seams on a _dev database", () => {
  beforeEach(() => useDb("scdhub_dev"));

  it("Expo push does not call fetch", async () => {
    const f = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = f;
    const r = await sendExpoPush([{ to: "ExponentPushToken[x]", title: "t", body: "b" }]);
    expect(f).not.toHaveBeenCalled();
    expect(r).toEqual({ okCount: 0, deadTokens: [] });
  });

  it("web push channel returns before touching the database or web-push", async () => {
    await expect(webPushChannel.deliver({ recipientUserId: "u" } as never)).resolves.toBeUndefined();
  });

  it("the legacy Gemini fetch answers 503 and never calls the network", async () => {
    const impl = jest.fn();
    const res = await meteredGeminiFetch("monthly_comment", "m", "https://x", { method: "POST" }, {}, impl as unknown as typeof fetch);
    expect(impl).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it("aiSend takes the AI-off path and never builds a provider", async () => {
    const route = async (): Promise<AiRoute> => ({ enabled: true, primary: { provider: "deepseek", model: "m", key: "k" }, fallback: null });
    const makeProvider = jest.fn();
    const input: AiSendInput = { stablePrefix: "p", variablePart: "v", maxOutputTokens: 10, reasoning: "off" };
    await expect(aiSend("comment_check", input, {}, { route, makeProvider })).rejects.toBeInstanceOf(AiFeatureOffError);
    expect(makeProvider).not.toHaveBeenCalled();
  });

  it("Telegram and GitHub calls throw the handled HTTP error and never call fetch", async () => {
    setTelegramDeps();
    const f = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = f;
    await expect(telegramDeps().telegram.sendMessage(1, "hi")).rejects.toBeInstanceOf(TelegramHttpError);
    await expect(telegramDeps().github.createIssue({ title: "t", body: "b", labels: [] })).rejects.toBeInstanceOf(TelegramHttpError);
    expect(f).not.toHaveBeenCalled();
  });

  it("Drive upload keeps the file local: same id downloads, lists and deletes; no fetch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "al1-"));
    const savedDir = process.env.DEV_LOCAL_FILES_DIR;
    process.env.DEV_LOCAL_FILES_DIR = dir;
    try {
      const f = jest.fn();
      (global as unknown as { fetch: unknown }).fetch = f;
      const id = await uploadToDrive({ year: "2026", name: "a.txt", mime: "text/plain", data: Buffer.from("hello"), subfolder: "hw" });
      expect(id.startsWith("local:")).toBe(true);
      expect((await downloadFromDrive(id)).toString()).toBe("hello");
      expect((await listDriveFolder("2026", "hw")).map((x) => x.id)).toEqual([id]);
      await deleteFromDrive(id);
      await expect(downloadFromDrive(id)).rejects.toBeInstanceOf(DriveUnavailableError);
      await expect(downloadFromDrive("local:../../etc/passwd")).rejects.toBeInstanceOf(DriveUnavailableError);
      expect(f).not.toHaveBeenCalled();
    } finally {
      if (savedDir === undefined) delete process.env.DEV_LOCAL_FILES_DIR; else process.env.DEV_LOCAL_FILES_DIR = savedDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a provider send() throws AiFeatureOffError and never calls fetch", async () => {
    const f = jest.fn();
    const input = { stablePrefix: "s", variablePart: "v" } as unknown as AiSendInput;
    await expect(new DeepseekProvider("k", f as never).send(input, "m")).rejects.toBeInstanceOf(AiFeatureOffError);
    await expect(new GeminiProvider("k", f as never).send(input, "m")).rejects.toBeInstanceOf(AiFeatureOffError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("database name parsing", () => {
  it("srv URI with query string", () => {
    process.env.MONGODB_URI = "mongodb+srv://h/scdhub_dev?retryWrites=true";
    expect(currentDbName()).toBe("scdhub_dev");
  });
  it("multi-host URI", () => {
    process.env.MONGODB_URI = "mongodb://u:p@a:27017,b:27017,c:27017/scdhub?replicaSet=rs0";
    expect(currentDbName()).toBe("scdhub");
  });
});

describe("Notification row is still written (in-memory Mongo, _dev database)", () => {
  let mongo: MongoMemoryServer;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri("scdhub_dev"));
    await Notification.init();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("emit() writes the row while the push channels send nothing", async () => {
    expect(currentDbName()).toBe("scdhub_dev");
    delete process.env.OUTGOING_NOTIFICATIONS;
    const f = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = f;
    const { expoPushChannel } = await import("../modules/notifications/services/pushChannel");
    registerChannel(expoPushChannel);
    registerChannel(webPushChannel);
    const r = await emit({ recipientUserId: new mongoose.Types.ObjectId().toString(), kind: "SCHOOL_NOTICE", titleBn: "t", bodyBn: "b", dedupeKey: "al1-test" });
    expect(r.created).toBe(true);
    expect(await Notification.countDocuments({ dedupeKey: "al1-test" })).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });
});
