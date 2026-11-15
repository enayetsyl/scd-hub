/**
 * BL-4 review fixes — the parts that need no MCP transport (D-#1629/#1630): scan-page allowance, the memo
 * Claude reads, the upload link's checks and the one hardened media reader. Invented text only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import express from "express";
import request from "supertest";
import JSZip from "jszip";
import mongoose, { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, roundSent, samplePdf, type LcFx } from "./bookLcFixtures";
import { filesRouter } from "../routes/files";
import { Student } from "../modules/foundation/models/Student";
import { Audit } from "../modules/platform/models/Audit";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { BookUploadToken, consumeUploadUrl, issueUploadUrl } from "../modules/book-lifecycle/services/uploadUrl";
import { openEditDraft } from "../modules/book-lifecycle/services/draftService";
import { loadDraft } from "../modules/book-lifecycle/services/versionService";
import { deidentifiedMemo } from "../modules/book-lifecycle/services/bundle";
import { loadRound } from "../modules/book-lifecycle/services/roundService";
import { scanPageImage, takeScanAllowance, BookScanDay } from "../modules/book-lifecycle/services/scanPages";
import { safeFileName } from "../modules/book-lifecycle/services/zipSafe";
import { BookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";

jest.setTimeout(120_000);
const app = express();
app.use("/files", filesRouter);

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
  await Student.create({ schoolId: "SCD-T-0902", name: "Kalpanik Shishu", nameBn: "কাল্পনিক শিশু", classId: new Types.ObjectId(), sectionId: new Types.ObjectId(), active: true } as never);
});
afterAll(async () => {
  await mongoose.connection.collection("students").deleteMany({ schoolId: "SCD-T-0902" });
  await teardownLc(fx);
});
beforeEach(async () => {
  await resetBooks();
  await BookUploadToken.deleteMany({});
  await BookScanDay.deleteMany({});
});
const P = () => fx.auth.principal;
const PNG = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n, n]);

describe("upload link", () => {
  it("a bad or missing token is refused (422) before any body is read; a body bigger than the declared size is refused and does not spend the link", async () => {
    const bad = await request(app).post("/files/book-lc/upload/not-a-real-token").attach("file", Buffer.alloc(5000), "x.png");
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/unknown, used or expired/);
    const { book } = await importSample(P());
    const d = await openEditDraft(P(), book._id.toString(), { source: "mcp", feedback: [] });
    const out = await issueUploadUrl(P(), { target: { draft_id: d._id.toString() }, role: "media", file_name: "p.png", bytes: 100 });
    const big = await request(app).post(out.path).attach("file", Buffer.alloc(5000, 1), "p.png");
    expect(big.status).toBe(422);
    expect(await BookUploadToken.countDocuments({ usedAt: { $exists: true } })).toBe(0);
  });

  it("edition only on an edition role; the name is sanitised; a closed draft gets no link", async () => {
    const { book } = await importSample(P());
    await expect(issueUploadUrl(P(), { target: { book: "C3-BAN", version: "v7.4" }, role: "master_pdf", edition: "TEACHER", file_name: "b.pdf", bytes: 100 })).rejects.toMatchObject({ code: "BAD_EDITION" });
    const d = await openEditDraft(P(), book._id.toString(), { source: "mcp", feedback: [] });
    await issueUploadUrl(P(), { target: { draft_id: d._id.toString() }, role: "media", file_name: "../../ev il/pic one.png", bytes: 6 });
    expect((await BookUploadToken.findOne({}).lean())!.fileName).toBe("pic_one.png");
    expect(safeFileName("../../x/..\\y z.png")).toBe("y_z.png");
    await BookEditDraft.updateOne({ _id: d._id }, { $set: { status: "rejected" } });
    await expect(issueUploadUrl(P(), { target: { draft_id: d._id.toString() }, role: "media", file_name: "p.png", bytes: 6 })).rejects.toMatchObject({ code: "DRAFT_CLOSED" });
  });

  it("a media zip is all-or-nothing: an SVG or a duplicate name → nothing attached; __MACOSX and dotfiles are skipped; ready goes back to open; the use is an event and an audit row", async () => {
    const { book } = await importSample(P());
    const mk = async (files: Record<string, Buffer | string>) => {
      const z = new JSZip();
      for (const [n, d] of Object.entries(files)) z.file(n, d);
      return z.generateAsync({ type: "nodebuffer" });
    };
    const prepare = async (zip: Buffer) => {
      const d = await openEditDraft(P(), book._id.toString(), { source: "mcp", feedback: [] });
      await BookEditDraft.updateOne({ _id: d._id }, { $set: { status: "ready" } });
      const out = await issueUploadUrl(P(), { target: { draft_id: d._id.toString() }, role: "media_zip", file_name: "m.zip", bytes: zip.length });
      return { d, run: () => consumeUploadUrl(out.path.split("/").pop()!, { name: "m.zip", data: zip }) };
    };
    const svg = await prepare(await mk({ "a.png": PNG(1), "evil.svg": "<svg onload=alert(1)/>" }));
    await expect(svg.run()).rejects.toMatchObject({ code: "BAD_MEDIA" });
    expect((await loadDraft(svg.d._id)).media).toHaveLength(0);
    const dup = await prepare(await mk({ "a/pic.png": PNG(2), "b/pic.png": PNG(3) }));
    await expect(dup.run()).rejects.toMatchObject({ code: "DUP_NAME" });
    const ok = await prepare(await mk({ "pic-a.png": PNG(4), "__MACOSX/._pic-a.png": "junk", ".hidden.png": PNG(5) }));
    await ok.run();
    const after = await loadDraft(ok.d._id);
    expect(after.media.map((m) => m.path)).toEqual(["media/pic-a.png"]);
    expect(after.status).toBe("open");
    expect(await BookEvent.countDocuments({ kind: "FILE_UPLOADED", origin: "claude", summary: /upload link used/ })).toBe(1);
    expect((await Audit.find({ eventKind: "BOOK_LC_UPLOAD_URL_ISSUED" }).lean()).some((a) => (a.meta as { action?: string })?.action === "used")).toBe(true);
  });
});

describe("what Claude reads of a round", () => {
  it("the memo has no reviewer / assigner names and leaves out an item that names a pupil (listed)", async () => {
    const { book } = await importSample(P());
    const id = book._id.toString();
    await item(P(), id, "needs_reviewer", { textBn: "বানান ঠিক করুন" });
    const named = await item(P(), id, "needs_reviewer", { textBn: "কাল্পনিক শিশু এখানে ভুল লিখেছে" });
    const r = await roundSent(P(), id, { reviewerName: "পর্যালোচক আপা (কাল্পনিক)" });
    const memo = await deidentifiedMemo(await loadRound(r._id));
    expect(memo.markdown).not.toContain("পর্যালোচক আপা");
    expect(memo.markdown).not.toContain("Head Teacher Test");
    expect(memo.markdown).not.toContain("কাল্পনিক শিশু");
    expect(memo.leftOut.map((x) => x.code)).toEqual([named.code]);
    expect(memo.items).toHaveLength(1);
  });
});

describe("scan pages", () => {
  it("the daily allowance is an atomic counter taken first", async () => {
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => takeScanAllowance(P().userId, 2)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(2);
    expect((await BookScanDay.findOne({ userId: P().userId }))!.count).toBe(2);
  });

  it("a PDF page leaves as a JPEG ≤ 1.5 MB (needs poppler); two renders for one user at once → the second is refused", async () => {
    let hasPoppler = true;
    try {
      await scanPageImage(await samplePdf(1, []), "application/pdf", 1);
    } catch {
      hasPoppler = false;
    }
    if (!hasPoppler) return; // no pdftoppm on this runner: the render path runs on the VM
    const pdf = await samplePdf(2, []);
    const [a, b] = await Promise.allSettled([scanPageImage(pdf, "application/pdf", 1, "user-x"), scanPageImage(pdf, "application/pdf", 2, "user-x")]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const ok = (a.status === "fulfilled" ? a : b) as PromiseFulfilledResult<{ mime: string; data: Buffer }>;
    expect(ok.value.mime).toBe("image/jpeg");
    expect(ok.value.data.length).toBeLessThanOrEqual(1_500_000);
  });
});
