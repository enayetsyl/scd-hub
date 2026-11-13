/**
 * BL-1 — the version state machine (docs/prd-book-lifecycle.md §4.1–§4.3, §19 bookLcVersionMachine).
 * Every legal transition by the right action; every illegal one refused (incl. leaving `final`,
 * two open rounds, a non-latest base); number rules; immutability. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, attachMasterPdf, type LcFx } from "./bookLcFixtures";
import { approveDirectFix, markFinal, uploadVersionFile, uploadNewVersionDraft, acceptDraft, decideDraftChapter } from "../modules/book-lifecycle/services/versionService";
import { openRound, withdrawRound, recordReturn, addRoundScan, makePacket } from "../modules/book-lifecycle/services/roundService";
import { BookVersion, ImmutableVersionError } from "../modules/book-lifecycle/models/BookVersion";
import { assertMonotonic, loadVersion, loadBook, storedMaster } from "../modules/book-lifecycle/services/store";
import { BookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";
import { samplePdf } from "./bookLcFixtures";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const P = () => fx.auth.principal;

async function addEditions(versionId: string, editions = ["TEACHER", "STUDENT"] as const) {
  for (const e of editions) await uploadVersionFile(P(), versionId, { role: "edition", edition: e, name: `${e}.pdf`, data: await samplePdf(1, []), mime: "application/pdf" });
}

describe("legal transitions", () => {
  it("draft → in_review (packet + sent on paper) → draft (withdraw)", async () => {
    const { book } = await importSample(P());
    const r = await roundSent(P(), book._id.toString());
    expect((await loadVersion(r.versionId)).status).toBe("in_review");
    await withdrawRound(P(), r._id.toString());
    expect((await loadVersion(r.versionId)).status).toBe("draft");
  });

  it("in_review → approved (return recorded, basis round) → final (editions fresh)", async () => {
    const { book } = await importSample(P());
    const r = await roundSent(P(), book._id.toString());
    await approveOnPaper(P(), r._id.toString());
    let v = await loadVersion(r.versionId);
    expect(v.status).toBe("approved");
    expect(v.approvalBasis?.kind).toBe("round");
    await addEditions(v._id.toString());
    v = await markFinal(P(), v._id.toString());
    expect(v.status).toBe("final");
    expect((await loadBook(book._id)).finalVersionId?.equals(v._id)).toBe(true);
  });

  it("in_review → changes_requested (terminal; the next version is its child)", async () => {
    const { book } = await importSample(P());
    const r = await roundSent(P(), book._id.toString());
    await addRoundScan(P(), r._id.toString(), { name: "scan.pdf", data: await samplePdf(1, []), mime: "application/pdf" });
    await recordReturn(P(), r._id.toString(), { verdict: "changes" });
    const v = await loadVersion(r.versionId);
    expect(v.status).toBe("changes_requested");
    await expect(withdrawRound(P(), r._id.toString())).rejects.toThrow();
    await expect(approveDirectFix(P(), v._id.toString())).rejects.toThrow(/খসড়া/);
    const f = await item(P(), book._id.toString(), "direct_fix");
    const child = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
    expect(child.parentVersionId?.equals(v._id)).toBe(true);
    expect(child.status).toBe("draft");
  });

  it("draft → approved by the direct-fix path, stamped reviewSkipped, basis inherited", async () => {
    const { book } = await importSample(P(), { state: "final" });
    const f = await item(P(), book._id.toString(), "direct_fix");
    const child = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
    const v = await approveDirectFix(P(), child._id.toString());
    expect(v.status).toBe("approved");
    expect(v.reviewSkipped?.by).toBeDefined();
    expect(v.approvalBasis?.kind).toBe("inherited");
  });
});

describe("illegal transitions", () => {
  it("cannot mark a draft final, or leave final backwards", async () => {
    const { book, version } = await importSample(P(), { state: "final" });
    await expect(markFinal(P(), version._id.toString())).rejects.toThrow(/অনুমোদিত/);
    await expect(approveDirectFix(P(), version._id.toString())).rejects.toThrow(/খসড়া/);
    await expect(openRound(P(), book._id.toString(), { reviewerName: "ক" })).rejects.toThrow(/খসড়া/);
    const { version: d } = await importSample(P(), { code: "C3-ENG", state: "draft" });
    await expect(markFinal(P(), d._id.toString())).rejects.toThrow(/অনুমোদিত/);
  });

  it("refuses two open rounds on a book and a recorded return on a round not out on paper", async () => {
    const { book } = await importSample(P());
    const r = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক" });
    await expect(openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক" })).rejects.toThrow(/আগেই খোলা/);
    await expect(recordReturn(P(), r._id.toString(), { verdict: "approve" })).rejects.toThrow(/কাগজে পাঠানো/);
  });

  it("refuses a packet without a fresh master PDF", async () => {
    const { book } = await importSample(P());
    const r = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক" });
    await expect(makePacket(P(), r._id.toString(), "whole")).rejects.toThrow(/PDF নেই/);
  });

  it("a draft on a base that is no longer latest is stale (VR-1) and cannot be accepted", async () => {
    const { book, version } = await importSample(P());
    const master = await storedMaster(version);
    const d1 = await uploadNewVersionDraft(P(), book._id.toString(), { masterMd: Buffer.from(master.replace("1টি নৌকা", "এক নৌকা")) });
    const f = await item(P(), book._id.toString(), "direct_fix");
    await childVersion(P(), book._id.toString(), "2টি নৌকা", "দুই নৌকা", [f.code]);
    await expect(decideDraftChapter(P(), d1._id.toString(), "ch-001", true)).rejects.toThrow(/VR-1/);
    expect((await BookEditDraft.findById(d1._id))?.status).toBe("stale");
    await expect(acceptDraft(P(), d1._id.toString(), { summaryBn: "x" })).rejects.toThrow();
  });
});

describe("version numbers", () => {
  it("minor = parent.minor + 1; major = parent.major + 1 with minor 0; import may start at v7.4", async () => {
    const { book, version } = await importSample(P());
    expect([version.major, version.minor]).toEqual([7, 4]);
    const f = await item(P(), book._id.toString(), "direct_fix");
    const a = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
    expect([a.major, a.minor]).toEqual([7, 5]);
    const g = await item(P(), book._id.toString(), "direct_fix");
    const b = await childVersion(P(), book._id.toString(), "2টি নৌকা", "দুটি নৌকা", [g.code], { bump: "major" });
    expect([b.major, b.minor]).toEqual([8, 0]);
    await expect(assertMonotonic(book._id, { major: 7, minor: 9 })).rejects.toThrow(/বড়/);
  });
});

describe("immutability", () => {
  it("a write to a created version's text throws", async () => {
    const { version } = await importSample(P());
    await expect(BookVersion.updateOne({ _id: version._id }, { $set: { masterHash: "x" } })).rejects.toBeInstanceOf(ImmutableVersionError);
    await expect(BookVersion.updateOne({ _id: version._id }, { $set: { "chapters.0.textSha256": "x" } })).rejects.toBeInstanceOf(ImmutableVersionError);
    const doc = await BookVersion.findById(version._id);
    doc!.changes = [{ chapterKey: "ch-001", where: "", beforeExcerpt: "", afterExcerpt: "", reason: "", refs: ["F-1"], route: "direct_fix" }];
    await expect(doc!.save()).rejects.toBeInstanceOf(ImmutableVersionError);
    // files may still be added before final
    await attachMasterPdf(P(), version._id.toString());
    expect((await loadVersion(version._id)).files.some((f) => f.role === "master_pdf")).toBe(true);
  });
});
