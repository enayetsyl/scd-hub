/**
 * BL-3 — the validator, one PASS and one FAIL fixture per rule VR-1 … VR-15 (docs/prd-book-lifecycle.md
 * §12.3, §19 bookEditValidator; D-#1601/#1607). Invented text only (the Arabic is an invented phrase).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import JSZip from "jszip";
import { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, sampleMaster, item, childVersion, type LcFx } from "./bookLcFixtures";
import { importBook, acceptDraft, decideDraftChapter } from "../modules/book-lifecycle/services/versionService";
import { applyChapterEdit, openEditDraft, putChapter, submitDraft } from "../modules/book-lifecycle/services/draftService";
import { addInstruction, openDecision, ruleDecisionSelf, triageFeedback, uploadRuleSet, createFeedbackRow } from "../modules/book-lifecycle/services/feedbackService";
import { loadBook } from "../modules/book-lifecycle/services/store";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import type { IBookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

const ARABIC = "كَلِمَةٌ تَجْرِيبِيَّةٌ";
const SACRED_CH = ["## অধ্যায় 4: পবিত্র অংশ", "", "<!-- bl:sacred start -->", ARABIC, "অনুবাদ: একটি পরীক্ষামূলক শব্দ", "<!-- bl:sacred end -->", "", `আলাদা আরবি: ${ARABIC} শেষ।`, "", "![নৌকা](media/image1.png)", ""].join("\n");

async function book() {
  const zip = new JSZip();
  zip.file("media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));
  const { book } = await importBook(P(), { code: "C3-BAN", classLevel: 3, subject: "BAN", titleBn: "পরীক্ষার বই", version: "v1", state: "draft", masterMd: Buffer.from(sampleMaster({ extra: SACRED_CH })), mediaZip: await zip.generateAsync({ type: "nodebuffer" }) });
  return book._id.toString();
}
const sha = (d: IBookEditDraft, key: string) => d.chapters.find((c) => c.key === key)!.baseSha!;
const edit = (d: IBookEditDraft, chapter: string, ops: unknown[], extra: Record<string, unknown> = {}) => applyChapterEdit(P(), d._id.toString(), { schema: "book-chapter-edit/v1", draft: d._id.toString(), chapter, baseSha: sha(d, chapter), ops, ...extra });
const codes = (fs: { code: string; level: string }[], level = "blocking") => fs.filter((f) => f.level === level).map((f) => f.code);

describe("VR-1 base", () => {
  it("pass: a fresh base; fail: a stale base or a wrong chapter baseSha", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি নৌকা", after: "একটি নৌকা", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-002", [], { baseSha: "b".repeat(64) })).findings)).toEqual(["VR-1"]);
    await childVersion(P(), id, "3টি নৌকা", "তিনটি নৌকা", [f.code]);
    await expect(edit(d, "ch-001", [])).rejects.toThrow(/VR-1/);
    expect((await submitDraft(P(), d._id.toString(), {})).blocking.map((x) => x.code)).toContain("VR-1");
  });
});

describe("VR-2 schema", () => {
  it("pass: exact schema; fail: an unknown field", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code], extra: true }])).findings)).toEqual(["VR-2"]);
  });
});

describe("VR-3 known refs", () => {
  it("pass: a given item; fail: an unknown ref and a rejected item", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const g = await item(P(), id, "needs_reviewer");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code, g.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: ["F-99"] }])).findings)).toEqual(["VR-3"]);
    await BookFeedback.updateOne({ _id: g._id }, { $set: { status: "rejected" } });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [g.code] }])).findings)).toEqual(["VR-3"]);
  });
});

describe("VR-4 ops apply", () => {
  it("pass: a unique quote; fail: a quote that is not there", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি নৌকা", after: "একটি নৌকা", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "নেই", after: "x", refs: [f.code] }])).findings)).toEqual(["VR-4"]);
  });
});

describe("VR-5 scope", () => {
  it("pass: a chapter in scope; fail: outside the scope, and front without an item anchored there", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code], scopeChapterKeys: ["ch-001"] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-002", [{ op: "replace", before: "2টি", after: "দুটি", refs: [f.code] }])).findings)).toEqual(["VR-5"]);
    const d2 = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d2, "front", [{ op: "replace", before: "পরীক্ষামূলক", after: "অনুশীলনী", refs: [f.code] }])).findings)).toEqual(["VR-5"]);
  });
});

describe("VR-6 markers", () => {
  it("pass: marker kept; fail: marker removed", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "delete", before: "<!-- bl:ch ch-001 -->\n", refs: [f.code] }])).findings)).toContain("VR-6");
  });
});

describe("VR-7 explained", () => {
  it("pass: every hunk covered by a change row; fail: an uncovered hunk is listed (accept refused until ticked)", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    const base = "<!-- bl:ch ch-001 -->\n## অধ্যায় 1: নদীর গল্প 1\n\nটুনটুনি নদীর ধারে বসে 1টি নৌকা গুনল। The river is calm today.\n\n### অনুশীলনী 1\n\n১. নৌকা কয়টি? (1)\n\n";
    const next = base.replace("1টি নৌকা", "একটি নৌকা");
    const ok = await putChapter(P(), d._id.toString(), "ch-001", next, [{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [f.code] }]);
    expect(ok.unexplained).toBe(0);
    const bad = await putChapter(P(), d._id.toString(), "ch-001", next.replace("calm today", "calm now"), [{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [f.code] }]);
    expect(bad.unexplained).toBe(1);
  });
});

describe("VR-8 pictures", () => {
  it("pass: a picture item allows moving it; fail: a picture dropped without one", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const pic = await item(P(), id, "direct_fix", { category: "picture", chapterKey: "ch-004" });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code, pic.code] });
    expect(codes((await edit(d, "ch-004", [{ op: "delete", before: "![নৌকা](media/image1.png)\n", refs: [f.code] }])).findings)).toContain("VR-8");
    expect(codes((await edit(d, "ch-004", [{ op: "delete", before: "![নৌকা](media/image1.png)\n", refs: [pic.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-004", [{ op: "replace", before: "![নৌকা](media/image1.png)", after: "![নৌকা](media/image9.png)", refs: [pic.code] }])).findings)).toContain("VR-8");
  });
});

describe("VR-9 regions", () => {
  it("pass: protected text untouched; fail: an op inside the protected region", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix", { chapterKey: "front" });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "front", [{ op: "replace", before: "পরীক্ষামূলক", after: "অনুশীলনমূলক", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "front", [{ op: "replace", before: "টুনটুনি, ঝুমঝুমি", after: "টুনটুনি", refs: [f.code] }])).findings)).toEqual(["VR-9"]);
  });
});

describe("VR-10 characters", () => {
  it("pass: Bangla and Latin; fail: a control character, HTML or a link added", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "এক\u0007টি", refs: [f.code] }])).findings)).toEqual(["VR-10"]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "<b>একটি</b>", refs: [f.code] }])).findings)).toEqual(["VR-10"]);
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "calm today.", after: "calm, see https://example.test.", refs: [f.code] }])).findings)).toEqual(["VR-10"]);
  });
});

describe("VR-11 size", () => {
  it("pass: a modest change; fail: growth over 1.5× without an item asking for material", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings)).toEqual([]);
    expect(codes((await edit(d, "ch-001", [{ op: "insert_after", anchor: "calm today.", text: " আরও লেখা।".repeat(40), refs: [f.code] }])).findings)).toEqual(["VR-11"]);
    const i = await addInstruction(P(), id, { textBn: "প্রতিটি অধ্যায়ে অনুশীলনী বাড়ান" });
    const d2 = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code], instructionIds: [i._id.toString()] });
    const r = await edit(d2, "ch-001", [{ op: "insert_after", anchor: "calm today.", text: " আরও লেখা।".repeat(40), refs: [i.code] }]);
    expect(codes(r.findings)).toEqual([]);
    expect(codes(r.findings, "warning")).toContain("VR-11");
  });
});

describe("VR-12 sacred text", () => {
  async function sacredItem(id: string, text: string) {
    const b = await loadBook(id);
    const it = await createFeedbackRow(b, { category: "sacred_text", textBn: text, chapterKey: "ch-004" }, { source: "school", actor: new Types.ObjectId(P().userId) });
    await triageFeedback(P(), [it._id.toString()], { kind: "route", route: "needs_reviewer" });
    return it;
  }
  it("pass: the new text is verbatim in a reviewer-ruled sacred_text item; fail: no ruled item, or text not verbatim; an Arabic run outside markers is sacred", async () => {
    const id = await book();
    const ruled = await sacredItem(id, `অনুবাদটি হবে: অনুবাদ: একটি পরীক্ষিত শব্দ`);
    await BookFeedback.updateOne({ _id: ruled._id }, { $set: { reviewerRuling: { verdict: "agree", recordedBy: new Types.ObjectId(P().userId), at: new Date(), roundId: new Types.ObjectId(), recordedFromPaper: true }, status: "accepted" } });
    const unruled = await sacredItem(id, `অনুবাদ: একটি পরীক্ষিত শব্দ`);
    const plain = await item(P(), id, "direct_fix", { chapterKey: "ch-004" });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [ruled.code, unruled.code, plain.code] });
    const pass = await edit(d, "ch-004", [{ op: "replace", before: "অনুবাদ: একটি পরীক্ষামূলক শব্দ", after: "অনুবাদ: একটি পরীক্ষিত শব্দ", refs: [ruled.code] }]);
    expect(codes(pass.findings)).toEqual([]);
    expect(codes(pass.findings, "warning")).toContain("VR-12");
    expect(codes((await edit(d, "ch-004", [{ op: "replace", before: "অনুবাদ: একটি পরীক্ষামূলক শব্দ", after: "অনুবাদ: একটি পরীক্ষিত শব্দ", refs: [unruled.code] }])).findings)).toEqual(["VR-12"]);
    expect(codes((await edit(d, "ch-004", [{ op: "replace", before: "অনুবাদ: একটি পরীক্ষামূলক শব্দ", after: "অনুবাদ: অন্য কিছু", refs: [ruled.code] }])).findings)).toEqual(["VR-12"]);
    expect(codes((await edit(d, "ch-004", [{ op: "replace", before: `আলাদা আরবি: ${ARABIC}`, after: "আলাদা আরবি:", refs: [plain.code] }])).findings)).toEqual(["VR-12"]);
  });
});

describe("VR-13 rules lexicon", () => {
  it("pass: no lexicon hit; warn: a ruled-wrong spelling written", async () => {
    const id = await book();
    await uploadRuleSet(P(), { key: "spelling-test", titleBn: "বানান", bodyMarkdown: "নিয়ম\n\n```bl-lexicon\nভুলবানান → ঠিকবানান\n```\n" });
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }])).findings, "warning")).not.toContain("VR-13");
    const r = await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "ভুলবানান", refs: [f.code] }]);
    expect(codes(r.findings, "warning")).toContain("VR-13");
    expect(codes(r.findings)).toEqual([]);
  });
});

describe("VR-14 coverage", () => {
  it("pass: every item cited or in notApplied; warn: a silent skip, named", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const g = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code, g.code] });
    await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }]);
    const silent = await submitDraft(P(), d._id.toString(), {});
    expect(silent.warnings.map((w) => w.messageBn)).toContain(`চুপচাপ বাদ পড়েছে: ${g.code}`);
    await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }], { notApplied: [{ ref: g.code, reasonBn: "অনুচ্ছেদটি এই অধ্যায়ে নেই" }] });
    const ok = await submitDraft(P(), d._id.toString(), {});
    expect(ok.warnings.filter((w) => w.code === "VR-14")).toEqual([]);
    expect(ok.status).toBe("ready");
  });
});

describe("VR-15 nothing applies by itself", () => {
  it("submit never creates a version; accept (by a person) creates a DRAFT version; a failed chapter cannot be accepted", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [f.code] }]);
    await edit(d, "ch-002", [{ op: "replace", before: "নেই", after: "x", refs: [f.code] }]);
    const latestBefore = (await loadBook(id)).latestVersionId!.toString();
    await submitDraft(P(), d._id.toString(), { summaryBn: "x" });
    expect((await loadBook(id)).latestVersionId!.toString()).toBe(latestBefore);
    await expect(decideDraftChapter(P(), d._id.toString(), "ch-002", true)).rejects.toThrow(/VR-4/);
    await decideDraftChapter(P(), d._id.toString(), "ch-002", false);
    await decideDraftChapter(P(), d._id.toString(), "ch-001", true);
    const v = await acceptDraft(P(), d._id.toString(), { summaryBn: "এক → একটি" });
    expect(v.status).toBe("draft");
    expect(v.source).toBe("mcp");
  });
});

describe("decisions and rule sets reach the validator", () => {
  it("a ruled decision is a known ref (D-n)", async () => {
    const id = await book();
    const dec = await openDecision(P(), id, { questionBn: "সংখ্যা কথায়?", options: ["হ্যাঁ", "না"] });
    await ruleDecisionSelf(P(), dec._id.toString(), { optionKey: "ক" });
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    expect(codes((await edit(d, "ch-001", [{ op: "replace", before: "1টি", after: "একটি", refs: [dec.code] }])).findings)).toEqual([]);
  });
});
