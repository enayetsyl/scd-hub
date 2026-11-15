/**
 * BL-3 review fixes (docs/prd-book-lifecycle.md §12.3; D-#1627/#1628): sacred text judged against the BASE in
 * ops mode too, whole-mode VR-12 needs the actual added text verbatim, VR-7 matches whole words in
 * rows that really name the text, the bundle never drops a chapter silently, accept/tick are bound to
 * what the person saw, the transcription answer is used once. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import JSZip from "jszip";
import { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, sampleMaster, item, roundSent, samplePdf, type LcFx } from "./bookLcFixtures";
import { importBook, acceptDraft, decideDraftChapter, uploadNewVersionDraft, setDraftChanges } from "../modules/book-lifecycle/services/versionService";
import { ackUnexplained, applyChapterEdit, openEditDraft, putChapter } from "../modules/book-lifecycle/services/draftService";
import { createFeedbackRow, triageFeedback } from "../modules/book-lifecycle/services/feedbackService";
import { downloadBundle, downloadTranscriptionPack, safeBaseName, uploadBundleWhole, uploadTranscriptionResult } from "../modules/book-lifecycle/services/bundle";
import { addRoundScan } from "../modules/book-lifecycle/services/roundService";
import { loadBook, loadVersion, servedMaster, storedMaster } from "../modules/book-lifecycle/services/store";
import { validRows, runCovered } from "../modules/book-lifecycle/services/validator";
import { BookFeedback, BookDecision } from "../modules/book-lifecycle/models/BookFeedback";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { Audit } from "../modules/platform/models/Audit";
import type { IBookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

const ARABIC = "كَلِمَةٌ تَجْرِيبِيَّةٌ";
const TRANS = "অনুবাদ: একটি পরীক্ষামূলক শব্দ";
const SACRED_CH = ["## অধ্যায় 4: পবিত্র অংশ", "", "<!-- bl:sacred start -->", ARABIC, TRANS, "<!-- bl:sacred end -->", "", "শেষ।", ""].join("\n");

async function book(): Promise<string> {
  const { book } = await importBook(P(), { code: "C3-BAN", classLevel: 3, subject: "BAN", titleBn: "পরীক্ষার বই", version: "v1", state: "draft", masterMd: Buffer.from(sampleMaster({ extra: SACRED_CH })) });
  return book._id.toString();
}
const sha = (d: IBookEditDraft, key: string) => d.chapters.find((c) => c.key === key)!.baseSha!;
const edit = (d: IBookEditDraft, chapter: string, ops: unknown[]) => applyChapterEdit(P(), d._id.toString(), { schema: "book-chapter-edit/v1", draft: d._id.toString(), chapter, baseSha: sha(d, chapter), ops });
const blocking = (r: { findings: { code: string; level: string }[] }) => r.findings.filter((f) => f.level === "blocking").map((f) => f.code);

async function sacredItem(id: string, text: string, ruled: boolean) {
  const b = await loadBook(id);
  const it = await createFeedbackRow(b, { category: "sacred_text", textBn: text, chapterKey: "ch-004" }, { source: "school", actor: new Types.ObjectId(P().userId) });
  await triageFeedback(P(), [it._id.toString()], { kind: "route", route: "needs_reviewer" });
  if (ruled) await BookFeedback.updateOne({ _id: it._id }, { $set: { reviewerRuling: { verdict: "agree", recordedBy: new Types.ObjectId(P().userId), at: new Date(), roundId: new Types.ObjectId(), recordedFromPaper: true }, status: "accepted" } });
  return it;
}

describe("1 — ops mode: sacredness against the BASE", () => {
  it("a deletion of sacred text is refused for a ruled DECISION or an unruled item, allowed for a ruled sacred_text item; the marker lines are immutable", async () => {
    const id = await book();
    const ruled = await sacredItem(id, "অনুবাদ মুছে ফেলার রায়", true);
    const plain = await item(P(), id, "direct_fix", { chapterKey: "ch-004" });
    const dec = await BookDecision.create({ bookId: new Types.ObjectId(id), code: "D-01", questionBn: "প্রশ্ন?", options: [{ key: "ক", textBn: "হ্যাঁ" }, { key: "খ", textBn: "না" }], status: "ruled", ruling: { optionKey: "ক", by: "x", recordedBy: new Types.ObjectId(P().userId), at: new Date(), selfRuled: true, recordedFromPaper: false }, createdBy: new Types.ObjectId(P().userId) });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [ruled.code, plain.code] });
    const del = (refs: string[]) => [{ op: "delete", before: TRANS, refs }];
    expect(blocking(await edit(d, "ch-004", del([plain.code])))).toContain("VR-12");
    expect(blocking(await edit(d, "ch-004", del([dec.code])))).toContain("VR-12");
    expect(blocking(await edit(d, "ch-004", del([ruled.code])))).not.toContain("VR-12");
    // the sacred marker lines cannot be removed (VR-6)
    expect(blocking(await edit(d, "ch-004", [{ op: "delete", before: "<!-- bl:sacred start -->", refs: [plain.code] }]))).toContain("VR-6");
  });

  it("an earlier op cannot launder a later one: changing sacred text after a plain edit still needs the ruling", async () => {
    const id = await book();
    const plain = await item(P(), id, "direct_fix", { chapterKey: "ch-004" });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [plain.code] });
    const r = await edit(d, "ch-004", [
      { op: "replace", before: "শেষ।", after: "শেষ হলো।", refs: [plain.code] },
      { op: "replace", before: TRANS, after: "অনুবাদ: অন্য কিছু", refs: [plain.code] },
    ]);
    expect(blocking(r)).toContain("VR-12");
  });
});

describe("2 — whole mode: the added text itself must be verbatim", () => {
  it("a row that names the ruled text while the chapter says something else explains nothing; the real one passes and flags the row sacred", async () => {
    const id = await book();
    const ruled = await sacredItem(id, "অনুবাদ: একটি পরীক্ষিত শব্দ", true);
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [ruled.code] });
    const base = (await storedMaster(await loadVersion((await loadBook(id)).latestVersionId!))).split("\n");
    const chapter = (await import("../modules/book-lifecycle/services/store")).versionChapters;
    const ch4 = (await chapter(await loadVersion((await loadBook(id)).latestVersionId!))).find((c) => c.key === "ch-004")!.text;
    expect(base.length).toBeGreaterThan(5);
    const row = { chapterKey: "ch-004", beforeExcerpt: TRANS, afterExcerpt: "অনুবাদ: একটি পরীক্ষিত শব্দ", refs: [ruled.code] };
    const lie = await putChapter(P(), d._id.toString(), "ch-004", ch4.replace(TRANS, "অনুবাদ: অন্য কিছু"), [row]);
    expect(lie.findings.filter((f) => f.level === "blocking").map((f) => f.code)).toContain("VR-12");
    const ok = await putChapter(P(), d._id.toString(), "ch-004", ch4.replace(TRANS, "অনুবাদ: একটি পরীক্ষিত শব্দ"), [row]);
    expect(ok.findings.filter((f) => f.level === "blocking")).toEqual([]);
    const fresh = await (await import("../modules/book-lifecycle/services/versionService")).loadDraft(d._id);
    expect(fresh.changes.find((c) => c.chapterKey === "ch-004")?.sacred).toBe(true);
  });
});

describe("3 — VR-7 whole words, rows that really name the text", () => {
  it("a short unrelated insertion is not covered by another row; a row naming text that is not there explains nothing", () => {
    const base = "টুনটুনি নদীর ধারে বসে 1টি নৌকা গুনল।";
    const next = "টুনটুনি নদীর ধারে বসে একটি নৌকা গুনল না।";
    const rows = [{ chapterKey: "ch-001", beforeExcerpt: "বসে 1টি নৌকা", afterExcerpt: "বসে একটি নৌকা", refs: ["F-1"] }];
    expect(runCovered("1টি", "একটি", rows)).toBe(true);
    expect(runCovered("", "না", rows)).toBe(false);
    expect(runCovered("", "না", [{ ...rows[0], afterExcerpt: "বসে একটি নৌকা গুনল না। আর বানান" }])).toBe(true); // a whole word inside a row that names it
    expect(runCovered("", "না", [{ ...rows[0], afterExcerpt: "বানান" }])).toBe(false); // না inside বানান is not the word
    expect(validRows([{ ...rows[0], beforeExcerpt: "এই লেখা বইয়ে নেই" }], base, next)).toEqual([]);
  });

  it("end to end: a chapter with a real edit plus a silent short insertion leaves one unexplained run", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    const ch = (await (await import("../modules/book-lifecycle/services/store")).versionChapters(await loadVersion((await loadBook(id)).latestVersionId!))).find((c) => c.key === "ch-001")!.text;
    const next = ch.replace("1টি নৌকা", "একটি নৌকা").replace("গুনল।", "গুনল না।");
    const r = await putChapter(P(), d._id.toString(), "ch-001", next, [{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [f.code] }]);
    expect(r.unexplained).toBe(1);
  });
});

describe("4/7 — the bundle", () => {
  it("whole upload: a stray marker is refused; a dropped chapter is reported, never silently lost; an oversize chapter is refused", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const b = await downloadBundle(P(), id, { feedback: [f.code] });
    const v = await loadVersion((await loadBook(id)).latestVersionId!);
    const master = await servedMaster(v);
    const rows = JSON.stringify([{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [f.code] }]);
    const cut = master.slice(0, master.indexOf("<!-- bl:ch ch-003 -->")).replace("1টি নৌকা", "একটি নৌকা");
    const res = await uploadBundleWhole(P(), id, { nonce: b.nonce, master: Buffer.from(cut), changesJson: rows });
    expect(res.missingChapters).toContain("ch-003");
    expect(res.chapters.map((c) => c.key)).toContain("ch-001");
    await expect(uploadBundleWhole(P(), id, { nonce: b.nonce, master: Buffer.from(`${master}\n<!-- bl:ch ch-777 -->\n`), changesJson: rows })).rejects.toMatchObject({ code: "VR-6" });
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    await expect(putChapter(P(), d._id.toString(), "ch-001", "x".repeat(150_001), [])).rejects.toMatchObject({ code: "VR-11" });
  });

  it("scan names in the pack are one safe path segment", () => {
    expect(safeBaseName("../../etc/passwd")).toBe("passwd");
    expect(safeBaseName("..\\..\\x.pdf")).toBe("x.pdf");
    expect(safeBaseName("...")).toBe("scan");
    expect(safeBaseName("a\u0000b.pdf")).toBe("ab.pdf");
  });

  it("the transcription answer is used once; a bad mark refuses the whole answer before anything is written", async () => {
    const { book: bk } = await (await import("./bookLcFixtures")).importSample(P());
    const id = bk._id.toString();
    const f = await item(P(), id, "needs_reviewer");
    const r = await roundSent(P(), id);
    await addRoundScan(fx.auth.officeManage, r._id.toString(), { name: "s.pdf", data: await samplePdf(1, []) });
    const pack = await downloadTranscriptionPack(P(), r._id.toString());
    const answer = (extra: object = {}) => JSON.stringify({ schema: "book-feedback-items/v1", round: r._id.toString(), nonce: pack.nonce, items: [{ category: "spelling", text_bn: "একটি বানান" }], item_marks: [], decision_marks: [], ...extra });
    await expect(uploadTranscriptionResult(P(), r._id.toString(), answer({ item_marks: [{ feedback_code: "F-99", verdict: "agree" }] }))).rejects.toMatchObject({ code: "NOT_ASKED" });
    expect(await BookFeedback.countDocuments({ roundId: r._id, source: "reviewer" })).toBe(0);
    const ok = await uploadTranscriptionResult(P(), r._id.toString(), answer({ item_marks: [{ feedback_code: f.code, verdict: "agree" }] }));
    expect(ok.created).toHaveLength(1);
    await expect(uploadTranscriptionResult(P(), r._id.toString(), answer())).rejects.toMatchObject({ code: "MISMATCH" });
  });
});

describe("5/6 — accept and tick are bound to what the person saw", () => {
  it("accept refuses when the chapter changed since it was shown; the tick is keyed to the run and needs an open draft; both leave records", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    const ch = (await (await import("../modules/book-lifecycle/services/store")).versionChapters(await loadVersion((await loadBook(id)).latestVersionId!))).find((c) => c.key === "ch-001")!.text;
    const row = { chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [f.code] };
    await putChapter(P(), d._id.toString(), "ch-001", ch.replace("1টি নৌকা", "একটি নৌকা").replace("গুনল।", "গুনল না।"), [row]);
    let dd = await (await import("../modules/book-lifecycle/services/versionService")).loadDraft(d._id);
    const shown = dd.chapters.find((c) => c.key === "ch-001")!;
    const u = shown.unexplained[0];
    expect(u.runHash).toBeTruthy();
    await expect(ackUnexplained(P(), d._id.toString(), "ch-001", 0, "deadbeefdeadbeef")).rejects.toMatchObject({ code: "CHANGED" });
    await ackUnexplained(P(), d._id.toString(), "ch-001", 0, u.runHash);
    expect(await BookEvent.countDocuments({ kind: "DRAFT_CHAPTER", summary: /seen/ })).toBe(1);
    expect((await Audit.find({ eventKind: "BOOK_LC_FINALIZED" }).lean()).some((a) => (a.meta as { action?: string })?.action === "ack_unexplained")).toBe(true);
    // the chapter is re-edited after it was shown → the old sha is refused
    await putChapter(P(), d._id.toString(), "ch-001", ch.replace("1টি নৌকা", "একটি নৌকা"), [row]);
    await expect(decideDraftChapter(P(), d._id.toString(), "ch-001", true, shown.newSha)).rejects.toMatchObject({ code: "CHANGED" });
    dd = await (await import("../modules/book-lifecycle/services/versionService")).loadDraft(d._id);
    const fresh = dd.chapters.find((c) => c.key === "ch-001")!;
    expect((await decideDraftChapter(P(), d._id.toString(), "ch-001", true, fresh.newSha)).chapters.find((c) => c.key === "ch-001")?.status).toBe("accepted");
  });
});

describe("13 — the whole-upload path runs VR-7 and VR-12 too", () => {
  it("an uploaded version with a sacred change that is not the ruled text cannot be accepted", async () => {
    const id = await book();
    const plain = await item(P(), id, "direct_fix", { chapterKey: "ch-004" });
    const master = await storedMaster(await loadVersion((await loadBook(id)).latestVersionId!));
    const draft = await uploadNewVersionDraft(P(), id, { masterMd: Buffer.from(master.replace(TRANS, "অনুবাদ: অন্য কিছু")) });
    await setDraftChanges(P(), draft._id.toString(), [{ chapterKey: "ch-004", beforeExcerpt: TRANS, afterExcerpt: "অনুবাদ: অন্য কিছু", refs: [plain.code] }]);
    await decideDraftChapter(P(), draft._id.toString(), "ch-004", true);
    await expect(acceptDraft(P(), draft._id.toString(), { summaryBn: "x" })).rejects.toMatchObject({ code: "VR-12" });
  });
});

describe("12 — exactly one chapter heading per chapter (VR-6)", () => {
  it("a second chapter-level heading is refused; a heading inside a code fence does not count", async () => {
    const id = await book();
    const f = await item(P(), id, "direct_fix");
    const d = await openEditDraft(P(), id, { source: "mcp", feedback: [f.code] });
    const ch = (await (await import("../modules/book-lifecycle/services/store")).versionChapters(await loadVersion((await loadBook(id)).latestVersionId!))).find((c) => c.key === "ch-001")!.text;
    const two = await putChapter(P(), d._id.toString(), "ch-001", `${ch}\n## আরেকটি শিরোনাম\n`, []);
    expect(two.findings.filter((x) => x.level === "blocking").map((x) => x.code)).toContain("VR-6");
    const fenced = await putChapter(P(), d._id.toString(), "ch-001", `${ch}\n\`\`\`\n## ঢাকা শিরোনাম\n\`\`\`\n`, []);
    expect(fenced.findings.filter((x) => x.level === "blocking").map((x) => x.code)).not.toContain("VR-6");
  });
});

it("zip helper stays a plain JSZip (streamed by the route)", async () => {
  const id = await book();
  const out = await downloadBundle(P(), id, { feedback: [] }, { buffer: false });
  expect(out.zip.length).toBe(0);
  expect(await JSZip.loadAsync(await out.jszip.generateAsync({ type: "nodebuffer" }))).toBeTruthy();
});
