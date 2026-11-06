/**
 * Capture spec — students, guardian logins, student profile, monthly report, progress board,
 * improvement actions and guardian app usage (family area). LOCAL ONLY: it creates a family
 * login, resets a password, links a child, approves and releases a report, starts an
 * improvement action and ticks one. Data: scripts/help/fixtures/family.ts (--reset first).
 */
const { wrap, session, fresh, menuShot, shotAt, reveal, fillAfter } = require("./family-lib.cjs");

async function adminCard(h, page, guide, card) {
  await menuShot(h, page, guide, 0, "প্রশাসন");
  await h.shot(page, guide, 1, [{ text: card }]);
  await h.tap(page, card, 3500);
}

async function reportCard(h, page, guide, card) {
  await shotAt(h, page, guide, 0, [{ text: "রিপোর্ট" }], { text: "রিপোর্ট" });
  await h.tap(page, "রিপোর্ট", 3500);
  await shotAt(h, page, guide, 1, [{ re: `${card}$` }], { re: `${card}$` });
  await h.tap(page, { re: `${card}$` }, 4000);
}

async function pick(h, page, opener, option) {
  await h.tap(page, opener, 1200);
  await h.tap(page, { text: option, last: true }, 1500);
}

exports.run = async (h0) => {
  const h = wrap(h0);
  if (h.PROD) throw new Error("the family specs save while they walk; run them locally");
  const O = (await session(h, "office@help.test")).page;

  // ── Students ──
  await adminCard(h, O, "family-student-list", "শিক্ষার্থী তালিকা");
  await h.shot(O, "family-student-list", 2, [{ text: "সব শ্রেণি" }, { placeholder: "নাম, আইডি বা ফোন" }, { text: "আরিফ হোসেন" }]);
  await h.shot(O, "family-student-profile", 0, [{ text: "আরিফ হোসেন" }]);
  await h.tap(O, "আরিফ হোসেন", 5000);
  await h.shot(O, "family-student-profile", 1, [{ text: "ড্যাশবোর্ড" }, { text: "উপস্থিতি" }, { text: "প্রোফাইল প্রিন্ট (PDF)" }]);

  // ── Guardian logins ──
  await fresh(h, O);
  await adminCard(h, O, "family-guardian-login", "অভিভাবক লগইন");
  await O.getByPlaceholder("নাম, আইডি বা ফোন").locator("visible=true").first().fill("01900000024");
  await O.waitForTimeout(2500);
  await h.shot(O, "family-guardian-login", 2, [{ text: "পরিবার খুঁজুন" }, { text: "লগইন তৈরি করুন" }]);
  await h.tap(O, "লগইন তৈরি করুন", 4000);
  await h.shot(O, "family-guardian-login", 3, [{ text: "হোয়াটসঅ্যাপে পাঠান" }]);

  await fresh(h, O);
  await adminCard(h, O, "family-guardian-reset", "অভিভাবক লগইন");
  await O.getByPlaceholder("নাম, আইডি বা ফোন").locator("visible=true").first().fill("01900000012");
  await O.waitForTimeout(2500);
  await h.shot(O, "family-guardian-reset", 2, [{ text: "পরিবার খুঁজুন" }, { text: "পাসওয়ার্ড রিসেট" }]);

  await fresh(h, O);
  await adminCard(h, O, "family-guardian-link", "অভিভাবক লগইন");
  await reveal(O, "অভিভাবক + শিক্ষার্থী লিংক");
  await pick(h, O, "শ্রেণি নির্বাচন করুন…", "৩য় শ্রেণি");
  await pick(h, O, "শাখা নির্বাচন করুন…", "বালক");
  await pick(h, O, { text: "অভিভাবক বাছুন", last: true }, "উদাহরণ তানভীরের মা");
  await pick(h, O, { text: "শিক্ষার্থী বাছুন", last: true }, "ফাহিম রহমান");
  await O.getByPlaceholder("যেমন: বাবা").locator("visible=true").first().fill("মা");
  await shotAt(h, O, "family-guardian-link", 2, [
    { text: "শ্রেণি", exact: true },
    { text: "অভিভাবক বাছুন" },
    { text: "শিক্ষার্থী বাছুন" },
    { text: "সম্পর্ক" },
    { text: "লিংক করুন" },
  ], { text: "অভিভাবক + শিক্ষার্থী লিংক" });
  await h.tap(O, "লিংক করুন", 3000);

  // ── Monthly report ──
  await fresh(h, O);
  await reportCard(h, O, "family-monthly-build", "মাসিক অগ্রগতি রিপোর্ট");
  await h.shot(O, "family-monthly-build", 2, [{ text: "শাখা" }, { text: "মাস" }, { text: "রিপোর্ট তৈরি/হালনাগাদ" }, { re: "^মন্তব্য তৈরি করুন \\(যাদের নেই\\)" }]);
  await h.shot(O, "family-monthly-release", 0, [{ re: "^নাঈম উদ্দিন — সংস্করণ" }]);
  await h.tap(O, { re: "^নাঈম উদ্দিন — সংস্করণ" }, 4000);
  await shotAt(h, O, "family-monthly-release", 1, [{ text: "অভিভাবকের জন্য মন্তব্য" }, { text: "মন্তব্য অনুমোদন" }], { text: "অভিভাবকের জন্য মন্তব্য" });
  await h.tap(O, "মন্তব্য অনুমোদন", 4000);
  await shotAt(h, O, "family-monthly-release", 2, [{ text: "প্রকাশ করুন" }], { text: "অভিভাবকের জন্য মন্তব্য" });
  await h.tap(O, "প্রকাশ করুন", 4000);
  await fresh(h, O);
  await h.tap(O, "রিপোর্ট", 3500);
  await h.tap(O, { re: "মাসিক অগ্রগতি রিপোর্ট$" }, 4000);
  await h.shot(O, "family-monthly-release", 3, [{ text: "সব নির্বাচন" }]);

  // ── Progress board and a new improvement action ──
  await fresh(h, O);
  await menuShot(h, O, "family-progress-board", 0, "শিক্ষার্থীর অগ্রগতি", "ট্র্যাকার");
  await h.shot(O, "family-progress-board", 1, [{ text: "ঝুঁকিতে" }, { text: "কাজ দেওয়া হয়নি" }]);
  await shotAt(h, O, "family-progress-board", 2, [{ text: "মনোযোগ দরকার — পুরো স্কুল" }], { text: "মনোযোগ দরকার — পুরো স্কুল" });
  await shotAt(h, O, "family-improvement-start", 0, [{ text: "নাঈম উদ্দিন" }], { text: "মনোযোগ দরকার — পুরো স্কুল" });
  await h.tap(O, "নাঈম উদ্দিন", 4000);
  await shotAt(h, O, "family-improvement-start", 1, [{ text: "+ নতুন কাজ" }], { text: "বিষয় অনুযায়ী" });
  await h.tap(O, "+ নতুন কাজ", 4000);
  await fillAfter(O, "কারণ", "শেষ দুই ক্লাস টেস্টে বাংলায় নম্বর কমেছে");
  await fillAfter(O, "শিক্ষক প্রতিদিন কী করবেন", "ক্লাস শেষে ৫টি শব্দের বানান লিখতে দিন");
  await fillAfter(O, "অভিভাবক প্রতিদিন কী নিশ্চিত করবেন", "বাড়িতে ১০ মিনিট বাংলা পড়ান");
  await fillAfter(O, "কত স্কুল দিন", "10");
  await shotAt(h, O, "family-improvement-start", 2, [{ text: "বিষয়" }, { text: "কারণ" }, { text: "শিক্ষক প্রতিদিন কী করবেন" }], { text: "বিষয়" });
  await shotAt(h, O, "family-improvement-start", 3, [{ text: "অভিভাবক প্রতিদিন কী নিশ্চিত করবেন" }, { text: "কত স্কুল দিন" }, { text: "কাজটি দিন" }], { text: "অভিভাবক প্রতিদিন কী নিশ্চিত করবেন" });
  await h.tap(O, "কাজটি দিন", 4000);

  // ── Teacher ticks today's task ──
  const T = (await session(h, "teacher@help.test")).page;
  await h.shot(T, "family-improvement-tick", 0, [{ text: "আজকের উন্নতির কাজ" }]);
  await h.tap(T, "আজকের উন্নতির কাজ", 2500);
  await shotAt(h, T, "family-improvement-tick", 1, [{ text: "আজ করেছি" }, { text: "আজ পারিনি" }], { text: "আজকের উন্নতির কাজ" });
  await h.tap(T, "আজ করেছি", 3000);

  // ── Principal: guardian app usage ──
  const P = (await session(h, "principal@help.test")).page;
  await reportCard(h, P, "family-guardian-engagement", "অভিভাবকদের ব্যবহার");
  await h.shot(P, "family-guardian-engagement", 2, [{ text: "সময়সীমা" }, { text: "পরিবার" }, { text: "পর্দা" }]);
};
