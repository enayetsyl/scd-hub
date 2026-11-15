/**
 * BL-3 — the bundle zip (docs/prd-book-lifecycle.md §15.4, §19 bookBundle; D-#1605/#1606).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { readFileSync } from "fs";
import * as path from "path";
import JSZip from "jszip";
import mongoose, { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, type LcFx } from "./bookLcFixtures";
import { downloadBundle, uploadBundleResult, uploadBundleWhole, NAME_LEFT_OUT_BN } from "../modules/book-lifecycle/services/bundle";
import { loadDraft } from "../modules/book-lifecycle/services/versionService";
import { loadVersion, storedMaster } from "../modules/book-lifecycle/services/store";
import { Student } from "../modules/foundation/models/Student";
import { Audit } from "../modules/platform/models/Audit";
import { BookEvent } from "../modules/support-book/models/BookEvent";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
  // An invented roster name the de-identification must catch.
  await Student.create({ schoolId: "SCD-T-0901", name: "Kalpanik Shishu", nameBn: "কাল্পনিক শিশু", classId: new Types.ObjectId(), sectionId: new Types.ObjectId(), active: true });
});
afterAll(async () => {
  await mongoose.connection.collection("students").deleteMany({ schoolId: "SCD-T-0901" });
  await teardownLc(fx);
});
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

async function files(zip: Buffer): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(zip);
  const out: Record<string, string> = {};
  for (const f of Object.values(z.files)) if (!f.dir) out[f.name] = await f.async("string");
  return out;
}

it("zip contents and names; METHOD.md byte-identical; feedback de-identified (a roster name excludes the item, named); download audited", async () => {
  const { book, version } = await importSample(P());
  const id = book._id.toString();
  const ok = await item(P(), id, "direct_fix", { textBn: "বানান ঠিক করুন" });
  const named = await item(P(), id, "direct_fix", { textBn: "কাল্পনিক শিশু বলেছে এটি ভুল" });
  const b = await downloadBundle(P(), id, { feedback: [ok.code, named.code], instructions: [{ text: "সংখ্যা কথায় লিখুন" }] });
  expect(b.filename).toBe(`book-bundle_C3-BAN_v7.4_${b.nonce}.zip`);
  const f = await files(b.zip);
  expect(Object.keys(f).sort()).toEqual(["METHOD.md", "OUTPUT.md", "README.md", "book/master.md", "book/outline.json", "decisions.md", "feedback.json"]);
  expect(f["METHOD.md"]).toBe(readFileSync(path.resolve(__dirname, "../../assets/book-lifecycle/edit_method_v1.md"), "utf8"));
  expect(f["book/master.md"]).toBe(await storedMaster(version));
  expect(f["README.md"]).toContain("এই ফাইলের METHOD অনুসরণ করুন; শুধু book-edit-result JSON দিন।");
  const fb = JSON.parse(f["feedback.json"]);
  expect(fb.items.map((x: { code: string }) => x.code)).toEqual([ok.code]);
  expect(fb.leftOut).toEqual([{ code: named.code, reasonBn: NAME_LEFT_OUT_BN }]);
  expect(f["feedback.json"]).not.toContain("কাল্পনিক শিশু");
  expect(fb.instructions[0].code).toBe("I-1");
  expect(b.excluded.map((x) => x.code)).toEqual([named.code]);
  expect(await Audit.countDocuments({ eventKind: "BOOK_LC_BUNDLE_DOWNLOADED" })).toBe(1);
  expect(await BookEvent.countDocuments({ kind: "BUNDLE_DOWNLOADED", bookId: id })).toBe(1);
  expect((await loadDraft(b.draftId)).bundleNonce).toBe(b.nonce);
});

it("a result JSON in a fenced .md block is accepted; nonce, base and method mismatches are refused", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const f = await item(P(), id, "direct_fix");
  const b = await downloadBundle(P(), id, { feedback: [f.code] });
  const outline = JSON.parse((await files(b.zip))["book/outline.json"]);
  const ch1 = outline.chapters.find((c: { key: string }) => c.key === "ch-001");
  const result = { schema: "book-edit-result/v1", bundle: b.nonce, baseMasterHash: outline.baseMasterHash, methodVersion: "v1", chapters: [{ schema: "book-chapter-edit/v1", draft: b.nonce, chapter: "ch-001", baseSha: ch1.sha256, ops: [{ op: "replace", before: "1টি নৌকা", after: "একটি নৌকা", refs: [f.code], reasonBn: "কথায়" }] }] };
  const md = `এখানে ফলাফল:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
  const up = await uploadBundleResult(P(), id, md);
  expect(up.chapters).toEqual([{ key: "ch-001", status: "edited", blocking: 0 }]);
  await expect(uploadBundleResult(P(), id, JSON.stringify({ ...result, bundle: "0".repeat(24) }))).rejects.toThrow(/বান্ডেল/);
  await expect(uploadBundleResult(P(), id, JSON.stringify({ ...result, baseMasterHash: "c".repeat(64) }))).rejects.toThrow(/VR-1/);
  await expect(uploadBundleResult(P(), id, JSON.stringify({ ...result, methodVersion: "v9" }))).rejects.toThrow(/VR-2/);
});

it("the whole master.md + changes.json path lands in the same draft", async () => {
  const { book, version } = await importSample(P());
  const id = book._id.toString();
  const f = await item(P(), id, "direct_fix");
  const b = await downloadBundle(P(), id, { feedback: [f.code] });
  const master = (await storedMaster(await loadVersion(version._id))).replace("2টি নৌকা", "দুটি নৌকা");
  const res = await uploadBundleWhole(P(), id, { nonce: b.nonce, master: Buffer.from(master), changesJson: JSON.stringify([{ chapterKey: "ch-002", beforeExcerpt: "2টি নৌকা", afterExcerpt: "দুটি নৌকা", refs: [f.code] }]) });
  expect(res.chapters).toEqual([{ key: "ch-002", status: "edited", unexplained: 0 }]);
});
