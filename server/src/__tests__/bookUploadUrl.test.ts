/**
 * BL-4 — single-use upload links (docs/prd-book-lifecycle.md §15.3, §19 bookUploadUrl; D-#1604).
 * Issued to `manage` only, stored hashed, 10 minutes, bound to the target, role and byte size (±1 %),
 * spent once; the POST carries no session (the token is the credential) and the user is re-read.
 * Invented files only.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import express from "express";
import request from "supertest";
import { setupLc, teardownLc, resetBooks, importSample, samplePdf, type LcFx } from "./bookLcFixtures";
import { filesRouter } from "../routes/files";
import { User } from "../modules/foundation/models/User";
import { Audit } from "../modules/platform/models/Audit";
import { BookUploadToken, issueUploadUrl, UPLOAD_TTL_MS } from "../modules/book-lifecycle/services/uploadUrl";
import { loadVersion } from "../modules/book-lifecycle/services/store";
import { ForbiddenError } from "../middleware/authz";
import { StoredFile } from "../modules/platform/models/StoredFile";

jest.setTimeout(120_000);
const app = express();
app.use("/files", filesRouter);

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => {
  await resetBooks();
  await BookUploadToken.deleteMany({});
  await User.updateOne({ _id: fx.ids.principal }, { $set: { revokedPermissions: [] } });
});
const P = () => fx.auth.principal;

it("issue needs manage; the token is stored hashed with a 10-minute expiry and audited", async () => {
  await importSample(P());
  await expect(issueUploadUrl(fx.auth.teacher, { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: 1000 })).rejects.toBeInstanceOf(ForbiddenError);
  const out = await issueUploadUrl(P(), { target: { book: "C3-BAN", version: "v7.4" }, role: "master_pdf", file_name: "b.pdf", bytes: 1000 }, "https://hub.test");
  expect(out.url).toMatch(/^https:\/\/hub\.test\/files\/book-lc\/upload\/[A-Za-z0-9_-]{40,}$/);
  const token = out.path.split("/").pop()!;
  const row = await BookUploadToken.findOne({}).lean();
  expect(row!.tokenHash).not.toBe(token);
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(UPLOAD_TTL_MS);
  expect(await Audit.countDocuments({ eventKind: "BOOK_LC_UPLOAD_URL_ISSUED" })).toBe(1);
  await expect(issueUploadUrl(P(), { target: { book: "C3-BAN" }, role: "media", file_name: "x.png", bytes: 10 })).rejects.toThrow(/version takes/);
});

it("a master PDF arrives once over the link (no session); a second use, a wrong size, an expired link are refused", async () => {
  const { version } = await importSample(P());
  const pdf = await samplePdf(2, []);
  const wrong = await issueUploadUrl(P(), { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: pdf.length * 2 });
  const w = await request(app).post(wrong.path).attach("file", pdf, "b.pdf");
  expect(w.status).toBe(422);
  expect(w.body.error).toMatch(/±1%/);
  // the size refusal still spent the token
  expect((await request(app).post(wrong.path).attach("file", pdf, "b.pdf")).status).toBe(422);

  const ok = await issueUploadUrl(P(), { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: pdf.length });
  const r = await request(app).post(ok.path).attach("file", pdf, "b.pdf");
  expect(r.status).toBe(200);
  expect(r.body.kind).toBe("book_lc_master");
  expect((await StoredFile.findById(r.body.storedFileId).lean())?.kind).toBe("book_lc_master");
  const v = await loadVersion(version._id);
  expect(v.files.some((f) => f.role === "master_pdf" && f.storedFileId.toString() === r.body.storedFileId)).toBe(true);
  expect((await request(app).post(ok.path).attach("file", pdf, "b.pdf")).status).toBe(422);

  const old = await issueUploadUrl(P(), { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: pdf.length });
  await BookUploadToken.updateOne({ usedAt: { $exists: false } }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await request(app).post(old.path).attach("file", pdf, "b.pdf")).status).toBe(422);
});

it("the user is re-read at upload: a revoked manage refuses the link", async () => {
  await importSample(P());
  const pdf = await samplePdf(1, []);
  const out = await issueUploadUrl(P(), { target: { book: "C3-BAN" }, role: "master_pdf", file_name: "b.pdf", bytes: pdf.length });
  await User.updateOne({ _id: fx.ids.principal }, { $set: { revokedPermissions: ["book_lifecycle:manage"] } });
  const r = await request(app).post(out.path).attach("file", pdf, "b.pdf");
  expect(r.status).toBe(403);
});

it("media for a draft: a media_zip lands as content-addressed assets on the draft", async () => {
  const { book } = await importSample(P());
  const { openEditDraft } = await import("../modules/book-lifecycle/services/draftService");
  const d = await openEditDraft(P(), book._id.toString(), { source: "mcp", feedback: [] });
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  z.file("media/pic-a.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]));
  z.file("media/pic-b.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 3, 4]));
  const zip = await z.generateAsync({ type: "nodebuffer" });
  const out = await issueUploadUrl(P(), { target: { draft_id: d._id.toString() }, role: "media_zip", file_name: "m.zip", bytes: zip.length });
  const r = await request(app).post(out.path).attach("file", zip, "m.zip");
  expect(r.status).toBe(200);
  const { loadDraft } = await import("../modules/book-lifecycle/services/versionService");
  expect((await loadDraft(d._id)).media.map((m) => m.path).sort()).toEqual(["media/pic-a.png", "media/pic-b.png"]);
});
