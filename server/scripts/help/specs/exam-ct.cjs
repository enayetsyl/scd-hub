/**
 * Capture spec — ক্লাস টেস্ট (class_test): request, register, change date, marks, submit,
 * approve, dashboard, correct details, retire.
 *
 * LOCAL ONLY: it enters marks, submits, approves and retires, because those screens only
 * exist after those steps. Data: scripts/help/fixtures/exam.ts (run it with --reset first).
 */
const L = require("./exam-lib.cjs");

const TRACKERS = "ট্র্যাকার";
const CT = "ক্লাস টেস্ট";

async function teacher(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.menuShots(h, T, ["exam-ct-register", "exam-ct-change-date", "exam-ct-enter-marks", "exam-ct-view-results"], TRACKERS, CT);
  // ফলাফল দেখুন of বাংলা টেস্ট ১ (all marks in): the second printed test in the list.
  await h.shot(T, "exam-ct-view-results", 1, [{ css: 'text="ফলাফল দেখুন" >> nth=1' }]);
  await h.tap(T, { css: 'text="ফলাফল দেখুন" >> nth=1' }, 3500);
  await h.shot(T, "exam-ct-view-results", 2, [{ re: "/২০ · পাস$" }]);
  await L.back(T, 2500);

  // Hub: the buttons and the tests' own actions.
  await h.shot(T, "exam-ct-request", 0, [{ text: "নতুন প্রিন্ট অনুরোধ", minY: 80 }]);
  await h.shot(T, "exam-ct-register", 1, [{ text: "নতুন প্রিন্ট অনুরোধ", minY: 80 }]);
  await h.shot(T, "exam-ct-change-date", 1, [{ text: "পরীক্ষার তারিখ পরিবর্তন" }]);
  await h.tap(T, "পরীক্ষার তারিখ পরিবর্তন", 1500);
  await h.shot(T, "exam-ct-change-date", 2, [{ text: "পরীক্ষার তারিখ" }, { text: "সংরক্ষণ" }], { anchor: { text: "পরীক্ষার তারিখ" } });
  await h.tap(T, "বাতিল", 1200);

  // The request form, filled but not sent.
  await h.tap(T, { text: "নতুন প্রিন্ট অনুরোধ", minY: 80 }, 3000);
  await L.pick(h, T, "শ্রেণি নির্বাচন করুন", "৩য় শ্রেণি");
  const sec = await h.topmost(T, { re: "শাখা নির্বাচন" }, { scroll: true }).catch(() => null);
  if (sec) {
    await sec.click();
    await T.waitForTimeout(900);
    await h.tap(T, "বালক", 1200);
  }
  await L.pick(h, T, "বিষয় নির্বাচন করুন", "গণিত");
  await h.tap(T, "নিজের প্রশ্নপত্র", 1200);
  await h.shot(T, "exam-ct-request", 1, [{ text: "৩য় শ্রেণি" }, { text: "গণিত" }, { text: "নিজের প্রশ্নপত্র" }], {
    anchor: { text: "নতুন প্রিন্ট অনুরোধ", minY: 80 },
  });
  await h.tap(T, "Black & white", 600);
  await h.tap(T, "Single side", 600);
  await L.fillAfter(T, "কপি সংখ্যা", "6");
  await h.shot(T, "exam-ct-request", 2, [{ re: "^রঙ" }, { re: "^কপি সংখ্যা \\*" }], { anchor: { re: "^রঙ" } });
  await L.fillDateAfter(T, "পরীক্ষার তারিখ", "2026-11-12");
  await L.fillAfter(T, "পূর্ণমান", "20");
  await h.shot(T, "exam-ct-request", 3, [{ text: "পরীক্ষার তারিখ" }, { text: "অনুরোধ জমা দিন" }]);

  // The same form, as a no-print registration (not sent either).
  await h.tap(T, "প্রিন্ট ছাড়া নিবন্ধন করুন", 1200);
  await h.shot(
    T,
    "exam-ct-register",
    2,
    [{ text: "প্রিন্ট ছাড়া নিবন্ধন করুন" }, { text: "পরীক্ষার তারিখ" }, { text: "প্রিন্ট ছাড়া নিবন্ধন করুন", last: true }],
    { anchor: { text: "প্রিন্ট ছাড়া নিবন্ধন করুন" } },
  );
  await L.back(T);

  // Marks: the oldest printed test (গণিত টেস্ট ১) sits last in the list.
  await h.shot(T, "exam-ct-enter-marks", 1, [{ text: "ফলাফল এন্ট্রি", last: true }]);
  await h.tap(T, { text: "ফলাফল এন্ট্রি", last: true }, 3500);
  await h.shot(T, "exam-ct-enter-marks", 2, [{ text: "নম্বর দিন" }]);
  const marks = [16, 12, 18];
  for (const [i, m] of marks.entries()) {
    await h.tap(T, "নম্বর দিন", 1500);
    await L.fillAfter(T, /^প্রাপ্ত নম্বর/, m);
    if (i === 0) {
      await L.fillAfter(T, "লক্ষণীয় দিক", "হাতে রেখে যোগে আরও যত্ন দরকার");
      await h.shot(T, "exam-ct-enter-marks", 3, [{ text: "উপস্থিত" }, { re: "^প্রাপ্ত নম্বর" }, { text: "ফলাফল সংরক্ষণ" }], {
        anchor: { text: "উপস্থিত" },
      });
    }
    await h.tap(T, "ফলাফল সংরক্ষণ", 2500);
  }

  // Submit for approval.
  await h.shot(T, "exam-ct-submit", 0, [{ text: "জমা দিন" }]);
  await h.tap(T, "জমা দিন", 3500);
  await h.shot(T, "exam-ct-submit", 1, [{ text: "প্রকাশের জন্য জমা দিন" }, { text: "ফেরত নিন" }]);
  await h.tap(T, "প্রকাশের জন্য জমা দিন", 3000);
  await L.back(T);
  await L.back(T);

  // Correct a test's details: গণিত টেস্ট ৩ (no marks yet) is the first printed one.
  await T.reload({ waitUntil: "load" });
  await T.waitForTimeout(6000);
  await L.go(h, T, TRACKERS, CT);
  await h.shot(T, "exam-ct-edit-details", 0, [{ text: "ফলাফল এন্ট্রি" }]);
  await h.tap(T, "ফলাফল এন্ট্রি", 3500);
  await h.shot(T, "exam-ct-edit-details", 1, [{ text: "পরীক্ষার তথ্য সংশোধন" }]);
  await h.tap(T, "পরীক্ষার তথ্য সংশোধন", 1500);
  await L.fillAfter(T, "পূর্ণমান", "25");
  await h.shot(T, "exam-ct-edit-details", 2, [{ text: "পূর্ণমান" }, { text: "সংরক্ষণ" }], { anchor: { text: "পূর্ণমান" } });
  await h.tap(T, "সংরক্ষণ", 2500);
  await T.context().close();
}

async function principal(h) {
  const P = await L.login(h, "principal@help.test");
  await L.menuShots(h, P, ["exam-ct-dashboard"], TRACKERS, CT);
  await h.shot(P, "exam-ct-dashboard", 1, [{ re: "^ড্যাশবোর্ড" }]);
  await h.tap(P, { re: "^ড্যাশবোর্ড" }, 5000);
  await h.shot(P, "exam-ct-dashboard", 2, [{ text: "ফিল্টার ও খোঁজ" }, { text: "বিলম্বিত" }]);
  await h.shot(P, "exam-ct-dashboard", 3, [{ text: "অসম্পূর্ণ ফলাফলের রিমাইন্ডার" }]);

  // Approve বাংলা টেস্ট ১ (submitted in the fixture).
  await h.shot(P, "exam-ct-approve", 0, [{ re: "^বাংলা · টেস্ট নং ১" }]);
  await h.tap(P, { re: "^বাংলা · টেস্ট নং ১" }, 4000);
  await h.shot(P, "exam-ct-approve", 1, [{ text: "ফলাফল প্রকাশ" }]);
  await h.tap(P, "ফলাফল প্রকাশ", 3500);
  await h.tap(P, "ফেরত পাঠান", 1200);
  await h.shot(P, "exam-ct-approve", 2, [{ text: "অনুমোদন ও প্রকাশ" }, { text: "ফেরত পাঠান" }, { text: "ফেরত পাঠানোর কারণ" }]);
  await h.tap(P, "অনুমোদন ও প্রকাশ", 4000);
  await h.shot(P, "exam-ct-unpublish", 0, [{ text: "সব প্রকাশ বাতিল" }]);
  await h.shot(P, "exam-ct-unpublish", 1, [{ text: "প্রকাশ বাতিল" }]);
  await P.context().close();
}

async function office(h) {
  const O = await L.login(h, "office@help.test");
  await L.go(h, O, TRACKERS, CT);
  await h.tap(O, { re: "^ড্যাশবোর্ড" }, 5000);
  await h.shot(O, "exam-ct-retire", 0, [{ re: "^গণিত · টেস্ট নং ৩" }]);
  await h.tap(O, { re: "^গণিত · টেস্ট নং ৩" }, 4000);
  await h.shot(O, "exam-ct-retire", 1, [{ text: "পরীক্ষা প্রত্যাহার" }]);
  await h.tap(O, "পরীক্ষা প্রত্যাহার", 1200);
  await L.fillAfter(O, "প্রত্যাহারের কারণ", "পরীক্ষাটি ভুল করে দুবার তোলা হয়েছিল");
  await h.shot(O, "exam-ct-retire", 2, [{ text: "প্রত্যাহারের কারণ" }, { text: "পরীক্ষা প্রত্যাহার" }], {
    anchor: { text: "প্রত্যাহারের কারণ" },
  });
  await O.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-ct spec saves while it walks; run it locally (see its header)");
  await teacher(h);
  await principal(h);
  await office(h);
};
exports.teacher = teacher;
exports.principal = principal;
exports.office = office;
