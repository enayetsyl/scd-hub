/**
 * Capture spec — বৃত্তি অনুশীলন (scholarship_practice): declare a paper, enter marks, the
 * analysis, topics, candidates.
 *
 * LOCAL ONLY: it declares, scores, adds a topic and changes a candidate. Data:
 * fixtures/exam.ts (৫ম শ্রেণি topics and three papers; run it with --reset first).
 */
const L = require("./exam-lib.cjs");

const SC = "বৃত্তি অনুশীলন";

async function teacher(h) {
  const T = await L.login(h, "teacher2@help.test");
  await L.menuShots(h, T, ["exam-sc-declare"], SC, "অনুশীলন প্রশ্ন");
  await h.shot(T, "exam-sc-declare", 1, [{ text: "নতুন প্রশ্ন ঘোষণা" }]);
  await h.shot(T, "exam-sc-marks", 0, [{ text: "ইংরেজি অনুশীলন ৩" }]);
  await h.shot(T, "exam-sc-analysis", 0, [{ text: "শ্রেণি বিশ্লেষণ" }]);

  // Marks for the first child on paper 2.
  await h.tap(T, "ইংরেজি অনুশীলন ৩", 4000);
  const inputs = T.locator("input").locator("visible=true");
  const marks = [7, 4, 3, 6];
  const n = await inputs.count();
  for (let i = 0; i < Math.min(n, marks.length); i++) await inputs.nth(i).fill(String(marks[i]));
  await T.waitForTimeout(500);
  await h.shot(T, "exam-sc-marks", 1, [{ text: "উপস্থিত" }]);
  await h.shot(T, "exam-sc-marks", 2, [{ text: "সংরক্ষণ করুন" }]);
  await h.shot(T, "exam-sc-marks", 3, [{ text: "›" }]);
  await h.tap(T, "সংরক্ষণ করুন", 3000);
  await L.back(T, 3000);

  // The class analysis, then one child.
  await h.tap(T, "শ্রেণি বিশ্লেষণ", 4000);
  await h.shot(T, "exam-sc-analysis", 1, [{ text: "টপিক" }, { text: "জুনায়েদ করিম", last: true }]);
  await h.tap(T, { text: "জুনায়েদ করিম", last: true }, 4000);
  await h.shot(T, "exam-sc-analysis", 2, [{ text: "ইংরেজি" }]);
  await h.tap(T, "ইংরেজি", 2500);
  await h.shot(T, "exam-sc-analysis", 3, [{ text: "বিশ্লেষণ নামান (.md)" }]);
  await L.back(T, 2500);
  await L.back(T, 2500);

  // Declare a new paper.
  await h.tap(T, "নতুন প্রশ্ন ঘোষণা", 3500);
  await h.tap(T, "ইংরেজি", 1000);
  await L.fillAfter(T, "প্রশ্নপত্রের নাম", "ইংরেজি অনুশীলন ৪");
  await L.fillAfter(T, /^তারিখ/, "2026-11-10");
  await L.fillAfter(T, "পূর্ণমান", "30");
  await h.shot(T, "exam-sc-declare", 2, [{ text: "ইংরেজি" }, { text: "প্রশ্নপত্রের নাম" }]);
  await h.tap(T, "সব অংশসহ যোগ করুন", 2000);
  await h.shot(T, "exam-sc-declare", 3, [{ text: "সব অংশসহ যোগ করুন" }, { text: "ঘোষণা করুন" }]);
  await h.tap(T, "ঘোষণা করুন", 3500);
  await T.context().close();
}

async function office(h) {
  const O = await L.login(h, "office@help.test");
  await L.menuShots(h, O, ["exam-sc-topics"], SC, "টপিক তালিকা");
  const five = await h.topmost(O, { text: "শ্রেণি ৫" }, { scroll: true }).catch(() => null);
  if (five) {
    await five.click();
    await O.waitForTimeout(1500);
  }
  await h.tap(O, "ইংরেজি", 2000);
  await L.fillAfter(O, "টপিকের নাম", "Punctuation");
  await h.shot(O, "exam-sc-topics", 1, [{ text: "ইংরেজি" }, { text: "টপিকের নাম" }], { anchor: { text: "ইংরেজি" } });
  // The form card is titled টপিক যোগ করুন too; the button is the second match.
  const ADD = { css: 'text="টপিক যোগ করুন" >> nth=1' };
  await h.shot(O, "exam-sc-topics", 2, [ADD]);
  await h.tap(O, ADD, 3000);

  await L.go(h, O, SC, "অনুশীলন প্রশ্ন");
  await h.shot(O, "exam-sc-candidates", 0, [{ text: "বৃত্তি পরীক্ষার তালিকা" }]);
  await h.tap(O, "বৃত্তি পরীক্ষার তালিকা", 3500);
  await h.shot(O, "exam-sc-candidates", 1, [{ text: "পরীক্ষা দেবে", last: true }]);
  await h.tap(O, { text: "পরীক্ষা দেবে", last: true }, 2500);
  await O.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the exam-sc spec saves while it walks; run it locally (see its header)");
  await teacher(h);
  await office(h);
};
