/**
 * Capture spec — প্রশ্ন সেট (question_sets): build a set from the bank, finalise a draft set,
 * PDF / print a set.
 *
 * LOCAL ONLY: it creates and finalises sets. Data: fixtures/exam.ts (published ৩য় শ্রেণি
 * গণিত questions and one draft set; run it with --reset first).
 */
const L = require("./exam-lib.cjs");

const AC = "একাডেমিক";

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-qs spec saves while it walks; run it locally (see its header)");
  const T = await L.login(h, "teacher@help.test");

  // Build a set from three bank questions.
  await L.menuShots(h, T, ["exam-qs-build"], AC, "প্রশ্ন");
  const boxes = T.locator('[role="checkbox"]').locator("visible=true");
  for (const i of [2, 3, 4]) {
    await boxes.nth(i).scrollIntoViewIfNeeded();
    await boxes.nth(i).click();
    await T.waitForTimeout(500);
  }
  await boxes.nth(2).scrollIntoViewIfNeeded();
  await h.shot(T, "exam-qs-build", 1, [{ text: "✓", pad: 10 }, { text: "সেট তৈরি করুন" }]);
  await h.tap(T, "সেট তৈরি করুন", 2000);
  await L.fillAfter(T, "সেটের নাম", "গণিত ক্লাস টেস্ট ৪");
  await h.tap(T, "শ্রেণি পরীক্ষা", 800);
  await h.shot(T, "exam-qs-build", 2, [{ text: "সেটের নাম" }, { re: "শ্রেণি পরীক্ষা$" }, { text: "শাখা নির্বাচন করুন", minY: 80 }]);
  await h.tap(T, { text: "শাখা নির্বাচন করুন", minY: 80 }, 3000);
  await h.tap(T, { re: "বালক" }, 3000);
  // Picking the শাখা closes the sheet; open it again (the selection is kept).
  await h.tap(T, "সেট তৈরি করুন", 2000);
  const name = await h.topmost(T, { placeholder: "সেটের নাম (ঐচ্ছিক)" }, { scroll: true }).catch(() => null);
  if (name && !(await name.inputValue())) await name.fill("গণিত ক্লাস টেস্ট ৪");
  const ct = await h.topmost(T, { text: "শ্রেণি পরীক্ষা" }, { scroll: true }).catch(() => null);
  if (ct) await ct.click();
  await T.waitForTimeout(800);
  await h.shot(T, "exam-qs-build", 3, [{ text: "তৈরি করুন" }]);
  await h.tap(T, "তৈরি করুন", 4000);

  // Creating opens the new set: its PDF / print buttons.
  await h.shot(T, "exam-qs-pdf", 2, [{ text: "উত্তর দেখান" }, { text: "PDF তৈরি করুন", last: true }, { re: "প্রিন্টে পাঠান$" }]);
  await L.back(T, 3000);

  // The set list: finalise the draft set.
  await L.menuShots(h, T, ["exam-qs-finalise", "exam-qs-pdf"], AC, "সেট");
  await h.shot(T, "exam-qs-finalise", 1, [{ text: "গণিত ক্লাস টেস্ট ৩" }]);
  await h.shot(T, "exam-qs-pdf", 1, [{ text: "গণিত ক্লাস টেস্ট ৪" }]);
  await h.tap(T, "গণিত ক্লাস টেস্ট ৩", 3500);
  await h.shot(T, "exam-qs-finalise", 2, [{ text: "প্রশ্ন যোগ করুন" }, { text: "সেট চূড়ান্ত করুন", minY: 80 }]);
  await h.tap(T, { text: "সেট চূড়ান্ত করুন", minY: 80 }, 3500);
  await h.shot(T, "exam-qs-finalise", 3, [{ text: "সেট চূড়ান্ত করুন", minY: 80 }]);
  await h.tap(T, { text: "সেট চূড়ান্ত করুন", minY: 80 }, 3500);

  await T.context().close();
};
