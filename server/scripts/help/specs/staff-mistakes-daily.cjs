/**
 * Capture spec — the end-of-day mistake report (D-#1016, docs/prd-staff-mistakes.md §18).
 *
 * LOCAL ONLY: it needs the example school (fixture.ts) plus a few quiet mistake entries and one
 * STAFF_MISTAKE_DAILY notice for the Principal (seed them with the staff-mistake services and
 * dispatchStaffMistakeDaily before running). Tapping the notice marks it read, which is a write.
 *
 * Also asserts the quiet side: the example teacher has no আমার ভুল ও ব্যাখ্যা card.
 * Logins come from scripts/help/fixture.ts (password Help@123).
 */
const PASSWORD = "Help@123";
const GUIDE = "staff-mistakes-daily";
const t = (text, extra = {}) => ({ text, ...extra });

exports.run = async (h) => {
  if (h.PROD) throw new Error("the staff-mistakes-daily spec marks a notice read; run it locally (see its header)");

  // ── Principal: bell → the report → the day's list ──────────────────────────
  const P = (await h.login("principal@help.test", PASSWORD)).page;
  await h.tap(P, { css: '[aria-label="নোটিফিকেশন"]' }, 3000);
  await h.shot(P, GUIDE, 0, [{ re: "^আজকের কর্মীর ভুল" }]);
  await h.tap(P, { re: "^আজকের কর্মীর ভুল" }, 4000);
  // The detail page shows the whole report and offers the day's list as a button.
  await h.shot(P, GUIDE, 1, [t("সংশ্লিষ্ট পাতা খুলুন")]);
  await h.tap(P, "সংশ্লিষ্ট পাতা খুলুন", 4000);

  // The tap must land on the day's list of the notice's day (refs.date).
  await h.topmost(P, t("দিনের তালিকা"), { scroll: false });
  await h.topmost(P, { re: "^আজ · " }, { scroll: false });
  await h.shot(P, GUIDE, 2, [t("দিনের তালিকা"), t("‹ আগের দিন"), t("সিদ্ধান্ত বদলান")], { anchor: t("দিনের তালিকা") });

  // Yesterday holds the one older entry.
  await h.tap(P, "‹ আগের দিন", 3000);
  await h.topmost(P, { re: "গতকালের এন্ট্রি" }, { scroll: true });

  // ── Principal: the কর্মী page cards (a fresh session: the HR stack above is still open) ──
  const P2 = (await h.login("principal@help.test", PASSWORD)).page;
  await h.openMenu(P2);
  await h.tap(P2, "কর্মী", 3000);
  await h.shot(P2, GUIDE, 3, [t("ব্যাখ্যা যাচাই", { minY: 100 }), t("কর্মীর ভুলের হিসাব", { minY: 100 })]);

  // ── Teacher: nothing about mistakes ────────────────────────────────────────
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await h.openMenu(T);
  await h.tap(T, "কর্মী", 3000);
  const text = await T.locator("body").innerText();
  if (text.includes("আমার ভুল ও ব্যাখ্যা") || text.includes("ব্যাখ্যা যাচাই")) {
    throw new Error("the teacher can see a staff-mistake card on the কর্মী page");
  }
  console.log("teacher: no staff-mistake card on the কর্মী page");
};
