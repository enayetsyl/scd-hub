/**
 * Capture spec — getting started (ops area): logging in, the menu, ⇅ সাজান, 🔔, the 👤 menu.
 * Staff walk as teacher@help.test, the guardian copies as the base guardian (01800000001).
 *
 * LOCAL ONLY (it logs out and saves the teacher's menu arrangement). Run on the ops fixture:
 *   npx tsx scripts/help/fixtures/ops.ts --reset, then this spec BEFORE ops-comms (whose
 *   pop-ups would otherwise cover these screens). The help-centre guides are ops-help.cjs.
 */
const { PASSWORD, menuShot, tapOutside, home, reveal } = require("./ops-common.cjs");

const LOGIN_ID = { placeholder: "you@school.edu / 01XXXXXXXXX" };
const PASSWORD_BOX = { css: 'input[type="password"]' };
const LOGIN_BTN = { text: "লগইন", last: true };

async function loginScreens(h, user, guide, title, extra) {
  const { page } = await h.login(user, PASSWORD);
  await h.tap(page, "👤", 1200);
  await h.tap(page, "লগআউট", 5000);
  await page.getByPlaceholder(LOGIN_ID.placeholder).fill(user);
  await page.locator(PASSWORD_BOX.css).fill(PASSWORD);
  await h.shot(page, guide, 0, [LOGIN_ID, PASSWORD_BOX, LOGIN_BTN, { text: "English" }]);
  let row = 1;
  if (extra) await h.shot(page, guide, row++, [{ re: "Android অ্যাপ ডাউনলোড করুন" }]);
  await h.tap(page, LOGIN_BTN, 7000);
  await h.shot(page, guide, row, title);
  return page;
}

async function notifications(h, page, guide, example) {
  await h.shot(page, guide, 0, [{ text: "🔔" }]);
  await h.tap(page, "🔔", 3000);
  await h.shot(page, guide, 1, [{ text: example }, { text: "☐" }, { text: "সব পঠিত হিসেবে চিহ্নিত করুন" }]);
  await home(page);
}

async function account(h, page, guide, name) {
  await h.shot(page, guide, 0, [{ text: "👤" }]);
  await h.tap(page, "👤", 1500);
  await h.shot(page, guide, 1, [{ text: name }, { text: "English" }, { text: "সমস্যা জানান" }, { text: "লগআউট" }, { re: "অ্যাপ ভার্সন" }]);
  await tapOutside(page);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("ops-start logs out and saves a menu arrangement; run it locally (see its header)");

  // ── Staff ────────────────────────────────────────────────────────────────
  const T = await loginScreens(h, "teacher@help.test", "ops-login", [{ text: "আজ", minY: 0 }], true);

  await h.shot(T, "ops-menu", 0, [{ text: "☰" }]);
  await menuShot(h, T, "ops-menu", 1, [{ text: "একাডেমিক" }]);
  await h.tap(T, "একাডেমিক", 1500);
  await h.shot(T, "ops-menu", 2, [{ text: "রুটিন" }, { text: "আজ" }]);
  await home(T);

  await notifications(h, T, "ops-notifications", "বদলি ক্লাস দেওয়া হয়েছে");
  await account(h, T, "ops-account", "উদাহরণ শ্রেণি শিক্ষক");

  await menuShot(h, T, "ops-menu-arrange", 0, [{ text: "⇅ সাজান" }]);
  await h.tap(T, "⇅ সাজান", 1500);
  await h.shot(T, "ops-menu-arrange", 1, [
    { text: "নিজে সাজাব" },
    { text: "বেশি ব্যবহৃত উপরে" },
    { text: "↓", minY: 310 },
    { text: "☆", minY: 350 },
  ]);
  await h.tap(T, { text: "☆", minY: 350 }, 800);
  await reveal(T, { text: "আগের মতো করুন" });
  await h.shot(T, "ops-menu-arrange", 2, [{ text: "সংরক্ষণ করুন" }, { text: "আগের মতো করুন" }]);
  await h.tap(T, "সংরক্ষণ করুন", 3000);
  await h.shot(T, "ops-menu-arrange", 3, [{ text: "★ আমার পছন্দ" }]);

  // ── Guardian ─────────────────────────────────────────────────────────────
  const G = await loginScreens(h, "01800000001", "ops-login-guardian", [{ text: "আজ" }, { text: "নাফিসা রহমান" }], false);
  await notifications(h, G, "ops-notifications-guardian", "ক্লাস টেস্টের ফল প্রকাশিত");
  await account(h, G, "ops-account-guardian", "উদাহরণ অভিভাবক");
};
