/**
 * MT-1 — Message Templates registry: renderer + edit/reset + edit-safety
 * (prd-message-templates §3/§4/§7, D-#128–#131). DB-free: the MessageTemplate +
 * Audit models and AuditService are mocked (the repo convention). renderTemplate
 * resolves the override-or-default; with no override row it returns the byte-identical
 * code default.
 */
import { MESSAGE_TEMPLATE_KEYS, MESSAGE_TEMPLATE_REGISTRY } from "@scd/shared";

// --- model + dependency mocks ---------------------------------------------
const mockFindOne = jest.fn(); // resolves the override row (or null)
const mockFind = jest.fn().mockReturnValue([]); // list rows
const mockFindOneAndUpdate = jest.fn();
const mockDeleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
const mockAuditFind = jest.fn().mockReturnValue([]);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/templates/models/MessageTemplate", () => ({
  MessageTemplate: {
    findOne: (q: unknown) => ({ lean: async () => mockFindOne(q) }),
    find: (q: unknown) => ({ lean: async () => mockFind(q) }),
    findOneAndUpdate: (q: unknown, u: unknown, o: unknown) => mockFindOneAndUpdate(q, u, o),
    deleteOne: (q: unknown) => mockDeleteOne(q),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
jest.mock("../modules/platform/models/Audit", () => ({
  Audit: {
    find: (q: unknown) => {
      const chain = {
        sort: () => chain,
        limit: () => chain,
        lean: async () => mockAuditFind(q),
      };
      return chain;
    },
  },
}));

import {
  renderTemplate,
  getEffectiveTemplate,
  interpolate,
  templateTokens,
  editMessageTemplate,
  resetMessageTemplate,
  listMessageTemplates,
  messageTemplateHistory,
  isMessageTemplateKey,
  MessageTemplateError,
} from "../modules/templates/services/MessageTemplateService";

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockResolvedValue(null); // default: no override
  mockFind.mockReturnValue([]);
  mockAuditFind.mockReturnValue([]);
  mockFindOneAndUpdate.mockImplementation((_q, u) => ({
    _id: "row1",
    key: "classNote.published.body",
    ...((u as { $set?: Record<string, unknown> }).$set ?? {}),
  }));
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("interpolate + templateTokens", () => {
  test("interpolates declared tokens; a missing placeholder renders BLANK (D-#129)", () => {
    expect(interpolate("hi {a} and {b}", { a: "X" })).toBe("hi X and ");
  });
  test("inserted values are not re-scanned for further tokens", () => {
    expect(interpolate("{a}", { a: "{b}", b: "NO" })).toBe("{b}");
  });
  test("templateTokens extracts unique {curly} names", () => {
    expect(templateTokens("{x} {y} {x}").sort()).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// J5 — adoption is silent: every default renders byte-identical
// ---------------------------------------------------------------------------

describe("J5 — renderTemplate returns the byte-identical code default (no override)", () => {
  test("class-note published body", async () => {
    expect(await renderTemplate("classNote.published.body", { subject: "গণিত" })).toBe(
      "গণিত — আজ ক্লাসে যা পড়ানো হয়েছে তার নোট প্রকাশিত হয়েছে।",
    );
  });
  test("assignment chase body (shared inbox + wa.me)", async () => {
    expect(
      await renderTemplate("assignment.chase.body", {
        studentName: "রহিম",
        subject: "গণিত",
        asId: "AS-1",
        deliveryDate: "01/06/2026",
        dueDate: "05/06/2026",
      }),
    ).toBe(
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, আপনার সন্তান রহিম-এর গণিত অ্যাসাইনমেন্টটি (AS-1) এখনও জমা হয়নি। " +
        "অ্যাসাইনমেন্টটি 01/06/2026 তারিখে দেওয়া হয়েছিল এবং 05/06/2026 তারিখে জমা দেওয়ার কথা ছিল। " +
        "অনুগ্রহ করে আপনার সন্তানকে অ্যাসাইনমেন্টটি দ্রুত জমা দিতে সহায়তা করুন। মা'আসসালামাহ — SCD Admin",
    );
  });
  test("credential share (guardian) embeds id + password", async () => {
    expect(
      await renderTemplate("credential.share.guardian.wa", {
        name: "করিম",
        identifier: "01711",
        password: "Ab2Cd3Ef",
      }),
    ).toBe(
      "আসসালামু আলাইকুম করিম। SCD Hub অ্যাপে আপনার (অভিভাবক) লগইন তথ্য:\n" +
        "আইডি: 01711\nপাসওয়ার্ড: Ab2Cd3Ef\n" +
        "অনুগ্রহ করে তথ্যগুলো গোপন রাখুন এবং প্রথমবার লগইনের পর সংরক্ষণ করুন।",
    );
  });
  test("every registered key renders to a non-empty default with no override", async () => {
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      const out = await renderTemplate(key, {});
      expect(typeof out).toBe("string");
      // titles + bodies with no params still produce the literal text around blanks
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Override wins at read-time; langMode emission (D-#130)
// ---------------------------------------------------------------------------

describe("admin override wins; langMode (D-#130)", () => {
  test("an override row's bnBody wins over the code default", async () => {
    mockFindOne.mockResolvedValue({
      key: "cover.assigned.body",
      bnBody: "নতুন: {dateKey} তারিখে কাভার।",
      langMode: "BN",
    });
    expect(await renderTemplate("cover.assigned.body", { dateKey: "2026-06-13" })).toBe(
      "নতুন: 2026-06-13 তারিখে কাভার।",
    );
    const eff = await getEffectiveTemplate("cover.assigned.body");
    expect(eff.isDefault).toBe(false);
  });
  test("langMode EN renders the English body only", async () => {
    mockFindOne.mockResolvedValue({
      key: "cover.assigned.body",
      bnBody: "বাংলা {dateKey}",
      enBody: "English {dateKey}",
      langMode: "EN",
    });
    expect(await renderTemplate("cover.assigned.body", { dateKey: "D1" })).toBe("English D1");
  });
  test("langMode BOTH renders Bangla then English", async () => {
    mockFindOne.mockResolvedValue({
      key: "cover.assigned.body",
      bnBody: "বাংলা {dateKey}",
      enBody: "English {dateKey}",
      langMode: "BOTH",
    });
    expect(await renderTemplate("cover.assigned.body", { dateKey: "D1" })).toBe("বাংলা D1\n\nEnglish D1");
  });
});

// ---------------------------------------------------------------------------
// J1/J2/J4 — edit safety
// ---------------------------------------------------------------------------

describe("editMessageTemplate — edit safety (J1/J2/J4)", () => {
  test("J1 — a valid edit audits the prior body then upserts", async () => {
    await editMessageTemplate({
      key: "cover.assigned.body",
      bnBody: "নতুন {dateKey}",
      langMode: "BN",
      actorId: "u1",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "MESSAGE_TEMPLATE_EDITED", meta: expect.objectContaining({ key: "cover.assigned.body", action: "edit" }) }),
    );
    expect(mockFindOneAndUpdate).toHaveBeenCalled();
    // audit fires BEFORE the write
    expect(mockWriteAudit.mock.invocationCallOrder[0]).toBeLessThan(mockFindOneAndUpdate.mock.invocationCallOrder[0]);
  });
  test("J2 — an undeclared placeholder is rejected (Bangla 422) naming the allowed set", async () => {
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "{dateKey} {bogus}", langMode: "BN", actorId: "u1" }),
    ).rejects.toThrow(MessageTemplateError);
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "{dateKey} {bogus}", langMode: "BN", actorId: "u1" }),
    ).rejects.toThrow(/\{dateKey\}/);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
  test("empty Bangla body is rejected", async () => {
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "   ", langMode: "BN", actorId: "u1" }),
    ).rejects.toThrow(MessageTemplateError);
  });
  test("J4 — cannot set EN/BOTH without an English body (empty-EN guard, D-#130)", async () => {
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "বাংলা {dateKey}", langMode: "EN", actorId: "u1" }),
    ).rejects.toThrow(MessageTemplateError);
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "বাংলা {dateKey}", enBody: "", langMode: "BOTH", actorId: "u1" }),
    ).rejects.toThrow(MessageTemplateError);
  });
  test("J4 — EN/BOTH allowed once the English body is filled", async () => {
    await expect(
      editMessageTemplate({ key: "cover.assigned.body", bnBody: "বাংলা {dateKey}", enBody: "English {dateKey}", langMode: "BOTH", actorId: "u1" }),
    ).resolves.toBeTruthy();
  });
  test("an unknown key is rejected", async () => {
    await expect(
      editMessageTemplate({ key: "nope.not.a.key", bnBody: "x", langMode: "BN", actorId: "u1" }),
    ).rejects.toThrow(MessageTemplateError);
  });
});

// ---------------------------------------------------------------------------
// J3 — reset
// ---------------------------------------------------------------------------

describe("resetMessageTemplate (J3)", () => {
  test("deletes an existing override and audits the prior body", async () => {
    mockFindOne.mockResolvedValue({ key: "cover.assigned.body", bnBody: "x", langMode: "BN" });
    const res = await resetMessageTemplate("cover.assigned.body", "u1");
    expect(res.reset).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ action: "reset" }) }),
    );
    expect(mockDeleteOne).toHaveBeenCalledWith({ key: "cover.assigned.body" });
  });
  test("no override → idempotent no-op (reset:false), nothing audited or deleted", async () => {
    mockFindOne.mockResolvedValue(null);
    const res = await resetMessageTemplate("cover.assigned.body", "u1");
    expect(res.reset).toBe(false);
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list + history reads
// ---------------------------------------------------------------------------

describe("listMessageTemplates + history", () => {
  test("lists every key; an override flips isDefault=false", async () => {
    mockFind.mockReturnValue([{ key: "cover.assigned.body", bnBody: "x", langMode: "BN", updatedBy: { toString: () => "u1" } }]);
    const list = await listMessageTemplates();
    expect(list.length).toBe(MESSAGE_TEMPLATE_KEYS.length);
    const overridden = list.find((e) => e.key === "cover.assigned.body")!;
    expect(overridden.isDefault).toBe(false);
    const def = list.find((e) => e.key === "bell.reminder.title")!;
    expect(def.isDefault).toBe(true);
    expect(def.def.bnDefault).toBe(MESSAGE_TEMPLATE_REGISTRY["bell.reminder.title"].bnDefault);
  });
  test("history maps MESSAGE_TEMPLATE_EDITED audit rows", async () => {
    mockAuditFind.mockReturnValue([
      { eventAt: new Date("2026-06-13"), actorId: { toString: () => "u1" }, meta: { key: "cover.assigned.body", action: "edit", priorBnBody: "old", wasDefault: true } },
    ]);
    const hist = await messageTemplateHistory("cover.assigned.body");
    expect(hist).toHaveLength(1);
    expect(hist[0].action).toBe("edit");
    expect(hist[0].priorBnBody).toBe("old");
    expect(hist[0].wasDefault).toBe(true);
  });
  test("isMessageTemplateKey guards", () => {
    expect(isMessageTemplateKey("bell.reminder.title")).toBe(true);
    expect(isMessageTemplateKey("nope")).toBe(false);
  });
});
