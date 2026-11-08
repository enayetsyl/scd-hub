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
  // A failed earlier run may have left the teacher role changed: put it back first.
  await h.tap(P, { re: "^ডিফল্টে ফেরত নিন" }, 3500).catch(() => {});
  await h.shot(P, "ops-access-role", 0, [{ text: "সবাইকে দিন (ভূমিকা অনুযায়ী)" }, { text: "শিক্ষক" }]);
  await fill(h, P, { placeholder: "খুঁজুন (সুবিধা বা কাজ)" }, "প্রিন্ট", 2000);
  await reveal(P, { text: "প্রিন্ট" });
  await h.shot(P, "ops-access-role", 1, [{ text: "প্রিন্ট", minY: 80 }, { text: "বন্ধ" }], { anchor: { text: "প্রিন্ট", minY: 80 } });
  // Switch one action on for every teacher, shoot the reset, then reset (back to the default).
  await (await h.topmost(P, { text: "বন্ধ" }, { scroll: false })).click();
  await P.waitForTimeout(3000);
  const RESET = { re: "^ডিফল্টে ফেরত নিন" };
  await reveal(P, RESET);
  await h.shot(P, "ops-access-role", 2, [RESET]);
  await h.tap(P, RESET, 3500);

  await h.tap(P, "একজনকে দিন (ব্যক্তি অনুযায়ী)", 3000);
  await h.shot(P, "ops-access-person", 1, [{ text: "একজনকে দিন (ব্যক্তি অনুযায়ী)" }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 4000);
  await fill(h, P, { placeholder: "খুঁজুন (সুবিধা বা কাজ)" }, "প্রিন্ট", 1500);
  await h.shot(P, "ops-access-person", 2, [{ placeholder: "খুঁজুন (সুবিধা বা কাজ)" }]);
  await reveal(P, { text: "প্রিন্ট" });
  await h.shot(P, "ops-access-person", 3, [{ text: "প্রিন্ট", minY: 80 }, { text: "বন্ধ" }], { anchor: { text: "প্রিন্ট", minY: 80 } });

  // ── View as ──────────────────────────────────────────────────────────────
  await home(P);
  await h.shot(P, "ops-view-as", 0, [{ text: "👤" }]);
  await h.tap(P, "👤", 1500);
  await h.tap(P, "কার হয়ে দেখবেন", 3000);
  await h.shot(P, "ops-view-as", 1, [{ text: "শিক্ষক ও অফিস" }, { css: "input" }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 7000);
  await h.shot(P, "ops-view-as", 2, [{ text: "ফিরে যান" }]);
  await h.tap(P, "ফিরে যান", 7000);

  // ── Staff logins ─────────────────────────────────────────────────────────
  await admin(h, P, "ব্যবহারকারী", "ops-staff-login-create");
  await reveal(P, { text: "ব্যবহারকারী তৈরি" });
  await fill(h, P, nth(1), "উদাহরণ নতুন শিক্ষক", 300);
  await fill(h, P, nth(2), "newteacher@help.test", 300);
  await fill(h, P, { css: 'input[type="password"]' }, PASSWORD, 300);
  await h.tap(P, { text: "TEACHER", last: true }, 800);
  await h.shot(P, "ops-staff-login-create", 1, [nth(1), nth(2), { css: 'input[type="password"]' }, { text: "TEACHER", last: true }, { text: "ব্যবহারকারী তৈরি", last: true }]);
  await h.tap(P, { text: "ব্যবহারকারী তৈরি", last: true }, 3500);

  await home(P);
  await menu(h, P, "প্রশাসন");
  await h.tap(P, "ব্যবহারকারী", 3500);
  await fill(h, P, { placeholder: "নাম, ইমেইল বা ফোন দিয়ে খুঁজুন" }, "নতুন শিক্ষক", 1500);
  await h.shot(P, "ops-staff-password-reset", 0, [{ placeholder: "নাম, ইমেইল বা ফোন দিয়ে খুঁজুন" }]);
  await h.tap(P, "নতুন পাসওয়ার্ড তৈরি", 3500);
  await h.shot(P, "ops-staff-password-reset", 1, [{ text: "নতুন পাসওয়ার্ড তৈরি" }, { re: "^লগইন আইডি" }]);

  // ── Audit log, activity ──────────────────────────────────────────────────
  await admin(h, P, "অডিট লগ", "ops-audit-log");
  await h.shot(P, "ops-audit-log", 1, [{ css: "input" }, { text: "সব" }, { text: "উদাহরণ অধ্যক্ষ" }]);

  await admin(h, P, "কার্যক্রম", "ops-person-activity");
  await fill(h, P, { css: "input" }, "শ্রেণি", 1500);
  await h.shot(P, "ops-person-activity", 1, [{ css: "input" }, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }]);
  await h.tap(P, { text: "উদাহরণ শ্রেণি শিক্ষক", minY: 80 }, 4000);
  await h.tap(P, "৩০ দিন", 3000);
  await h.shot(P, "ops-person-activity", 2, [{ text: "৩০ দিন" }, { text: "অন্য কাউকে দেখুন" }]);

  // ── System health, AI key ────────────────────────────────────────────────
  await admin(h, P, "সিস্টেমের অবস্থা", "ops-system-health");
  // The health read measures the disk and database: give it time.
  await P.getByText("ডেটাবেজ", { exact: true }).locator("visible=true").first().waitFor({ timeout: 120000 });
  await h.shot(P, "ops-system-health", 1, [{ text: "ডেটাবেজ" }]);
  await reveal(P, { text: "ব্যাকআপ" });
  await h.shot(P, "ops-system-health", 2, [{ re: "^স্বয়ংক্রিয় কাজ" }, { text: "ব্যাকআপ" }]);

  // D-#1090: one key + model per AI service — Gemini first, then the DeepSeek chip.
  await admin(h, P, "এআই কী ও মডেল", "ops-ai-key");
  await h.shot(P, "ops-ai-key", 1, [{ text: "Gemini" }, { css: ":nth-match(input, 1)" }, { css: ":nth-match(input, 2)" }, { text: "পরীক্ষা করে সংরক্ষণ করুন" }]);
  await h.tap(P, "DeepSeek", 3000);
  await h.shot(P, "ops-ai-key", 2, [{ text: "DeepSeek" }, { css: ":nth-match(input, 1)" }, { re: "^DeepSeek শুধু নতুন এআই সুবিধায়" }]);

  // AI-3 (D-#1093): the AI rules — the server seeds the proposed standards as OFF v1 on boot.
  await admin(h, P, "এআই-এর নিয়ম ও মানদণ্ড", "ops-ai-rules");
  await h.shot(P, "ops-ai-rules", 1, [{ text: "দৈনিক মন্তব্যের মানদণ্ড" }]);
  await h.tap(P, "দৈনিক মন্তব্যের মানদণ্ড", 3500);
  await h.shot(P, "ops-ai-rules", 2, [{ re: "^সংস্করণ ১ · খসড়া|^সংস্করণ 1 · খসড়া" }, { text: "এই সংস্করণ চালু করুন" }, { text: "এটি বদলে নতুন সংস্করণ লিখুন" }]);
  await h.tap(P, "এটি বদলে নতুন সংস্করণ লিখুন", 3500);
  await h.shot(P, "ops-ai-rules", 3, [{ css: "textarea" }, { text: "নতুন সংস্করণ সংরক্ষণ করুন" }]);

  // ── Message templates ────────────────────────────────────────────────────
  await admin(h, P, "বার্তা টেমপ্লেট", "ops-message-templates");
  await h.shot(P, "ops-message-templates", 1, [{ text: "পাঠ নোট প্রকাশিত — বার্তা" }]);
  await h.tap(P, "পাঠ নোট প্রকাশিত — বার্তা", 3500);
  await h.shot(P, "ops-message-templates", 2, [{ text: "বাংলা বার্তা" }, { text: "অনুমোদিত প্লেসহোল্ডার (চেপে যোগ করুন)" }, { text: "সংরক্ষণ করুন" }]);
};
