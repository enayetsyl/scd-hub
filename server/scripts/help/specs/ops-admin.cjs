/**
 * Capture spec — admin and access (ops area), as the Principal: permissions (person and role),
 * View as, staff logins, the audit log, one person's activity, system health, the AI key screen
 * and the message templates.
 *
 * LOCAL ONLY: it creates a login, resets a password and opens a View-as session. Data:
 * scripts/help/fixtures/ops.ts. The local server must run with a dummy GEMINI_API_KEY (the AI
 * screen prints a key's last four characters; never shoot it with a real key in .env).
 */
const { PASSWORD, menu, reveal, fill, home } = require("./ops-common.cjs");

async function admin(h, page, item, guide) {
  await home(page);
  await menu(h, page, "প্রশাসন");
  if (guide) await h.shot(page, guide, 0, [{ text: item }]);
  await h.tap(page, item, 3500);
}

const nth = (n) => ({ css: `:nth-match(input:not([placeholder]):not([type="password"]), ${n})` });

exports.run = async (h) => {
  if (h.PROD) throw new Error("ops-admin saves while it walks; run it locally (see its header)");
  const P = (await h.login("principal@help.test", PASSWORD)).page;

  // ── Permissions: by role, then one person ────────────────────────────────
  await admin(h, P, "অনুমতি পরিচালনা", "ops-access-person");
  await h.tap(P, "সবাইকে দিন (ভূমিকা অনুযায়ী)", 3000);
  await h.shot(P, "ops-access-role", 0, [{ text: "সবাইকে দিন (ভূমিকা অনুযায়ী)" }, { text: "শিক্ষক" }]);
  await fill(h, P, { placeholder: "খুঁজুন (সুবিধা বা কাজ)" }, "প্রিন্ট", 1500).catch(() => {});
  await h.shot(P, "ops-access-role", 1, [{ text: "প্রিন্ট", minY: 80 }]);
  await reveal(P, { text: "ডিফল্টে ফেরত নিন" });
  await h.shot(P, "ops-access-role", 2, [{ text: "ডিফল্টে ফেরত নিন" }]);

  await h.tap(P, "একজনকে দিন (ব্যক্তি অনুযায়ী)", 3000);
  await h.shot(P, "ops-access-person", 1, [{ text: "একজনকে দিন (ব্যক্তি অনুযায়ী)" }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 4000);
  await fill(h, P, { placeholder: "খুঁজুন (সুবিধা বা কাজ)" }, "প্রিন্ট", 1500);
  await h.shot(P, "ops-access-person", 2, [{ placeholder: "খুঁজুন (সুবিধা বা কাজ)" }, { text: "প্রিন্ট", minY: 80 }]);
  await h.tap(P, { text: "প্রিন্ট", minY: 80 }, 1500);
  await h.shot(P, "ops-access-person", 3, [{ text: "বন্ধ" }]);

  // ── View as ──────────────────────────────────────────────────────────────
  await home(P);
  await h.shot(P, "ops-view-as", 0, [{ text: "👤" }]);
  await h.tap(P, "👤", 1500);
  await h.tap(P, "কার হয়ে দেখবেন", 3000);
  await h.shot(P, "ops-view-as", 1, [{ text: "শিক্ষক ও অফিস" }, { placeholder: "নাম, ফোন বা শিক্ষার্থীর নাম" }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 7000);
  await h.shot(P, "ops-view-as", 2, [{ text: "ফিরে যান" }]);
  await h.tap(P, "ফিরে যান", 7000);

  // ── Staff logins ─────────────────────────────────────────────────────────
  await admin(h, P, "ব্যবহারকারী", "ops-staff-login-create");
  await reveal(P, { text: "ব্যবহারকারী তৈরি" });
  await fill(h, P, nth(1), "উদাহরণ নতুন শিক্ষক", 300);
  await fill(h, P, nth(2), "newteacher@help.test", 300);
  await fill(h, P, { css: 'input[type="password"]' }, PASSWORD, 300);
  await h.tap(P, "TEACHER", 800);
  await h.shot(P, "ops-staff-login-create", 1, [nth(1), nth(2), { css: 'input[type="password"]' }, { text: "TEACHER" }, { text: "ব্যবহারকারী তৈরি", last: true }]);
  await h.tap(P, { text: "ব্যবহারকারী তৈরি", last: true }, 3500);

  await home(P);
  await menu(h, P, "প্রশাসন");
  await h.tap(P, "ব্যবহারকারী", 3500);
  await fill(h, P, { placeholder: "নাম, ইমেইল বা ফোন দিয়ে খুঁজুন" }, "শ্রেণি শিক্ষক", 1500);
  await h.shot(P, "ops-staff-password-reset", 0, [{ placeholder: "নাম, ইমেইল বা ফোন দিয়ে খুঁজুন" }]);
  await h.tap(P, "নতুন পাসওয়ার্ড তৈরি", 3500);
  await h.shot(P, "ops-staff-password-reset", 1, [{ text: "নতুন পাসওয়ার্ড তৈরি" }, { re: "^লগইন আইডি" }]);

  // ── Audit log, activity ──────────────────────────────────────────────────
  await admin(h, P, "অডিট লগ", "ops-audit-log");
  await h.shot(P, "ops-audit-log", 1, [{ css: "input" }, { text: "সব" }, { text: "উদাহরণ অফিস কর্মী" }]);

  await admin(h, P, "কার্যক্রম", "ops-person-activity");
  await fill(h, P, { css: "input" }, "শ্রেণি", 1500);
  await h.shot(P, "ops-person-activity", 1, [{ css: "input" }, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 4000);
  await h.tap(P, "৩০ দিন", 3000);
  await h.shot(P, "ops-person-activity", 2, [{ text: "৩০ দিন" }, { text: "অন্য কাউকে দেখুন" }]);

  // ── System health, AI key ────────────────────────────────────────────────
  await admin(h, P, "সিস্টেমের অবস্থা", "ops-system-health");
  await h.shot(P, "ops-system-health", 1, [{ text: "ডেটাবেজ" }]);
  await reveal(P, { text: "ব্যাকআপ" });
  await h.shot(P, "ops-system-health", 2, [{ text: "ব্যাকআপ" }, { re: "^স্বয়ংক্রিয় কাজ" }]);

  await admin(h, P, "এআই (Gemini) কী ও মডেল", "ops-ai-key");
  await h.shot(P, "ops-ai-key", 1, [{ css: ":nth-match(input, 1)" }, { css: ":nth-match(input, 2)" }, { text: "পরীক্ষা করে সংরক্ষণ করুন" }]);

  // ── Message templates ────────────────────────────────────────────────────
  await admin(h, P, "বার্তা টেমপ্লেট", "ops-message-templates");
  await h.shot(P, "ops-message-templates", 1, [{ text: "পাঠ নোট প্রকাশিত — শিরোনাম" }]);
  await h.tap(P, "পাঠ নোট প্রকাশিত — শিরোনাম", 3500);
  await h.shot(P, "ops-message-templates", 2, [{ text: "বাংলা বার্তা" }, { text: "অনুমোদিত প্লেসহোল্ডার (চেপে যোগ করুন)" }, { text: "সংরক্ষণ করুন" }]);
};
