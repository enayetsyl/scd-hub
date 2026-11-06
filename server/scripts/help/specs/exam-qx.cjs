/**
 * Capture spec — কুরআন পরীক্ষা (quran_exam): publish, a day's examiners, a paper, the monitor
 * and reminders, lock; the examiner's marks.
 *
 * LOCAL ONLY: it publishes, reminds and saves marks. Data: fixtures/exam.ts (a draft Quran
 * exam with a নাজেরা paper and sittings on 4 and 22 Nov; run it with --reset first).
 */
const L = require("./exam-lib.cjs");

const QX = "কুরআন পরীক্ষা";

async function office(h) {
  const O = await L.login(h, "office@help.test");
  await L.menuShots(h, O, ["exam-qx-publish"], null, QX);
  await L.fillAfter(O, "অভিভাবকদের জন্য নির্দেশনা", "পরীক্ষার ১৫ মিনিট আগে পৌঁছাবে; কুরআন শরিফ সঙ্গে আনবে।");
  await h.shot(O, "exam-qx-publish", 1, [{ text: "অভিভাবকদের জন্য নির্দেশনা" }, { text: "প্রকাশ করুন" }]);
  await h.tap(O, "সংরক্ষণ করুন", 2500);
  await h.shot(O, "exam-qx-monitor", 0, [{ text: "অগ্রগতি ও নম্বর বাকি" }]);
  await h.shot(O, "exam-qx-lock", 0, [{ text: "ফলাফল", minY: 80 }]);
  await h.shot(O, "exam-qx-lock", 1, [{ text: "নম্বর লক করুন" }]);
  await h.tap(O, "প্রকাশ করুন", 1500);
  await h.shot(O, "exam-qx-publish", 2, [{ text: "নিশ্চিত করুন" }]);
  await h.tap(O, "নিশ্চিত করুন", 3500);

  // A day: move a child, add an examiner (pictures only).
  await h.shot(O, "exam-qx-day", 0, [{ re: "টি পরীক্ষা ·", last: true }]);
  await h.shot(O, "exam-qx-paper", 0, [{ text: "নাজেরা", last: true }]);
  await h.tap(O, { re: "টি পরীক্ষা ·", last: true }, 3500);
  await h.shot(O, "exam-qx-day", 1, [{ text: "সরান" }]);
  await h.shot(O, "exam-qx-day", 2, [{ text: "+ পরীক্ষক যোগ করুন" }]);
  await L.back(O, 3000);

  // The paper.
  await h.tap(O, { text: "নাজেরা", last: true }, 3500);
  await h.shot(O, "exam-qx-paper", 1, [{ text: "পূর্ণমান" }, { text: "নম্বর" }]);
  await h.shot(O, "exam-qx-paper", 2, [{ text: "সংরক্ষণ করুন" }]);
  await L.back(O, 3000);

  // Monitor and reminders.
  await h.tap(O, "অগ্রগতি ও নম্বর বাকি", 4000);
  await h.shot(O, "exam-qx-monitor", 1, [{ text: "রিমাইন্ডার" }, { text: "বাকি সবাইকে রিমাইন্ডার" }]);
  await h.tap(O, "রিমাইন্ডার", 3000);
  await O.context().close();
}

async function examiner(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.menuShots(h, T, ["exam-qx-examine"], null, QX);
  await h.shot(T, "exam-qx-examine", 1, [{ text: "আরিফ হোসেন" }]);
  await h.tap(T, "আরিফ হোসেন", 4000);
  const fill = [["সূরা থেকে পড়া", 36], ["তাজবীদ", 17], ["ছোট সূরা", 18], ["দোয়া", 9]];
  for (const [label, v] of fill) await L.fillAfter(T, label, v).catch(() => {});
  await h.shot(T, "exam-qx-examine", 2, [{ text: "উপস্থিত" }, { text: "সূরা থেকে পড়া" }]);
  await h.shot(T, "exam-qx-examine", 3, [{ text: "সংরক্ষণ করুন" }]);
  await h.tap(T, "সংরক্ষণ করুন", 3000);
  await T.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-qx spec saves while it walks; run it locally (see its header)");
  await office(h);
  await examiner(h);
};
