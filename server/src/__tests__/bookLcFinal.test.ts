/**
 * BL-2 — mark final (docs/prd-book-lifecycle.md §4.1, §11.1, §19 bookLcFinal; D-#1599, D-#1615).
 * Final needs an approval basis, every required edition present and fresh, no open needs_reviewer
 * item on the version, and a finalize holder. No override.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, samplePdf, type LcFx } from "./bookLcFixtures";
import { approveDirectFix, markFinal, uploadVersionFile } from "../modules/book-lifecycle/services/versionService";
import { loadVersion } from "../modules/book-lifecycle/services/store";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import { ForbiddenError } from "../middleware/authz";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;
const edition = async (versionId: string, e: "TEACHER" | "STUDENT", format: "pdf" | "docx" = "pdf") =>
  uploadVersionFile(P(), versionId, { role: "edition", edition: e, name: `${e}.${format}`, data: format === "pdf" ? await samplePdf(1, []) : Buffer.from("PK docx fixture"), mime: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

async function approvedOnPaper() {
  const { book } = await importSample(P());
  const r = await roundSent(P(), book._id.toString());
  await approveOnPaper(P(), r._id.toString());
  return { book, versionId: r.versionId.toString() };
}

it("refused while an edition is missing, refused to a non-finalize holder, then final", async () => {
  const { versionId } = await approvedOnPaper();
  await edition(versionId, "TEACHER");
  await expect(markFinal(P(), versionId)).rejects.toThrow(/শিক্ষার্থী সংস্করণ তোলা হয়নি/);
  await edition(versionId, "STUDENT");
  await expect(markFinal(fx.auth.officeManage, versionId)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(markFinal(fx.auth.officeFinalizeGrant, versionId)).rejects.toBeInstanceOf(ForbiddenError);
  expect((await markFinal(P(), versionId)).status).toBe("final");
});

it("refused while an open needs_reviewer item targets the version", async () => {
  const { book, versionId } = await approvedOnPaper();
  await edition(versionId, "TEACHER");
  await edition(versionId, "STUDENT");
  const f = await item(P(), book._id.toString(), "needs_reviewer");
  await BookFeedback.updateOne({ _id: f._id }, { $set: { versionId } });
  await expect(markFinal(P(), versionId)).rejects.toThrow(/খোলা/);
});

it("carried parent editions show stale; final refused until re-uploaded", async () => {
  const { book, versionId } = await approvedOnPaper();
  await edition(versionId, "TEACHER");
  await edition(versionId, "STUDENT");
  await markFinal(P(), versionId);
  const f = await item(P(), book._id.toString(), "direct_fix");
  const child = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
  const carried = child.files.filter((x) => x.role === "edition");
  expect(carried).toHaveLength(2);
  expect(carried.every((x) => x.fromMasterHash !== child.masterHash)).toBe(true);
  await approveDirectFix(P(), child._id.toString());
  await expect(markFinal(P(), child._id.toString())).rejects.toThrow(/পুরোনো/);
  await edition(child._id.toString(), "TEACHER");
  await edition(child._id.toString(), "STUDENT");
  const v = await loadVersion(child._id);
  expect(v.files.filter((x) => x.role === "edition").every((x) => x.fromMasterHash === v.masterHash)).toBe(true);
  // a direct-fix child of a paper-approved version inherits the basis and may go final
  expect(v.approvalBasis?.kind).toBe("inherited");
  expect((await markFinal(P(), child._id.toString())).status).toBe("final");
});

it("a direct-fix child of a never-approved version has no basis and cannot go final", async () => {
  const { book } = await importSample(P());
  const f = await item(P(), book._id.toString(), "direct_fix");
  const child = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
  const v = await approveDirectFix(P(), child._id.toString());
  expect(v.status).toBe("approved");
  expect(v.approvalBasis?.kind).toBeUndefined();
  await edition(v._id.toString(), "TEACHER");
  await edition(v._id.toString(), "STUDENT");
  await expect(markFinal(P(), v._id.toString())).rejects.toThrow(/অনুমোদন লিপিবদ্ধ হয়নি/);
});

it("an imported approved version has basis `imported` and can go final with fresh editions", async () => {
  const { version } = await importSample(P(), { state: "approved" });
  expect(version.approvalBasis?.kind).toBe("imported");
  await edition(version._id.toString(), "TEACHER");
  await edition(version._id.toString(), "STUDENT");
  expect((await markFinal(P(), version._id.toString())).status).toBe("final");
});

it("every file of an edition must be fresh (a stale carried PDF beside a new DOCX is still stale)", async () => {
  const { book, versionId } = await approvedOnPaper();
  await edition(versionId, "TEACHER");
  await edition(versionId, "STUDENT");
  await markFinal(P(), versionId);
  const f = await item(P(), book._id.toString(), "direct_fix");
  const child = await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f.code]);
  await approveDirectFix(P(), child._id.toString());
  await edition(child._id.toString(), "TEACHER", "docx");
  await edition(child._id.toString(), "STUDENT");
  await expect(markFinal(P(), child._id.toString())).rejects.toThrow(/শিক্ষক সংস্করণ পুরোনো/);
});
