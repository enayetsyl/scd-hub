/**
 * BL-1 — the generated memo, byte for byte (docs/prd-book-lifecycle.md §10.2, §19 bookLcMemo; D-#1595).
 * Part 1 = changes since the last RETURNED round (direct fixes listed FYI), pages from the page map,
 * codes and quotes; Part 2 items; Part 3 decisions with ☐ boxes; teacher items without names.
 * The expected text lives in fixtures/bookLcMemo.expected.md (invented content only).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { readFileSync } from "fs";
import * as path from "path";
import { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, attachMasterPdf, type LcFx } from "./bookLcFixtures";
import { openRound, detectPageMap, setPageMap, updateRound, makePacket, roundMemoMarkdown } from "../modules/book-lifecycle/services/roundService";
import { createFeedbackRow, openDecision, triageFeedback } from "../modules/book-lifecycle/services/feedbackService";
import { bookMemoMarkdown, buildMemoData } from "../modules/book-lifecycle/services/memo";
import { loadBook } from "../modules/book-lifecycle/services/store";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());

const P = () => fx.auth.principal;
const EXPECTED = path.join(__dirname, "fixtures", "bookLcMemo.expected.md");

async function scenario() {
  const { book } = await importSample(P());
  const r1 = await roundSent(P(), book._id.toString());
  await approveOnPaper(P(), r1._id.toString());
  const f1 = await item(P(), book._id.toString(), "direct_fix", { chapterKey: "ch-001", textBn: "সংখ্যা কথায় লিখুন" });
  await childVersion(P(), book._id.toString(), "1টি নৌকা", "একটি নৌকা", [f1.code]);
  const b = await loadBook(book._id);
  const teacherItem = await createFeedbackRow(
    b,
    { chapterKey: "ch-002", quote: "নদীর ধারে বসে 2টি নৌকা গুনল", page: "৭", category: "grammar", textBn: "‘গুনল’-এর বদলে ‘গুনে দেখল’ লিখলে ভালো হয়" },
    { source: "teacher", actor: new Types.ObjectId(fx.auth.teacher.userId), reporterId: new Types.ObjectId(fx.auth.teacher.userId) },
  );
  await triageFeedback(P(), [teacherItem._id.toString()], { kind: "route", route: "needs_reviewer" });
  await openDecision(P(), book._id.toString(), { questionBn: "অনুশীলনীর সংখ্যা অঙ্কে, না কথায়?", options: ["অঙ্কে", "কথায়"], recommendedIndex: 1 });
  const latest = (await loadBook(book._id)).latestVersionId!;
  await attachMasterPdf(P(), latest.toString(), 12);
  let r2 = await openRound(P(), book._id.toString(), { reviewerName: "পর্যালোচক আপা (কাল্পনিক)" });
  r2 = await detectPageMap(P(), r2._id.toString());
  r2 = await setPageMap(P(), r2._id.toString(), [
    { chapterKey: "ch-001", startPage: 3 },
    { chapterKey: "ch-002", startPage: 6 },
    { chapterKey: "ch-003", startPage: 9 },
  ]);
  r2 = await updateRound(P(), r2._id.toString(), { extraNotesBn: "ছুটির পরে ফেরত দিলেও চলবে।", wordingEdits: [{ code: teacherItem.code, textBn: "‘গুনল’-এর বদলে ‘গুনে দেখল’ — আপনার মত?" }] });
  return { r2, teacherItem };
}

it("generates the memo byte for byte from records", async () => {
  const { r2 } = await scenario();
  const data = await buildMemoData(r2, new Date("2026-11-13T06:00:00Z"));
  const md = bookMemoMarkdown(data);
  if (process.env.UPDATE_FIXTURES === "1") require("fs").writeFileSync(EXPECTED, md);
  expect(md).toBe(readFileSync(EXPECTED, "utf8"));
});

it("teacher items print without the teacher's name; direct fixes are FYI in Part 1", async () => {
  const { r2 } = await scenario();
  const md = await roundMemoMarkdown(r2);
  expect(md).toContain("শিক্ষকের মতামত");
  expect(md).not.toContain("Kalpanik Shikkhok");
  expect(md).toContain("সরাসরি সংশোধন — জানানোর জন্য");
  expect(md).toContain("(সম্পাদিত)");
});

it("freezes with the packet: later record changes no longer alter the memo", async () => {
  const { r2 } = await scenario();
  const frozen = await makePacket(P(), r2._id.toString(), "whole");
  await openDecision(P(), frozen.bookId.toString(), { questionBn: "নতুন প্রশ্ন", options: ["হ্যাঁ", "না"] });
  expect(await roundMemoMarkdown(frozen)).toBe(frozen.memo.markdown);
  expect(frozen.memo.markdown).not.toContain("নতুন প্রশ্ন");
});
