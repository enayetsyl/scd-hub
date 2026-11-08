/**
 * Capture spec — প্রশ্নপত্র ভান্ডার (exam_papers, D-#1030–#1034): the Office uploads and reads a
 * Mohammadpur paper; the reviewer checks a draft paper item by item; the Principal assigns the
 * reviewer and decides a suggestion.
 *
 * LOCAL ONLY: it uploads while it walks. Data: fixtures/exam-papers.ts (run it with --reset
 * first). Run the server as scripts/help/fake-drive-server.ts (the upload goes to Drive and the
 * page images come back from it). The sample PDF: HELP_EP_PDF=<a paper PDF> (default: the
 * Mohammadpur Final 2025 Class 1 Bangla paper in the owner's Downloads).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("./exam-lib.cjs");

const SY = "পরীক্ষার সিলেবাস";
const PDF =
  process.env.HELP_EP_PDF ||
  "C:/Users/HP/Downloads/Mohammadpur Materials/Mohammadpur Final Question 2025/Class 1/One_Bangla_Final_2025.pdf";

async function office(h) {
  const O = await L.login(h, "office@help.test");
  await L.menuShots(h, O, ["exam-ep-reference"], SY, "মোহাম্মদপুরের প্রশ্নপত্র");

  // Upload (the card on top of the shelf).
  await h.shot(O, "exam-ep-reference-upload", 0, [{ text: "সাল" }, { text: "পরীক্ষা" }, { text: "শ্রেণি" }, { text: "PDF বাছাই করে আপলোড করুন" }], {
    anchor: { text: "মোহাম্মদপুরের প্রশ্নপত্র আপলোড" },
  });
  await L.fillAfter(O, "সাল", "2025");
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "help-ep-")), "paper.pdf");
  fs.copyFileSync(PDF, copy);
  await L.chooseFiles(h, O, "PDF বাছাই করে আপলোড করুন", [copy], 4000);
  // The shelf polls every 5 s until the pages are made.
  await O.waitForTimeout(15000);

  await O.evaluate(() => window.scrollTo(0, 0));
  await h.shot(O, "exam-ep-reference", 1, [{ text: "বার্ষিক" }, { text: "শ্রেণি ১ · বাংলা" }], { anchor: { text: "বার্ষিক" } });
  await h.shot(O, "exam-ep-reference-upload", 1, [{ text: "মুছুন" }]);

  await h.tap(O, "শ্রেণি ১ · বাংলা", 6000);
  await h.shot(O, "exam-ep-reference", 2, [{ text: "মূল ফাইল খুলুন" }, { text: "＋" }]);
  await O.context().close();
}

async function reviewer(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.menuShots(h, T, ["exam-ep-review"], SY, "প্রশ্নপত্র রিভিউ");
  await h.shot(T, "exam-ep-review", 1, [{ text: "শ্রেণি ৩ · বাংলা" }]);
  await h.tap(T, "শ্রেণি ৩ · বাংলা", 4500);
  await h.shot(T, "exam-ep-review", 2, [
    { text: "✓ সিলেবাসের সাথে মিলেছে" },
    { text: "সম্পাদনার প্রস্তাব" },
    { text: "মুছে ফেলার প্রস্তাব" },
    { text: "নতুন প্রশ্নের প্রস্তাব" },
  ]);
  await h.shot(T, "exam-ep-review", 3, [{ text: "রিভিউ শেষ — জমা দিন" }]);
  await T.context().close();
}

async function principal(h) {
  const P = await L.login(h, "principal@help.test");
  await L.go(h, P, SY, "প্রশ্নপত্র রিভিউ");
  await h.shot(P, "exam-ep-manage", 0, [{ text: "রিভিউয়ার বাছাই করুন" }, { text: "তালিকার সব বাছাই" }, { re: "প্রশ্নপত্রে বরাদ্দ করুন$" }], {
    anchor: { text: "রিভিউয়ার বরাদ্দ" },
  });
  await h.tap(P, "শ্রেণি ৩ · বাংলা", 4500);
  await h.shot(P, "exam-ep-manage", 1, [{ text: "গ্রহণ করুন / বাতিল করুন" }]);
  await h.tap(P, "গ্রহণ করুন / বাতিল করুন", 1200);
  await h.shot(P, "exam-ep-manage", 2, [{ text: "চূড়ান্ত লেখা (দরকার হলে বদলান)" }, { text: "গ্রহণ করুন" }, { text: "বাতিল করুন" }]);
  await h.shot(P, "exam-ep-manage", 3, [{ text: "চূড়ান্ত করুন" }]);
  await P.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-papers spec uploads while it walks; run it locally (see its header)");
  await office(h);
  await reviewer(h);
  await principal(h);
};
