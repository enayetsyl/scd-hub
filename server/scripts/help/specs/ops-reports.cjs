/**
 * Capture spec — reports (ops area): finding a report in the menu, and three of the most used
 * ones (absentees, class-note submissions, homework not declared). Read-only walk as the Office.
 * Data: scripts/help/fixtures/ops.ts (no attendance is marked, so every শাখা shows as unmarked).
 */
const { PASSWORD, menuShot, fill, home } = require("./ops-common.cjs");

/** From a fresh start: open the menu, unfold রিপোর্ট, shoot the leaf, open it. */
async function reportLeaf(h, page, guide, leaf) {
  await home(page);
  await h.openMenu(page);
  const onTop = await h.topmost(page, { text: leaf }, { scroll: true }).then(() => true, () => false);
  if (!onTop) await h.tap(page, "রিপোর্ট", 1500);
  await h.shot(page, guide, 0, [{ text: leaf }]);
  await h.tap(page, leaf, 4000);
}

/** The last school day before today (the example school is closed on Fridays). */
function lastSchoolDay() {
  const d = new Date(Date.now() + 6 * 3600000);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 5);
  return d.toISOString().slice(0, 10);
}

exports.run = async (h) => {
  const O = (await h.login("office@help.test", PASSWORD)).page;

  await menuShot(h, O, "ops-reports-open", 0, [{ text: "রিপোর্ট" }]);
  await h.tap(O, "রিপোর্ট", 1500);
  await h.shot(O, "ops-reports-open", 1, [{ text: "অনুপস্থিতির প্রতিবেদন" }]);
  await h.tap(O, "অনুপস্থিতির প্রতিবেদন", 4000);
  await fill(h, O, { css: "input" }, lastSchoolDay(), 3500);
  // The date field's <input> is hidden under the shown date; box the date itself.
  await h.shot(O, "ops-report-absentees", 0, [{ re: "^\\d{4}-\\d{2}-\\d{2}$" }]);
  await h.shot(O, "ops-report-absentees", 1, [{ text: "উপস্থিতি নেওয়া হয়নি" }, { text: "অনুপস্থিত — ছুটির আবেদন নেই" }]);

  await reportLeaf(h, O, "ops-report-class-notes", "ক্লাস নোট জমা");
  await h.shot(O, "ops-report-class-notes", 1, [{ re: "^\\d{4}-\\d{2}-\\d{2}$" }, { text: "পিডিএফ" }]);

  await reportLeaf(h, O, "ops-report-hw-declare", "বাড়ির কাজ ঘোষণা বাকি");
  await h.shot(O, "ops-report-hw-declare", 1, [{ text: "৭ দিন" }, { text: "শ্রেণি" }, { text: "এই ফিল্টারে কিছু নেই ✓" }]);
};
