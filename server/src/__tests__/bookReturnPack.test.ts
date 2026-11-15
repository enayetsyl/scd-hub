/**
 * BL-3 — the return-transcription pack (docs/prd-book-lifecycle.md §15.4, §19 bookReturnPack; owner Q1).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import JSZip from "jszip";
import { setupLc, teardownLc, resetBooks, importSample, item, roundSent, samplePdf, type LcFx } from "./bookLcFixtures";
import { downloadTranscriptionPack, uploadTranscriptionResult } from "../modules/book-lifecycle/services/bundle";
import { addRoundScan, loadRound } from "../modules/book-lifecycle/services/roundService";
import { openDecision } from "../modules/book-lifecycle/services/feedbackService";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import { loadVersion } from "../modules/book-lifecycle/services/store";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

async function packRound() {
  const { book } = await importSample(P());
  const f = await item(P(), book._id.toString(), "needs_reviewer");
  const d = await openDecision(P(), book._id.toString(), { questionBn: "কোনটি?", options: ["এক", "দুই"] });
  const r = await roundSent(P(), book._id.toString());
  const s = await addRoundScan(fx.auth.officeManage, r._id.toString(), { name: "ফেরত.pdf", data: await samplePdf(2, []), mime: "application/pdf" });
  return { book, f, d, r: s };
}

it("the pack holds the round's memo, codes, page map and scans", async () => {
  const { r, f, d } = await packRound();
  const p = await downloadTranscriptionPack(fx.auth.officeManage, r._id.toString());
  const z = await JSZip.loadAsync(p.zip);
  const names = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
  expect(names).toEqual(["OUTPUT.md", "README.md", "codes.json", "memo.md", "pagemap.json", "scans/01_ফেরত.pdf"].sort());
  const codes = JSON.parse(await z.file("codes.json")!.async("string"));
  expect(codes.items.map((x: { code: string }) => x.code)).toEqual([f.code]);
  expect(codes.decisions.map((x: { code: string }) => x.code)).toEqual([d.code]);
  expect(await z.file("memo.md")!.async("string")).toBe(r.memo.markdown);
  expect(JSON.parse(await z.file("pagemap.json")!.async("string")).length).toBe(3);
});

it("an upload creates UNCHECKED rows (via bundle, scan evidence); wrong round or nonce refused; never a verdict", async () => {
  const { r, f, d } = await packRound();
  const p = await downloadTranscriptionPack(fx.auth.officeManage, r._id.toString());
  const answer = {
    schema: "book-feedback-items/v1",
    round: r._id.toString(),
    nonce: p.nonce,
    items: [{ chapter_key: "ch-002", page: "৭", category: "spelling", text_bn: "বানান দেখুন", scan_page: 2 }],
    item_marks: [{ feedback_code: f.code, verdict: "agree", scan_page: 1 }],
    decision_marks: [{ decision_code: d.code, option_key: "খ", scan_page: 1 }],
  };
  await expect(uploadTranscriptionResult(fx.auth.officeManage, r._id.toString(), JSON.stringify({ ...answer, nonce: "x".repeat(24) }))).rejects.toThrow(/অন্য/);
  await expect(uploadTranscriptionResult(fx.auth.officeManage, r._id.toString(), JSON.stringify({ ...answer, round: "000000000000000000000000" }))).rejects.toThrow(/অন্য/);
  const out = await uploadTranscriptionResult(fx.auth.officeManage, r._id.toString(), "```json\n" + JSON.stringify(answer) + "\n```");
  const point = await BookFeedback.findOne({ code: out.created[0] });
  expect(point?.source).toBe("reviewer");
  expect(point?.evidence?.via).toBe("bundle");
  expect(point?.evidence?.scanFileId?.equals(r.scanFileIds[0])).toBe(true);
  expect(point?.evidence?.checkedAgainstScan?.at).toBeUndefined();
  const round = await loadRound(r._id);
  expect(round.itemMarks[0]).toMatchObject({ via: "bundle", verdict: "agree" });
  expect(round.itemMarks[0].checkedAgainstScan?.at).toBeUndefined();
  expect(round.decisionMarks[0].optionKey).toBe("খ");
  expect(round.verdict).toBeUndefined();
  expect(round.status).toBe("sent_on_paper");
  expect((await loadVersion(r.versionId)).status).toBe("in_review");
});
