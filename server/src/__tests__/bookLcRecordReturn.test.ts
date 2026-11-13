/**
 * BL-1 — recording the returned paper copy (docs/prd-book-lifecycle.md §10.3, §19 bookLcRecordReturn;
 * owner Q1, D-#1615). Invented names and text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, roundSent, samplePdf, type LcFx } from "./bookLcFixtures";
import {
  addRoundScan,
  addReviewerPoints,
  checkAgainstScan,
  correctReturn,
  openRound,
  proposeTranscription,
  recordReturn,
  setDecisionMarks,
  setItemMarks,
  withdrawRound,
  loadRound,
} from "../modules/book-lifecycle/services/roundService";
import { openDecision } from "../modules/book-lifecycle/services/feedbackService";
import { BookFeedback, BookDecision } from "../modules/book-lifecycle/models/BookFeedback";
import { loadVersion } from "../modules/book-lifecycle/services/store";
import { ForbiddenError } from "../middleware/authz";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const P = () => fx.auth.principal;
const OM = () => fx.auth.officeManage;
const scanPdf = () => samplePdf(2, []);

/** A book with one item and one decision asked, out on paper. */
async function sentWithAskedRows() {
  const { book } = await importSample(P());
  const f = await item(P(), book._id.toString(), "needs_reviewer", { quote: "1টি নৌকা" });
  const d = await openDecision(P(), book._id.toString(), { questionBn: "সংখ্যা অঙ্কে না কথায়?", options: ["অঙ্কে", "কথায়"], recommendedIndex: 1 });
  const r = await roundSent(P(), book._id.toString());
  return { book, f, d, r };
}

describe("refusals", () => {
  it("no scan → refused; round not sent → refused; unchecked rows → refused with the count", async () => {
    const { f, d, r } = await sentWithAskedRows();
    await expect(recordReturn(P(), r._id.toString(), { verdict: "approve" })).rejects.toThrow(/স্ক্যান/);
    await addRoundScan(OM(), r._id.toString(), { name: "ফেরত.pdf", data: await scanPdf(), mime: "application/pdf" });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree", scanPage: 1 }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: "খ", scanPage: 2 }]);
    await expect(recordReturn(P(), r._id.toString(), { verdict: "approve" })).rejects.toThrow("২টি সারি স্ক্যানের সাথে মেলানো হয়নি");
    const other = await importSample(P(), { code: "C3-ENG" });
    const draftRound = await openRound(P(), other.book._id.toString(), { reviewerName: "ক" });
    await expect(recordReturn(P(), draftRound._id.toString(), { verdict: "approve" })).rejects.toThrow(/কাগজে পাঠানো/);
  });

  it("verdict and rulings only by finalize: Office with manage (or a granted LOCKED finalize) is refused", async () => {
    const { f, r } = await sentWithAskedRows();
    await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree" }]);
    await expect(recordReturn(OM(), r._id.toString(), { verdict: "changes" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordReturn(fx.auth.officeFinalizeGrant, r._id.toString(), { verdict: "changes" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctReturn(OM(), r._id.toString(), { noteBn: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("'approved' with a decision left 'পরে' is refused", async () => {
    const { f, d, r } = await sentWithAskedRows();
    await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree" }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: null, noteBn: "পরে ভাবব" }]);
    await checkAgainstScan(OM(), r._id.toString(), { kind: "item", id: f._id.toString() });
    await checkAgainstScan(OM(), r._id.toString(), { kind: "decision", id: d._id.toString() });
    await expect(recordReturn(P(), r._id.toString(), { verdict: "approve" })).rejects.toThrow(/পরে/);
    // "changes needed" with the decision left for later is fine.
    await recordReturn(P(), r._id.toString(), { verdict: "changes" });
    expect((await loadVersion(r.versionId)).status).toBe("changes_requested");
    expect((await BookDecision.findById(d._id))?.status).toBe("open");
  });
});

describe("transcription with the scan as evidence", () => {
  it("hand-transcribed points get source reviewer, roundId and evidence; MCP/bundle rows arrive unchecked", async () => {
    const { r, f } = await sentWithAskedRows();
    const withScan = await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    const scanId = withScan.scanFileIds[0].toString();
    const [hand] = await addReviewerPoints(OM(), r._id.toString(), { scanFileId: scanId, items: [{ chapterKey: "ch-002", page: "৭", quote: "নদীর ধারে", category: "grammar", textBn: "‘ধারে’ নয়, ‘পাড়ে’", scanPage: 2 }] });
    expect(hand.source).toBe("reviewer");
    expect(hand.roundId?.equals(r._id)).toBe(true);
    expect(hand.evidence?.scanFileId?.toString()).toBe(scanId);
    expect(hand.evidence?.scanPage).toBe(2);
    expect(hand.evidence?.via).toBe("hand");
    expect(hand.evidence?.checkedAgainstScan?.at).toBeUndefined();

    const { items, round } = await proposeTranscription(
      OM(),
      r._id.toString(),
      { scanFileId: scanId, items: [{ chapterKey: "ch-003", category: "spelling", textBn: "বানান ঠিক করুন", scanPage: 3 }], itemMarks: [{ feedbackCode: f.code, verdict: "modify", noteBn: "অন্যভাবে লিখুন", scanPage: 1 }] },
      "mcp",
    );
    expect(items[0].evidence?.via).toBe("mcp");
    expect(round.itemMarks[0].via).toBe("mcp");
    expect(round.itemMarks[0].checkedAgainstScan?.at).toBeUndefined();
    // Claude's transcription never records a verdict nor moves the version.
    expect(round.status).toBe("sent_on_paper");
    expect(round.verdict).toBeUndefined();
    expect((await loadVersion(r.versionId)).status).toBe("in_review");
  });
});

describe("recording her verdict", () => {
  it("approve → version approved, basis round, items accepted/rejected per mark, decisions ruled with her name; stamps", async () => {
    const { book, f, d, r } = await sentWithAskedRows();
    const g = await item(P(), book._id.toString(), "needs_reviewer");
    // g was triaged after the round was built, so it is not asked on this copy.
    const s = await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "disagree", noteBn: "যেমন আছে থাক", scanPage: 1 }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: "খ", scanPage: 2 }]);
    const [pt] = await addReviewerPoints(OM(), r._id.toString(), { scanFileId: s.scanFileIds[0].toString(), items: [{ category: "fact", textBn: "তারিখটি মিলিয়ে নিন", scanPage: 2 }] });
    for (const row of [{ kind: "item" as const, id: f._id.toString() }, { kind: "decision" as const, id: d._id.toString() }, { kind: "point" as const, id: pt._id.toString() }]) {
      await checkAgainstScan(OM(), r._id.toString(), row);
    }
    const out = await recordReturn(P(), r._id.toString(), { verdict: "approve", returnedAt: new Date("2026-11-12T00:00:00Z"), reviewerNoteBn: "ভালো হয়েছে" });
    expect(out.status).toBe("returned");
    expect(out.recordedFromPaper).toBe(true);
    expect(out.recordedBy?.toString()).toBe(P().userId);
    const v = await loadVersion(r.versionId);
    expect(v.status).toBe("approved");
    expect(v.approvalBasis?.kind).toBe("round");
    expect(v.approvalBasis?.roundId?.equals(r._id)).toBe(true);
    expect(v.recordedFromPaper?.reviewerName).toBe("পর্যালোচক আপা (কাল্পনিক)");
    const fi = await BookFeedback.findById(f._id);
    expect(fi?.status).toBe("rejected");
    expect(fi?.reviewerRuling?.recordedFromPaper).toBe(true);
    expect(fi?.history.some((h) => h.note?.includes("কাগজের কপি থেকে লেখা"))).toBe(true);
    expect((await BookFeedback.findById(g._id))?.status).toBe("with_reviewer");
    const di = await BookDecision.findById(d._id);
    expect(di?.status).toBe("ruled");
    expect(di?.ruling?.by).toBe("পর্যালোচক আপা (কাল্পনিক)");
    expect(di?.ruling?.recordedBy?.toString()).toBe(P().userId);
    expect(di?.ruling?.recordedFromPaper).toBe(true);
  });

  it("a correction keeps the old values in the round's history", async () => {
    const { f, d, r } = await sentWithAskedRows();
    await addRoundScan(OM(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    await setItemMarks(OM(), r._id.toString(), [{ feedbackId: f._id.toString(), verdict: "agree" }]);
    await setDecisionMarks(OM(), r._id.toString(), [{ decisionId: d._id.toString(), optionKey: "ক" }]);
    await checkAgainstScan(OM(), r._id.toString(), { kind: "item", id: f._id.toString() });
    await checkAgainstScan(OM(), r._id.toString(), { kind: "decision", id: d._id.toString() });
    await recordReturn(P(), r._id.toString(), { verdict: "approve" });
    await expect(correctReturn(P(), r._id.toString(), { noteBn: "" })).rejects.toThrow(/কারণ/);
    const c = await correctReturn(P(), r._id.toString(), { decisionMarks: [{ decisionId: d._id.toString(), optionKey: "খ" }], noteBn: "স্ক্যানে খ টিক দেওয়া ছিল" });
    const corr = c.history.find((h) => h.action === "correction");
    expect((corr?.before as { decisionMarks: { optionKey: string }[] }).decisionMarks[0].optionKey).toBe("ক");
    expect((await BookDecision.findById(d._id))?.ruling?.optionKey).toBe("খ");
  });

  it("withdraw before the copy comes back → version draft", async () => {
    const { r } = await sentWithAskedRows();
    await withdrawRound(OM(), r._id.toString(), "ভুল সংস্করণ পাঠানো হয়েছিল");
    expect((await loadVersion(r.versionId)).status).toBe("draft");
    expect((await loadRound(r._id)).status).toBe("withdrawn");
  });

  it("the Principal as reviewer is stamped selfReviewed on round and version", async () => {
    const { book } = await importSample(P());
    const r = await roundSent(P(), book._id.toString(), { reviewerName: "প্রধান শিক্ষক (নিজে)", selfReview: true });
    await addRoundScan(P(), r._id.toString(), { name: "s.pdf", data: await scanPdf(), mime: "application/pdf" });
    await recordReturn(P(), r._id.toString(), { verdict: "approve" });
    expect((await loadRound(r._id)).selfReviewed).toBe(true);
    expect((await loadVersion(r.versionId)).selfReviewed).toBe(true);
  });
});
