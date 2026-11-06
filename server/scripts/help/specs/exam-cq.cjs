/**
 * Capture spec — ক্লাস টেস্টের প্রশ্নপত্র অনুরোধ (class_test_question) and the answer-script
 * flow (class_test_script): request, prepare, review, send to print; hand in, receive, scan,
 * publish, hand back, return.
 *
 * LOCAL ONLY: it saves while it walks, and it fakes the Drive uploads (fixtures/exam.ts
 * holds the StoredFile rows the fake answers with). Run the fixture with --reset first.
 */
const L = require("./exam-lib.cjs");

const TRACKERS = "ট্র্যাকার";
const CT = "ক্লাস টেস্ট";
const PAPER = "6600000000000000000000a1";
const SCANS = ["6600000000000000000000b1", "6600000000000000000000b2", "6600000000000000000000b3", "6600000000000000000000b4", "6600000000000000000000b5", "6600000000000000000000b6"];

async function teacherQuestions(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.go(h, T, TRACKERS, CT);
  for (const g of ["exam-cq-request", "exam-cq-review"]) await h.shot(T, g, 0, [{ text: "প্রশ্ন তৈরির অনুরোধ (অফিসকে)" }]);
  await h.tap(T, "প্রশ্ন তৈরির অনুরোধ (অফিসকে)", 3500);
  await h.shot(T, "exam-cq-request", 1, [{ text: "নতুন অনুরোধ" }]);

  // Review the paper the Office sent (বাংলা অধ্যায় ৪): ask for a change.
  await h.tap(T, "পরিবর্তন দরকার", 1200);
  await L.fillAfter(T, "কী পরিবর্তন দরকার লিখুন", "৩ নম্বর প্রশ্নটি পাঠ্যবইয়ের অনুশীলনী থেকে দিন।");
  await h.shot(T, "exam-cq-review", 1, [{ re: "প্রশ্ন দেখুন$" }, { text: "ঠিক আছে — চূড়ান্ত করুন" }, { text: "পরিবর্তন দরকার" }], {
    anchor: { re: "প্রশ্ন দেখুন$" },
  });
  await h.shot(T, "exam-cq-review", 2, [{ text: "কী পরিবর্তন দরকার লিখুন" }, { text: "মন্তব্যসহ পাঠান" }]);
  await h.tap(T, "মন্তব্যসহ পাঠান", 3000);

  // Send the confirmed paper (গণিত অধ্যায় ৬) to print.
  await h.shot(T, "exam-cq-send-print", 0, [{ text: "প্রিন্টে পাঠান" }]);
  await h.tap(T, "প্রিন্টে পাঠান", 1500);
  await L.pick(h, T, { text: "রঙ", last: true }, "Black & white");
  await L.pick(h, T, { text: "পৃষ্ঠা", last: true }, "Single side");
  await h.shot(T, "exam-cq-send-print", 1, [{ text: "রঙ" }, { text: "পৃষ্ঠা" }, { text: "প্রিন্টে পাঠান", last: true }]);
  await h.tap(T, { text: "প্রিন্টে পাঠান", last: true }, 3500);

  // A new request.
  await h.tap(T, "নতুন অনুরোধ", 3000);
  await L.pick(h, T, "শ্রেণি নির্বাচন করুন", "৩য় শ্রেণি");
  const sec = await h.topmost(T, { re: "শাখা নির্বাচন" }, { scroll: true }).catch(() => null);
  if (sec) {
    await sec.click();
    await T.waitForTimeout(900);
    await h.tap(T, "বালক", 1200);
  }
  await L.pick(h, T, { text: "বিষয়", last: true }, "বাংলা");
  await L.fillAfter(T, "অধ্যায় নম্বর", "৭");
  await L.fillAfter(T, "পূর্ণমান", "20");
  await L.fillAfter(T, "সময় (মিনিট)", "40");
  await L.fillDateAfter(T, "পরীক্ষার তারিখ", "2026-11-25");
  await h.shot(T, "exam-cq-request", 2, [{ text: "৩য় শ্রেণি" }, { text: "বাংলা" }, { text: "অধ্যায় নম্বর" }, { text: "নতুন অনুরোধ", last: true }], {
    anchor: { text: "নতুন প্রশ্নের অনুরোধ", minY: 80 },
  });
  await h.tap(T, { text: "নতুন অনুরোধ", last: true }, 3000);
  await T.context().close();
}

async function officeQuestions(h) {
  const O = await L.login(h, "office@help.test");
  await L.fakeUploads(O, "classtest", [PAPER], "application/pdf");
  await L.go(h, O, TRACKERS, CT);
  await h.shot(O, "exam-cq-prepare", 0, [{ text: "প্রশ্নের অনুরোধ কিউ" }]);
  await h.tap(O, "প্রশ্নের অনুরোধ কিউ", 3500);
  await h.shot(O, "exam-cq-prepare", 1, [{ text: "প্রশ্নপত্র আপলোড করুন" }]);
  await L.chooseFiles(h, O, "প্রশ্নপত্র আপলোড করুন", L.sampleFiles(1));
  await L.fillAfter(O, "নোট (ঐচ্ছিক)", "প্রশ্ন ৫-এর চিত্রটি নতুন করে আঁকা হয়েছে");
  await h.shot(O, "exam-cq-prepare", 2, [{ text: "নোট (ঐচ্ছিক)" }, { text: "রিভিউতে পাঠান" }], { anchor: { text: "নোট (ঐচ্ছিক)" } });
  await h.tap(O, "রিভিউতে পাঠান", 3000);
  await O.context().close();
}

/** Back to আজ with the script card open (it keeps its open state while mounted). */
async function toToday(h, page, probe) {
  await L.go(h, page, null, "আজ", 3000);
  const open = await h.topmost(page, { text: probe }, { scroll: true }).then(() => true, () => false);
  if (!open) await h.tap(page, "ক্লাস টেস্টের খাতা", 2000);
}

async function teacherScripts(h) {
  const T = await L.login(h, "teacher2@help.test");
  for (const g of ["exam-cs-hand-in", "exam-cs-return"]) await h.shot(T, g, 0, [{ text: "ক্লাস টেস্টের খাতা" }]);
  await h.tap(T, "ক্লাস টেস্টের খাতা", 2000);
  await h.shot(T, "exam-cs-hand-in", 1, [{ text: "খাতা অফিসে জমা দিন" }]);
  await h.shot(T, "exam-cs-return", 1, [{ text: "ফেরত দিয়েছি" }]);
  await h.tap(T, "ফেরত দিয়েছি", 3000);
  await T.context().close();
}

async function officeScripts(h) {
  const O = await L.login(h, "office@help.test");
  await L.fakeUploads(O, "ctscript", SCANS);
  for (const g of ["exam-cs-receive", "exam-cs-hand-back"]) await h.shot(O, g, 0, [{ text: "ক্লাস টেস্টের খাতা" }]);
  await h.tap(O, "ক্লাস টেস্টের খাতা", 2000);
  await h.shot(O, "exam-cs-scan", 0, [{ text: "স্ক্যান আপলোড" }]);
  await h.shot(O, "exam-cs-publish", 0, [{ text: "স্ক্যান আপলোড", last: true }]);
  await h.shot(O, "exam-cs-hand-back", 1, [{ text: "শিক্ষককে খাতা দিন" }]);
  await h.shot(O, "exam-cs-receive", 1, [{ text: "খাতা গ্রহণ করুন" }]);

  // Publish the fully tagged test (ইংরেজি ২ is still to scan; গণিত ১ is ready).
  await h.tap(O, { text: "স্ক্যান আপলোড", last: true }, 4000);
  await h.shot(O, "exam-cs-publish", 1, [{ text: "অভিভাবকদের জন্য প্রকাশ করুন" }]);
  await h.tap(O, "অভিভাবকদের জন্য প্রকাশ করুন", 4000);
  await toToday(h, O, "স্ক্যান আপলোড");

  // Scan and tag ইংরেজি টেস্ট ২.
  await h.tap(O, "স্ক্যান আপলোড", 4000);
  await L.chooseFiles(h, O, "ফাইল বেছে নিন", L.sampleFiles(4), 5000);
  await h.shot(O, "exam-cs-scan", 1, [{ text: "ফাইল বেছে নিন" }, { text: "রোল অনুযায়ী মিলিয়ে দিন" }]);
  await h.tap(O, "রোল অনুযায়ী মিলিয়ে দিন", 6000);
  await h.shot(O, "exam-cs-scan", 2, [{ text: "পৃষ্ঠা যোগ", last: true }, { text: "খাতা নেই", last: true }], { anchor: { text: "পৃষ্ঠা যোগ", last: true } });

  // Hand a published bundle back, then receive the waiting one.
  await toToday(h, O, "শিক্ষককে খাতা দিন");
  await h.tap(O, "শিক্ষককে খাতা দিন", 3000);
  await h.tap(O, "খাতা গ্রহণ করুন", 1500);
  await h.shot(O, "exam-cs-receive", 2, [{ text: "কয়টি খাতা হাতে পেয়েছেন?" }, { text: "নিশ্চিত করুন" }]);
  await h.tap(O, "নিশ্চিত করুন", 3000);
  await O.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-cq spec saves while it walks; run it locally (see its header)");
  await teacherQuestions(h);
  await officeQuestions(h);
  await teacherScripts(h);
  await officeScripts(h);
};
