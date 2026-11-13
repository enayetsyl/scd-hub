/**
 * BL-1 — feedback triage, direct-fix approve (docs/prd-book-lifecycle.md §5.6, §9.2, §4.3, §19 bookLcFeedback).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, roundSent, approveOnPaper, attachMasterPdf, type LcFx } from "./bookLcFixtures";
import { createFeedbackRow, fileFeedback, triageFeedback } from "../modules/book-lifecycle/services/feedbackService";
import { approveDirectFix } from "../modules/book-lifecycle/services/versionService";
import { openRound, roundMemoMarkdown } from "../modules/book-lifecycle/services/roundService";
import { BookFeedback } from "../modules/book-lifecycle/models/BookFeedback";
import { loadBook, loadVersion } from "../modules/book-lifecycle/services/store";
import { Notification } from "../modules/notifications/models/Notification";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;

async function teacherItem(bookId: string, category = "spelling") {
  const b = await loadBook(bookId);
  const tid = new Types.ObjectId(fx.auth.teacher.userId);
  return createFeedbackRow(b, { category: category as never, textBn: "বানান ভুল মনে হচ্ছে", chapterKey: "ch-001" }, { source: "teacher", actor: tid, reporterId: tid });
}

it("routes move the status: needs_reviewer → with_reviewer; direct_fix / verbal_errata → accepted", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  expect((await item(P(), id, "needs_reviewer")).status).toBe("with_reviewer");
  expect((await item(P(), id, "direct_fix")).status).toBe("accepted");
  // No printed release yet → a verbal erratum would be lost: refused with a plain reason.
  await expect(item(P(), id, "verbal_errata")).rejects.toMatchObject({ code: "NO_RELEASE" });
  const f = await fileFeedback(P(), id, "proof_read", { category: "layout", textBn: "লাইন ভাঙা" });
  expect(f.status).toBe("open");
  expect(f.code).toBe("F-4");
  await triageFeedback(P(), [f._id.toString()], { kind: "route", route: "direct_fix" });
  await expect(triageFeedback(P(), [f._id.toString()], { kind: "route", route: "direct_fix" })).rejects.toThrow(/আগেই/);
});

it("a reject reason reaches the reporter; a duplicate links to the original", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const t = await teacherItem(id);
  await expect(triageFeedback(P(), [t._id.toString()], { kind: "reject", reasonBn: " " })).rejects.toThrow(/কারণ/);
  await triageFeedback(P(), [t._id.toString()], { kind: "reject", reasonBn: "বানানটি ঠিকই আছে (অভিধান দেখুন)" });
  const n = await Notification.findOne({ kind: "BOOK_FEEDBACK_ANSWERED", recipientUserId: fx.auth.teacher.userId });
  expect(n?.bodyBn).toContain("বানানটি ঠিকই আছে");
  const t2 = await teacherItem(id);
  const t3 = await teacherItem(id);
  await triageFeedback(P(), [t3._id.toString()], { kind: "duplicate", ofCode: t2.code });
  const dup = await BookFeedback.findById(t3._id);
  expect(dup?.status).toBe("duplicate");
  expect(dup?.duplicateOf?.equals(t2._id)).toBe(true);
  // A teacher report tells the managers (one per book per day).
  expect(await Notification.countDocuments({ kind: "BOOK_FEEDBACK_FILED", recipientUserId: P().userId })).toBe(1);
});

it("sacred_text can never be a direct fix", async () => {
  const { book } = await importSample(P());
  const f = await fileFeedback(P(), book._id.toString(), "school", { category: "sacred_text", textBn: "আয়াতের অনুবাদ মিলিয়ে নিন" });
  await expect(triageFeedback(P(), [f._id.toString()], { kind: "route", route: "direct_fix" })).rejects.toThrow(/VR-12/);
});

it("direct-fix approve only when every change cites direct_fix / verbal_errata items; listed FYI in the next memo", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const r1 = await roundSent(P(), id);
  await approveOnPaper(P(), r1._id.toString());
  const needs = await item(P(), id, "needs_reviewer");
  const v1 = await childVersion(P(), id, "1টি নৌকা", "একটি নৌকা", [needs.code]);
  await expect(approveDirectFix(P(), v1._id.toString())).rejects.toThrow(/সরাসরি সংশোধন নয়/);
  // A new child (v1 stays a draft; its child is latest) whose only change cites a direct fix.
  const fix = await item(P(), id, "direct_fix");
  const errata = await item(P(), id, "direct_fix", { chapterKey: "ch-003" });
  const v2 = await childVersion(P(), id, "2টি নৌকা", "দুটি নৌকা", [fix.code, errata.code]);
  const ok = await approveDirectFix(P(), v2._id.toString());
  expect(ok.status).toBe("approved");
  expect(ok.reviewSkipped?.at).toBeInstanceOf(Date);
  expect((await BookFeedback.findById(fix._id))?.status).toBe("applied");
  expect((await BookFeedback.findById(fix._id))?.appliedInVersionId?.equals(v2._id)).toBe(true);
  // The reviewer still sees it: the next memo lists it FYI (Q4).
  const v3 = await childVersion(P(), id, "3টি নৌকা", "তিনটি নৌকা", [(await item(P(), id, "needs_reviewer")).code]);
  await attachMasterPdf(P(), v3._id.toString());
  const r2 = await openRound(P(), id, { reviewerName: "পর্যালোচক" });
  const md = await roundMemoMarkdown(r2);
  expect(md).toContain(fix.code);
  expect(md).toContain("সরাসরি সংশোধন — জানানোর জন্য");
  expect((await loadVersion(v3._id)).status).toBe("draft");
});
