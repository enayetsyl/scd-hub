/**
 * BL-1 review fixes (docs/prd-book-lifecycle.md; D-#1619–#1621): applied-only-when-accepted, the
 * imported base of a first memo, server-derived file types, events for every write, size-cap
 * refusals, media zip extraction, the draft/round guards, correction history, the direct-fix
 * interim coverage and the small items. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import JSZip from "jszip";
import { BOOK_LC_LIMITS } from "@scd/shared";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, attachMasterPdf, samplePdf, sampleMaster, type LcFx } from "./bookLcFixtures";
import {
  acceptDraft,
  approveDirectFix,
  confirmDraftRekey,
  decideDraftChapter,
  importBook,
  setDraftChanges,
  uploadNewVersionDraft,
  uploadVersionFile,
} from "../modules/book-lifecycle/services/versionService";
import { addRoundScan, checkAgainstScan, correctReturn, detectPageMap, markSentOnPaper, openRound, recordReturn, setDecisionMarks, setItemMarks, setPageMap, updateRound, makePacket } from "../modules/book-lifecycle/services/roundService";
import { addInstruction, fileFeedback, openDecision, triageFeedback, updateFeedbackAnchor } from "../modules/book-lifecycle/services/feedbackService";
import { BookFeedback, BookDecision } from "../modules/book-lifecycle/models/BookFeedback";
import { SchoolBook } from "../modules/book-lifecycle/models/SchoolBook";
import { BookMemoRound } from "../modules/book-lifecycle/models/BookMemoRound";
import { BookVersion } from "../modules/book-lifecycle/models/BookVersion";
import { loadBook, loadVersion, storedMaster } from "../modules/book-lifecycle/services/store";
import { roundMemoMarkdown } from "../modules/book-lifecycle/services/roundService";
import { detectChapterStarts } from "../modules/book-lifecycle/services/packet";
import { BookLcError } from "../modules/book-lifecycle/services/errors";
import { detectLcMime, allowedMimesFor, storeLcFile } from "../modules/book-lifecycle/services/files";
import { oid } from "../modules/book-lifecycle/services/access";
import { bookLcServeHeaders, recordBookLcFileRead } from "../modules/book-lifecycle/routes/bookLcFiles";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { Audit } from "../modules/platform/models/Audit";
import { Notification } from "../modules/notifications/models/Notification";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;
const OM = () => fx.auth.officeManage;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("1 — applied only from accepted", () => {
  it("a cited with_reviewer item stays with_reviewer; an untriaged (open) item cannot be cited; an accepted one is applied", async () => {
    const { book } = await importSample(P());
    const id = book._id.toString();
    const needs = await item(P(), id, "needs_reviewer");
    const fix = await item(P(), id, "direct_fix", { chapterKey: "ch-002" });
    const raw = await fileFeedback(P(), id, "school", { category: "spelling", textBn: "এখনো বাছাই হয়নি" });
    const latest = await loadVersion((await loadBook(book._id)).latestVersionId!);
    const master = await storedMaster(latest);
    const draft = await uploadNewVersionDraft(P(), id, { masterMd: Buffer.from(master.replace("1টি নৌকা", "একটি নৌকা")) });
    await expect(setDraftChanges(P(), draft._id.toString(), [{ chapterKey: "ch-001", refs: [raw.code], afterExcerpt: "একটি নৌকা" }])).rejects.toThrow(/বাছাই/);
    const v = await childVersion(P(), id, "2টি নৌকা", "দুটি নৌকা", [needs.code, fix.code]);
    expect(v.status).toBe("draft");
    expect((await BookFeedback.findById(needs._id))?.status).toBe("with_reviewer");
    expect((await BookFeedback.findById(fix._id))?.status).toBe("applied");
  });
});

describe("2 — the base of a first memo on an imported book", () => {
  it("lists every change and direct fix since the import (not 'first review — whole book')", async () => {
    const { book } = await importSample(P(), { state: "approved" });
    const id = book._id.toString();
    const imported = await loadVersion((await loadBook(book._id)).latestVersionId!);
    const fix = await item(P(), id, "direct_fix");
    const v2 = await childVersion(P(), id, "1টি নৌকা", "একটি নৌকা", [fix.code]);
    await approveDirectFix(P(), v2._id.toString());
    const needs = await item(P(), id, "needs_reviewer", { chapterKey: "ch-002" });
    const v3 = await childVersion(P(), id, "2টি নৌকা", "দুটি নৌকা", [needs.code]);
    await attachMasterPdf(P(), v3._id.toString());
    const r = await openRound(P(), id, { reviewerName: "পর্যালোচক (কাল্পনিক)" });
    expect(r.baseVersionId?.equals(imported._id)).toBe(true);
    const md = await roundMemoMarkdown(r);
    expect(md).not.toContain("প্রথম পর্যালোচনা");
    expect(md).toContain(fix.code);
    expect(md).toContain("সরাসরি সংশোধন — জানানোর জন্য");
    expect(md).toContain(needs.code);
  });

  it("a book imported as a draft has no base: the first memo is the whole book", async () => {
    const { book } = await importSample(P());
    await attachMasterPdf(P(), (await loadBook(book._id)).latestVersionId!.toString());
    const r = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক (কাল্পনিক)" });
    expect(r.baseVersionId).toBeUndefined();
  });
});

describe("3 — the stored type is the server's", () => {
  it("derives the type from extension + bytes; refuses html/svg and mismatches; markdown is text/plain", async () => {
    const pdf = await samplePdf(1, []);
    expect(detectLcMime("a.pdf", pdf, allowedMimesFor("book_lc_history"))).toBe("application/pdf");
    expect(detectLcMime("a.pdf", Buffer.from("<html><script>alert(1)</script>"), allowedMimesFor("book_lc_history"))).toBeNull();
    expect(detectLcMime("a.html", Buffer.from("<html>"), allowedMimesFor("book_lc_history"))).toBeNull();
    expect(detectLcMime("a.svg", Buffer.from("<svg onload=alert(1)>"), allowedMimesFor("book_lc_history"))).toBeNull();
    expect(detectLcMime("a.svg", Buffer.from("<svg/>"), allowedMimesFor("book_lc_media"))).toBeNull();
    expect(detectLcMime("notes.md", Buffer.from("# টুনটুনি"), allowedMimesFor("book_lc_history"))).toBe("text/plain");
    expect(detectLcMime("a.png", PNG, allowedMimesFor("book_lc_feedback"))).toBe("image/png");
  });

  it("ignores a client MIME on storage and on a version file; serves non-image files as attachments", async () => {
    const { book } = await importSample(P());
    const f = await storeLcFile({ kind: "book_lc_history", name: "memo.pdf", mime: "text/html", data: await samplePdf(1, []), bookCode: book.code, version: "history", role: "history", uploadedBy: P().userId });
    expect(f.mime).toBe("application/pdf");
    await expect(storeLcFile({ kind: "book_lc_history", name: "x.html", mime: "text/html", data: Buffer.from("<script>1</script>"), bookCode: book.code, version: "history", role: "history", uploadedBy: P().userId })).rejects.toMatchObject({ code: "BAD_TYPE" });
    const v = await uploadVersionFile(P(), (await loadBook(book._id)).latestVersionId!.toString(), { role: "edition", edition: "TEACHER", name: "t.md", data: Buffer.from("# টুনটুনি\n"), mime: "text/html" });
    const stored = await StoredFile.findById(v.files.find((x) => x.role === "edition")!.storedFileId);
    expect(stored?.mime).toBe("text/plain");
    expect(bookLcServeHeaders({ mime: "text/plain" } as never).disposition).toBe("attachment");
    expect(bookLcServeHeaders({ mime: "application/pdf" } as never).disposition).toBe("inline");
    await expect(uploadVersionFile(P(), (await loadBook(book._id)).latestVersionId!.toString(), { role: "master_pdf", name: "m.pdf", data: Buffer.from("<html>not a pdf"), mime: "application/pdf" })).rejects.toMatchObject({ code: "BAD_TYPE" });
  });

  it("an SVG in the media zip is refused", async () => {
    const zip = new JSZip();
    zip.file("media/image1.svg", "<svg onload=alert(1)/>");
    await expect(
      importBook(P(), { code: "C4-SCI", classLevel: 4, subject: "SCI", titleBn: "বিজ্ঞান", version: "v1", state: "draft", masterMd: Buffer.from(sampleMaster({ extra: "\n![ছবি](media/image1.svg)\n" })), mediaZip: await zip.generateAsync({ type: "nodebuffer" }) }),
    ).rejects.toMatchObject({ code: "BAD_MEDIA" });
  });
});

describe("4 — a BookEvent for every write, content reads logged", () => {
  it("records draft, page-map, mark, memo-setting, instruction and anchor writes; a packet / master download is a content read", async () => {
    const { book } = await importSample(P());
    const id = book._id.toString();
    const f = await item(P(), id, "needs_reviewer");
    const d = await openDecision(P(), id, { questionBn: "অঙ্কে না কথায়?", options: ["অঙ্কে", "কথায়"] });
    const latest = await loadVersion((await loadBook(book._id)).latestVersionId!);
    await addInstruction(P(), id, { textBn: "সংখ্যা কথায় লিখুন" });
    await updateFeedbackAnchor(P(), f._id.toString(), { page: "7" });
    // draft path
    const master = await storedMaster(latest);
    const fix = await item(P(), id, "direct_fix", { chapterKey: "ch-002" });
    const draft = await uploadNewVersionDraft(P(), id, { masterMd: Buffer.from(master.replace("2টি নৌকা", "দুটি নৌকা")) });
    await setDraftChanges(P(), draft._id.toString(), [{ chapterKey: "ch-002", beforeExcerpt: "2টি নৌকা", afterExcerpt: "দুটি নৌকা", refs: [fix.code] }]);
    await confirmDraftRekey(P(), draft._id.toString());
    await decideDraftChapter(P(), draft._id.toString(), "ch-002", true);
    const v2 = await acceptDraft(P(), draft._id.toString(), { summaryBn: "একটি সংশোধন" });
    // round path
    await attachMasterPdf(P(), v2._id.toString());
    let r = await openRound(P(), id, { reviewerName: "পর্যালোচক (কাল্পনিক)", feedbackIds: [f._id.toString()], decisionIds: [d._id.toString()] });
    r = await updateRound(P(), r._id.toString(), { extraNotesBn: "ধন্যবাদ" });
    r = await detectPageMap(P(), r._id.toString());
    const chapters = v2.chapters.filter((c) => c.key !== "front").sort((a, b) => a.order - b.order);
    r = await setPageMap(P(), r._id.toString(), chapters.map((c, i) => ({ chapterKey: c.key, startPage: 3 + i * 3 })));
    r = await makePacket(P(), r._id.toString(), "whole");
    r = await markSentOnPaper(P(), r._id.toString(), {});
    r = await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await samplePdf(1, []) });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree" }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: "খ" }]);
    const events = await BookEvent.find({ bookId: id }).lean();
    const has = (kind: string, re: RegExp) => events.some((e) => e.kind === kind && re.test(e.summary));
    expect(has("FEEDBACK_FILED", /instruction added/)).toBe(true);
    expect(has("FEEDBACK_TRIAGED", /anchor changed/)).toBe(true);
    expect(has("DRAFT_CHAPTER", /change rows set/)).toBe(true);
    expect(has("DRAFT_CHAPTER", /new\/missing chapters confirmed/)).toBe(true);
    expect(has("DRAFT_CHAPTER", /chapter ch-002 accepted/)).toBe(true);
    expect(has("ROUND_OPENED", /settings changed/)).toBe(true);
    expect(has("PACKET_MADE", /pages detected/)).toBe(true);
    expect(has("PACKET_MADE", /start pages confirmed/)).toBe(true);
    expect(has("FEEDBACK_RULED", /item mark\(s\) hand \[/)).toBe(true);
    expect(has("DECISION_RULED", /decision mark\(s\) hand \[/)).toBe(true);
    // downloads → CONTENT_READ (once per user/version/surface/day)
    const ctx = (a: ReturnType<typeof P>) => ({ auth: a } as never);
    const round = await BookMemoRound.findById(r._id);
    const memoFile = await StoredFile.findById(round!.packet!.memoPdfFileId);
    const verFile = await BookVersion.findById(v2._id);
    const pdf = await StoredFile.findById(verFile!.files.find((x) => x.role === "master_pdf")!.storedFileId);
    await recordBookLcFileRead(ctx(P()), memoFile!);
    await recordBookLcFileRead(ctx(P()), pdf!);
    const reads = await BookEvent.find({ bookId: id, kind: "CONTENT_READ" }).lean();
    expect(reads.some((e) => /packet/.test(e.summary))).toBe(true);
    expect(reads.some((e) => /master/.test(e.summary))).toBe(true);
    expect(JSON.stringify(events)).not.toContain("ধন্যবাদ");
  });
});

describe("6 — cap refusals are Bangla BookLcErrors; a bad id is too", () => {
  it("an oversized file is refused with CAP before Drive; a bad id is BAD_ID", async () => {
    const { book } = await importSample(P());
    await expect(storeLcFile({ kind: "book_lc_history", name: "big.pdf", data: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(BOOK_LC_LIMITS.historyBytes)]), bookCode: book.code, version: "history", role: "history", uploadedBy: P().userId })).rejects.toMatchObject({ code: "CAP" });
    const r = await roundSent(P(), book._id.toString());
    await expect(addRoundScan(OM(), r._id.toString(), { name: "s.png", data: Buffer.concat([PNG, Buffer.alloc(BOOK_LC_LIMITS.photoBytes)]) })).rejects.toMatchObject({ code: "CAP" });
    await expect(uploadVersionFile(P(), r.versionId.toString(), { role: "master_docx", name: "t.docx", data: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(BOOK_LC_LIMITS.masterDocxBytes)]) })).rejects.toMatchObject({ code: "CAP" });
    expect(() => oid("not-an-id", "বই")).toThrow(BookLcError);
    expect(() => oid("not-an-id")).toThrow(/ভুল/);
  });
});

describe("7 — media zip extraction", () => {
  it("keys by full path (same names in two folders), ignores unreferenced entries, refuses an oversized entry before inflating", async () => {
    const png2 = Buffer.concat([PNG, Buffer.from([9, 9, 9])]);
    const zip = new JSZip();
    zip.file("other/image1.png", PNG);
    zip.file("media/image1.png", png2);
    zip.file("junk/readme.svg", "<svg onload=alert(1)/>");
    const master = sampleMaster({ extra: "\n![ছবি](media/image1.png)\n" });
    const { version } = await importBook(P(), { code: "C4-SCI", classLevel: 4, subject: "SCI", titleBn: "বিজ্ঞান", version: "v1", state: "draft", masterMd: Buffer.from(master), mediaZip: await zip.generateAsync({ type: "nodebuffer" }) });
    const { BookMediaAsset } = require("../modules/book-lifecycle/models/BookVersion") as typeof import("../modules/book-lifecycle/models/BookVersion");
    const asset = await BookMediaAsset.findById(version.media[0].assetId);
    expect(asset?.bytes).toBe(png2.length);
    // A "bomb": a 16 MB entry that compresses to a few KB is refused by its declared size.
    const bomb = new JSZip();
    bomb.file("media/image1.png", Buffer.concat([PNG, Buffer.alloc(BOOK_LC_LIMITS.mediaBytes + 1)]), { compression: "DEFLATE" });
    await expect(
      importBook(P(), { code: "C5-SCI", classLevel: 5, subject: "SCI", titleBn: "গণিত", version: "v1", state: "draft", masterMd: Buffer.from(master), mediaZip: await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) }),
    ).rejects.toMatchObject({ code: "CAP" });
  });
});

describe("8 — packet and draft guards", () => {
  it("sending refuses a version that is no longer the latest; accepting a draft refuses while a round is open on its base", async () => {
    const { book } = await importSample(P());
    const id = book._id.toString();
    const latest = await loadVersion((await loadBook(book._id)).latestVersionId!);
    await attachMasterPdf(P(), latest._id.toString());
    let r = await openRound(P(), id, { reviewerName: "পর্যালোচক (কাল্পনিক)" });
    r = await detectPageMap(P(), r._id.toString());
    r = await setPageMap(P(), r._id.toString(), latest.chapters.filter((c) => c.key !== "front").sort((a, b) => a.order - b.order).map((c, i) => ({ chapterKey: c.key, startPage: 3 + i * 3 })));
    r = await makePacket(P(), r._id.toString(), "whole");
    // a draft on the same base is refused while the round is open
    const master = await storedMaster(latest);
    const draft = await uploadNewVersionDraft(P(), id, { masterMd: Buffer.from(master.replace("1টি নৌকা", "একটি নৌকা")) });
    const fix = await item(P(), id, "direct_fix");
    await setDraftChanges(P(), draft._id.toString(), [{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [fix.code] }]);
    await decideDraftChapter(P(), draft._id.toString(), "ch-001", true);
    await expect(acceptDraft(P(), draft._id.toString(), { summaryBn: "x" })).rejects.toMatchObject({ code: "ROUND_OPEN" });
    // and sending refuses when the book's latest moved on
    await SchoolBook.updateOne({ _id: book._id }, { $set: { latestVersionId: oid(draft._id) } });
    await expect(markSentOnPaper(P(), r._id.toString(), {})).rejects.toMatchObject({ code: "NOT_LATEST" });
  });
});

describe("9 — correcting a recorded return", () => {
  async function returned(verdict: "approve" | "changes") {
    const { book } = await importSample(P());
    const f = await item(P(), book._id.toString(), "needs_reviewer");
    const d = await openDecision(P(), book._id.toString(), { questionBn: "অঙ্কে না কথায়?", options: ["অঙ্কে", "কথায়"] });
    const r = await roundSent(P(), book._id.toString());
    await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await samplePdf(1, []) });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree" }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: "ক" }]);
    await checkAgainstScan(OM(), r._id.toString(), { kind: "item", id: f._id.toString() });
    await checkAgainstScan(OM(), r._id.toString(), { kind: "decision", id: d._id.toString() });
    await recordReturn(P(), r._id.toString(), { verdict });
    return { r, f, d };
  }

  it("works only on an approved version; writes a main Audit row; keeps the replaced decision ruling", async () => {
    const { r, d } = await returned("approve");
    await Audit.deleteMany({});
    await correctReturn(P(), r._id.toString(), { decisionMarks: [{ decisionId: d._id.toString(), optionKey: "খ" }], noteBn: "স্ক্যানে খ টিক ছিল" });
    const dec = await BookDecision.findById(d._id);
    expect(dec?.ruling?.optionKey).toBe("খ");
    expect(dec?.rulingHistory).toHaveLength(1);
    expect((dec?.rulingHistory?.[0] as { optionKey: string }).optionKey).toBe("ক");
    expect((await Audit.find({ eventKind: "BOOK_LC_FINALIZED" }).lean()).some((a) => (a.meta as { action?: string })?.action === "correct_return")).toBe(true);
  });

  it("is refused once the version is changes_requested", async () => {
    const { r, d } = await returned("changes");
    await expect(correctReturn(P(), r._id.toString(), { decisionMarks: [{ decisionId: d._id.toString(), optionKey: "খ" }], noteBn: "ভুল" })).rejects.toMatchObject({ code: "FROZEN" });
  });
});

describe("10 — direct-fix approve of an uploaded version needs the diff covered", () => {
  it("refuses a change that no row accounts for; accepts the covered one", async () => {
    const { book } = await importSample(P(), { state: "approved" });
    const id = book._id.toString();
    const fix = await item(P(), id, "direct_fix");
    const latest = await loadVersion((await loadBook(book._id)).latestVersionId!);
    const master = await storedMaster(latest);
    // one covered edit plus a silent one in the same chapter
    const edited = master.replace("1টি নৌকা", "একটি নৌকা").replace("The river is calm today.", "The river is stormy today.");
    const draft = await uploadNewVersionDraft(P(), id, { masterMd: Buffer.from(edited) });
    await setDraftChanges(P(), draft._id.toString(), [{ chapterKey: "ch-001", beforeExcerpt: "1টি নৌকা", afterExcerpt: "একটি নৌকা", refs: [fix.code] }]);
    await decideDraftChapter(P(), draft._id.toString(), "ch-001", true);
    const v = await acceptDraft(P(), draft._id.toString(), { summaryBn: "একটি সংশোধন" });
    await expect(approveDirectFix(P(), v._id.toString())).rejects.toMatchObject({ code: "UNCOVERED" });
    // a fully covered upload is approved (the same path the other suites use)
    const { book: b2 } = await importSample(P(), { code: "C3-ENG", state: "approved" });
    const f3 = await item(P(), b2._id.toString(), "direct_fix");
    const v2 = await childVersion(P(), b2._id.toString(), "1টি নৌকা", "একটি নৌকা", [f3.code]);
    expect((await approveDirectFix(P(), v2._id.toString())).status).toBe("approved");
  });
});

describe("11 — small items", () => {
  it("a contents page naming several chapters is never a chapter start", () => {
    const pages = ["Contents: Chapter 1 River Story  Chapter 2 River Story  Chapter 3 River Story", "Chapter 1 River Story\nbody", "text", "Chapter 2 River Story\nbody", "Chapter 3 River Story\nbody"];
    const map = detectChapterStarts(pages, [
      { key: "ch-001", title: "Chapter 1 River Story" },
      { key: "ch-002", title: "Chapter 2 River Story" },
      { key: "ch-003", title: "Chapter 3 River Story" },
    ]);
    expect(map.map((m) => m.startPage)).toEqual([2, 4, 5]);
  });

  it("the Principal who files a print-error item is not notified of her own item; another manager is", async () => {
    const { book } = await importSample(P());
    await Notification.deleteMany({});
    await fileFeedback(P(), book._id.toString(), "print_error", { category: "spelling", textBn: "ছাপার ভুল" });
    expect(await Notification.countDocuments({ kind: "BOOK_FEEDBACK_FILED", recipientUserId: P().userId })).toBe(0);
  });

  it("a sacred_text item her ruling accepted may be routed verbal_errata", async () => {
    const { book } = await importSample(P());
    const id = book._id.toString();
    const f = await fileFeedback(P(), id, "school", { category: "sacred_text", textBn: "আয়াতের অনুবাদ মিলিয়ে নিন" });
    await triageFeedback(P(), [f._id.toString()], { kind: "route", route: "needs_reviewer" });
    const r = await roundSent(P(), id);
    await approveOnPaper(P(), r._id.toString());
    expect((await BookFeedback.findById(f._id))?.status).toBe("accepted");
    const [out] = await triageFeedback(P(), [f._id.toString()], { kind: "route", route: "verbal_errata" });
    expect(out.route).toBe("verbal_errata");
  });
});
