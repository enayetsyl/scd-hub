/**
 * Capture spec — the GUARDIAN app (family area, category "child"). LOCAL ONLY: the walk
 * answers the meeting pop-up, confirms a comment, files a "done at home" claim and a leave
 * application. Data: scripts/help/fixtures/family.ts (run it with --reset before a re-shoot).
 * Login: guardian 01800000001 (আরিফ, ৩য় বালক; নাফিসা, ৩য় বালিকা).
 */
const { wrap, session, fresh, menuShot, onTop, go, shotAt } = require("./family-lib.cjs");

const GUARDIAN = "01800000001";

exports.run = async (h0) => {
  const h = wrap(h0);
  if (h.PROD) throw new Error("the family specs save while they walk; run them locally");
  const G = (await session(h, GUARDIAN)).page;

  // ── Start-up pop-ups, in the order the app shows them ──
  await h.shot(G, "child-meeting-rsvp", 0, [{ text: "সময়টি ঠিক আছে" }, { text: "সময় পরিবর্তন করতে চাই" }, { text: "আসতে পারব না" }]);
  await h.tap(G, "সময় পরিবর্তন করতে চাই", 1500);
  await h.shot(G, "child-meeting-rsvp", 1, [{ text: "০৯:৩০" }, { text: "পাঠান" }]);
  await h.tap(G, "ফিরে যান", 1200);
  await h.tap(G, "সময়টি ঠিক আছে", 3000);

  await G.waitForTimeout(2500);
  await h.shot(G, "child-comment-read", 0, [{ re: "^আজ ক্লাসে মনোযোগ একটু কম ছিল", last: true }, { re: "^পড়েছি" }]);
  await h.tap(G, { re: "^পড়েছি" }, 3000);

  await h.shot(G, "child-popup-answer", 0, [{ text: "বুঝেছি" }, { text: "✕" }]);
  await h.tap(G, "বুঝেছি", 3000);

  // ── আজ ──
  await h.shot(G, "child-meeting-rsvp", 2, [{ text: "সময় নিশ্চিত করেছেন" }]);
  await h.shot(G, "child-home", 0, [{ text: "নাফিসা রহমান" }]);
  await shotAt(h, G, "child-home", 1, [{ text: "আজকের রুটিন" }, { text: "আজ যা পড়ানো হয়েছে" }], { text: "আজকের রুটিন" });
  await shotAt(h, G, "child-home", 2, [{ text: "করতে হবে" }, { text: "সব দেখুন ›" }], { text: "করতে হবে" });

  // ── নাফিসা: the school's task for today ──
  await h.tap(G, "নাফিসা রহমান", 3500);
  await h.shot(G, "child-school-task", 0, [{ text: "নাফিসা রহমান" }]);
  await shotAt(h, G, "child-school-task", 1, [{ text: "স্কুল থেকে আজকের কাজ" }, { text: "আজ করেছি" }], { text: "স্কুল থেকে আজকের কাজ" });
  await h.tap(G, "আজ করেছি", 3000);
  await G.evaluate(() => window.scrollTo(0, 0));
  await h.tap(G, "আরিফ হোসেন", 3500);

  // ── Academic pages ──
  await menuShot(h, G, "child-routine", 0, "রুটিন");
  await h.tap(G, "রবিবার", 1500);
  await h.shot(G, "child-routine", 1, [{ text: "রবিবার" }]);

  await menuShot(h, G, "child-homework", 0, "বাড়ির কাজ");
  await h.shot(G, "child-homework", 1, [{ text: "শুরুর তারিখ" }, { re: "^এখনো বাকি" }]);
  await shotAt(h, G, "child-homework", 2, [{ text: "প্রদান করা হয়েছে", last: true }], { text: "২০২৬-১১-০৫" });

  await fresh(h, G);
  await menuShot(h, G, "child-homework-done-home", 0, "বাড়ির কাজ");
  await h.shot(G, "child-homework-done-home", 1, [{ text: "বাড়িতে সম্পন্ন হয়েছে" }]);
  await h.tap(G, "বাড়িতে সম্পন্ন হয়েছে", 1500);
  const note = await h.topmost(G, { css: "textarea" }, { scroll: false });
  await note.fill("খাতা ব্যাগে দিয়ে দিয়েছি");
  await h.shot(G, "child-homework-done-home", 2, [{ css: "textarea" }, { text: "জানিয়ে দিন" }]);
  await h.tap(G, "জানিয়ে দিন", 3000);

  await menuShot(h, G, "child-class-notes", 0, "ক্লাস নোট");
  await h.shot(G, "child-class-notes", 1, [{ text: "শুরুর তারিখ" }, { re: "^যোগ-বিয়োগের কথার সমস্যা" }]);

  await menuShot(h, G, "child-assignments", 0, "অ্যাসাইনমেন্ট");
  await h.shot(G, "child-assignments", 1, [{ re: "^বিলম্বিত" }, { text: "ফেরত পাওয়া" }]);

  await menuShot(h, G, "child-class-tests", 0, "ক্লাস টেস্ট");
  await shotAt(h, G, "child-class-tests", 1, [{ text: "আসন্ন ক্লাস টেস্ট" }], { text: "আসন্ন ক্লাস টেস্ট" });
  await h.tap(G, { text: "বাংলা", last: true }, 2500);
  await shotAt(h, G, "child-class-tests", 2, [{ text: "বাংলা", last: true }, { re: "^লক্ষণীয় দিক" }], { text: "ক্লাস টেস্টের ফলাফল" });

  await menuShot(h, G, "child-exam-syllabus", 0, "পরীক্ষার সিলেবাস");
  await h.shot(G, "child-exam-syllabus", 1, [{ text: "বার্ষিক পরীক্ষা ২০২৬" }, { text: "বাংলা" }, { text: "🗓️ পরীক্ষার রুটিন দেখুন" }]);
  await h.tap(G, "🗓️ পরীক্ষার রুটিন দেখুন", 3000);
  await h.shot(G, "child-exam-syllabus", 2, [{ re: "^লিখিত · ৭:৩০" }]);

  // ── The Today-stack pages ──
  await menuShot(h, G, "child-attendance", 0, "উপস্থিতি");
  await h.shot(G, "child-attendance", 1, [{ text: "শুরু (YYYY-MM-DD)" }, { re: "^অনুপস্থিত" }]);

  await menuShot(h, G, "child-leave-apply", 0, "ছুটির আবেদন");
  const fields = G.locator("input").locator("visible=true");
  await fields.nth(0).fill("2026-11-09");
  await fields.nth(1).fill("2026-11-10");
  const reason = await h.topmost(G, { css: "textarea" }, { scroll: false }).catch(() => null);
  if (reason) await reason.fill("জ্বর হয়েছে, ডাক্তার দুই দিন বিশ্রাম নিতে বলেছেন।");
  await h.shot(G, "child-leave-apply", 1, [
    { text: "শুরুর তারিখ" },
    { text: "শেষ তারিখ" },
    { text: "কারণ" },
    { text: "ছুটির আবেদন লিখুন", last: true },
  ]);
  await h.tap(G, { text: "ছুটির আবেদন লিখুন", last: true }, 3000);

  await menuShot(h, G, "child-comments", 0, "শিক্ষকের মন্তব্য");
  await h.shot(G, "child-comments", 1, [{ text: "আচরণ · উদ্বেগ" }]);

  await menuShot(h, G, "child-revision", 0, "শনিবারের হিফয রিভিশন");
  await h.shot(G, "child-revision", 1, [{ text: "উপস্থিত" }, { re: "^শিক্ষকের মন্তব্য:" }]);

  await menuShot(h, G, "child-mastery", 0, "শিখন-দক্ষতা");
  await h.shot(G, "child-mastery", 1, [{ re: "^মনোযোগ দরকার" }, { text: "যেখানে একটু সাহায্য দরকার" }]);

  await menuShot(h, G, "child-my-popups", 0, "আমার বার্তা");
  await h.shot(G, "child-my-popups", 1, [{ text: "বার্ষিক পরীক্ষার রুটিন" }]);

  // ── Account menu, then sign out and the login page ──
  await h.shot(G, "child-login", 1, [{ text: "👤" }]);
  await h.tap(G, "👤", 1500);
  await h.shot(G, "child-login", 2, [{ text: "English" }, { re: "লগআউট" }]);
  await h.tap(G, { re: "লগআউট" }, 4000);
  if (await onTop(h, G, { re: "^লগআউট" })) await h.tap(G, { re: "^লগআউট", last: true }, 4000);
  await G.getByPlaceholder("you@school.edu / 01XXXXXXXXX").fill(GUARDIAN);
  await G.locator('input[type="password"]').fill("Help@123");
  await h.shot(G, "child-login", 0, [{ placeholder: "you@school.edu / 01XXXXXXXXX" }, { css: 'input[type="password"]' }, { text: "লগইন", last: true }]);
  void go;
};
