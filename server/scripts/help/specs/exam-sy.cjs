/**
 * Capture spec — পরীক্ষার সিলেবাস (exam_syllabus) and পরীক্ষার রুটিন (exam_routine): set up an
 * exam, write a syllabus, teacher approval, publish, read; write and publish the routine.
 *
 * LOCAL ONLY: it saves, approves and publishes while it walks. Data: fixtures/exam.ts
 * (run it with --reset first).
 */
const L = require("./exam-lib.cjs");

const SY = "পরীক্ষার সিলেবাস";

async function office(h) {
  const O = await L.login(h, "office@help.test");

  // Exams.
  await L.menuShots(h, O, ["exam-sy-exams"], SY, "পরীক্ষা ব্যবস্থাপনা");
  await L.fillAfter(O, "পরীক্ষার নাম", "অর্ধবার্ষিক পরীক্ষা ২০২৬", { last: true });
  await h.shot(O, "exam-sy-exams", 1, [{ text: "ধরন" }, { text: "পরীক্ষার নাম", last: true }, { text: "পরীক্ষা তৈরি করুন" }], {
    anchor: { text: "নতুন পরীক্ষা" },
  });
  await h.shot(O, "exam-sy-exams", 2, [{ text: "সম্পাদনা" }]);

  // Write a syllabus (বিজ্ঞান is not written yet).
  await L.menuShots(h, O, ["exam-sy-write"], SY, "সিলেবাস এন্ট্রি");
  await h.shot(O, "exam-sy-write", 1, [{ text: "বিজ্ঞান" }]);
  await h.tap(O, "বিজ্ঞান", 3500);
  await L.fillAfter(O, "সিলেবাস", "অধ্যায় ১–৬: আমাদের পরিবেশ, উদ্ভিদ ও প্রাণী, পানি, বায়ু, স্বাস্থ্যকর অভ্যাস।", { last: true });
  await h.shot(O, "exam-sy-write", 2, [{ text: "সিলেবাস", last: true }, { text: "মানবন্টন" }]);
  await h.tap(O, "মানবন্টন", 1500);
  await h.shot(O, "exam-sy-write", 3, [{ text: "সংরক্ষণ করুন" }, { text: "শিক্ষকের কাছে পাঠান" }]);
  await h.tap(O, "সংরক্ষণ করুন", 3000);

  // Exam routine: edit ৩য় শ্রেণি, then publish.
  await L.menuShots(h, O, ["exam-er-publish"], SY, "পরীক্ষার রুটিন");
  await h.shot(O, "exam-er-edit", 0, [{ text: "রুটিন সম্পাদনা" }]);
  await h.shot(O, "exam-er-publish", 1, [{ text: "রুটিন প্রকাশ করুন" }]);
  await h.tap(O, "রুটিন সম্পাদনা", 3500);
  await L.pick(h, O, { text: "শ্রেণি বাছাই করুন", last: true }, "৩য় শ্রেণি");
  await O.waitForTimeout(1500);
  await h.shot(O, "exam-er-edit", 1, [{ text: "শ্রেণি বাছাই করুন" }, { re: "^তারিখ" }], { anchor: { text: "শ্রেণি বাছাই করুন" } });
  await h.shot(O, "exam-er-edit", 2, [{ text: "+ বিষয় যোগ করুন" }, { text: "এই শ্রেণির রুটিন সংরক্ষণ" }]);
  await h.tap(O, "এই শ্রেণির রুটিন সংরক্ষণ", 3000);
  await L.back(O, 3000);
  await h.tap(O, "রুটিন প্রকাশ করুন", 1500);
  await h.shot(O, "exam-er-publish", 2, [{ text: "নিশ্চিত করুন" }]);
  await h.tap(O, "নিশ্চিত করুন", 3000);
  await O.context().close();
}

async function teacher2(h) {
  const T = await L.login(h, "teacher2@help.test");
  await L.menuShots(h, T, ["exam-sy-teacher-approve"], SY, "অনুমোদন");
  await h.shot(T, "exam-sy-teacher-approve", 1, [{ text: "মানবন্টন দেখুন" }, { text: "অনুমোদন", minY: 120 }, { text: "ফেরত দেওয়ার কারণ" }]);
  await h.tap(T, { text: "অনুমোদন", minY: 120 }, 3000);
  await T.context().close();
}

async function principal(h) {
  const P = await L.login(h, "principal@help.test");
  await L.menuShots(h, P, ["exam-sy-publish"], SY, "অনুমোদন");
  await h.shot(P, "exam-sy-publish", 1, [{ text: "প্র" }]);
  await h.tap(P, "প্র", 2500);
  await h.shot(P, "exam-sy-publish", 2, [{ text: "প্রকাশ করুন" }, { text: "ফেরত দেওয়ার কারণ" }]);
  await h.tap(P, "প্রকাশ করুন", 3000);
  await P.context().close();
}

async function teacher(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.menuShots(h, T, ["exam-sy-read"], SY, "সিলেবাস দেখুন");
  await h.shot(T, "exam-sy-read", 1, [{ text: "বার্ষিক পরীক্ষা ২০২৬" }, { text: "৩য় শ্রেণি" }, { text: "বাংলা" }]);
  await h.tap(T, "বাংলা", 3500);
  await h.shot(T, "exam-sy-read", 2, [{ text: "মানবন্টন" }]);
  await L.menuShots(h, T, ["exam-er-view"], SY, "পরীক্ষার রুটিন");
  await h.shot(T, "exam-er-view", 1, [{ text: "বার্ষিক পরীক্ষা ২০২৬" }, { text: "৩য় শ্রেণি" }]);
  await T.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-sy spec saves while it walks; run it locally (see its header)");
  await office(h);
  await teacher2(h);
  await principal(h);
  await teacher(h);
};
