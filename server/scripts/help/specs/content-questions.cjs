/**
 * Capture spec — content import, the question bank and the question review loop (content area).
 *
 * LOCAL ONLY: the walk imports a plan and a bank, reviews, assigns and publishes questions,
 * and builds a set. Data: scripts/help/fixtures/content.ts.
 *   teacher  (the question reviewer) accepts a বাংলা question;
 *   office   imports, assigns reviewers, looks at progress, opens a question to correct it;
 *   principal publishes an accepted question;
 *   teacher2 (C5 teacher) finds questions and builds a set.
 */
const fs = require("node:fs");
const path = require("node:path");
const L = require("./content-lib.cjs");

/** A new plan (session 5) and a new bank (Math Unit 10), made from the docs/examples files. */
function importFiles(repoRoot) {
  const env = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/examples/envelope_C5_ENG_U09_S01.json"), "utf8"));
  env.review_status = "draft";
  env.tags.lesson_ref = "C5-ENG-U09-S05";
  env.provenance.source_filename = "C5_ENG_U09_S05.json";
  env.payload.session_plan.period_index = 5;
  env.rendered_markdown = String(env.rendered_markdown).replace("পিরিয়ড 1:", "পিরিয়ড 5:").replace("(1/5)", "(5/5)");
  const bank = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/examples/LOCKED_QuestionBank_Examples_v1.json"), "utf8"));
  const math = JSON.stringify({
    stimuli: bank.stimuli.filter((s) => s.stimulus_id.includes("-MATH-")),
    questions: bank.questions.filter((q) => q.qid.includes("-MATH-")),
  }).split("C5-U09").join("C5-U10");
  return {
    plan: L.tmpFile("C5_ENG_U09_S05.json", JSON.stringify(env, null, 1)),
    bank: L.tmpFile("C5_MATH_U10_bank_v1.json", math),
  };
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the content-questions spec saves while it walks; run it locally (see its header)");
  const files = importFiles(h.repoRoot);

  // ── teacher: review a question ───────────────────────────────────────────
  const T = await L.login(h, "teacher@help.test");
  await L.menuShot(h, T, "content-qr-review", 0, "একাডেমিক", "পর্যালোচনা");
  await h.shot(T, "content-qr-review", 1, [{ text: "আমার প্রশ্ন পর্যালোচনা" }]);
  await h.tap(T, "আমার প্রশ্ন পর্যালোচনা", 4000);
  await h.tap(T, "শুধু বাকিগুলো", 2500);
  await L.scrollTo(h, T, { text: "শুধু বাকিগুলো" });
  await h.shot(T, "content-qr-review", 2, [{ text: "শুধু বাকিগুলো" }, { text: "গ্রহণ" }, { text: "শর্তসহ অনুমোদন" }, { text: "বাতিল" }]);
  await h.tap(T, "গ্রহণ", 3000);
  await T.context().close();

  // ── office: import a plan and a bank, assign questions, progress, correct ─
  const O = await L.login(h, "office@help.test");
  await L.openItem(h, O, null, null);
  await h.shot(O, "content-import-plan", 0, [{ text: "প্রশাসন" }]);
  await h.tap(O, "প্রশাসন", 3500);
  await h.shot(O, "content-import-plan", 1, [{ text: "কন্টেন্ট ইম্পোর্ট" }]);
  await h.tap(O, "কন্টেন্ট ইম্পোর্ট", 3000);
  await L.chooseFiles(h, O, "ফাইল নির্বাচন (JSON + Markdown)", [files.plan]);
  await h.shot(O, "content-import-plan", 2, [
    { text: "ফাইল নির্বাচন (JSON + Markdown)" },
    { re: "^নির্বাচিত ফাইল" },
    { text: "কন্টেন্ট ইম্পোর্ট", last: true, minY: 120 },
  ]);
  await h.tap(O, { text: "কন্টেন্ট ইম্পোর্ট", last: true, minY: 120 }, 1000);
  await L.waitText(O, "ফলাফল");
  await L.scrollTo(h, O, { text: "ফলাফল" });
  await h.shot(O, "content-import-plan", 3, [{ text: "ফলাফল" }]);

  await L.home(O);
  await L.openItem(h, O, null, null);
  await h.shot(O, "content-import-bank", 0, [{ text: "প্রশাসন" }]);
  await h.tap(O, "প্রশাসন", 3500);
  await h.shot(O, "content-import-bank", 1, [{ text: "কন্টেন্ট ইম্পোর্ট" }]);
  await h.tap(O, "কন্টেন্ট ইম্পোর্ট", 3000);
  await L.chooseFiles(h, O, "ফাইল নির্বাচন (JSON + Markdown)", [files.bank]);
  await h.tap(O, "অপরিবর্তিত", 1000);
  await L.fill(h, O, { placeholder: "Get Ready to Listen" }, "Shapes around us");
  await L.scrollTo(h, O, { text: "ফাইল নির্বাচন (JSON + Markdown)" });
  await h.shot(O, "content-import-bank", 2, [
    { text: "ফাইল নির্বাচন (JSON + Markdown)" },
    { re: "^কিউরেশন ট্যাগ" },
    { re: "^ইউনিট শিরোনাম" },
  ]);
  await h.tap(O, { text: "কন্টেন্ট ইম্পোর্ট", last: true, minY: 120 }, 1000);
  await L.waitText(O, "ফলাফল", 120000);
  await L.scrollTo(h, O, { text: "কন্টেন্ট ইম্পোর্ট", last: true, minY: 120 }, 20);
  await h.shot(O, "content-import-bank", 3, [{ text: "কন্টেন্ট ইম্পোর্ট", last: true, minY: 120 }, { re: "^ইম্পোর্ট সম্পন্ন" }]);

  await L.home(O);
  await L.openItem(h, O, "একাডেমিক", "পর্যালোচনা");
  await h.tap(O, "পর্যালোচনা", 3500);
  await h.shot(O, "content-qr-assign", 0, [{ text: "প্রশ্ন বরাদ্দ" }]);
  await h.shot(O, "content-qr-progress", 0, [{ text: "পর্যালোচনার অগ্রগতি" }]);
  await h.tap(O, "প্রশ্ন বরাদ্দ", 4000);
  await h.tap(O, { text: "বাংলা", minY: 80 }, 1500);
  await h.tap(O, "শ্রেণি ৫", 2500);
  await L.scrollTo(h, O, { text: "প্রশ্ন বরাদ্দ", minY: 70 });
  await h.shot(O, "content-qr-assign", 1, [{ text: "বাংলা", minY: 80 }, { text: "শ্রেণি ৫" }]);
  await h.tap(O, { text: "○" }, 600);
  await h.tap(O, { text: "○" }, 600);
  await L.scrollTo(h, O, { re: "^'পাখির মতো' কবিতার শব্দগুলোর" }, 120);
  await h.shot(O, "content-qr-assign", 2, [{ text: "✓" }]);
  await h.tap(O, "উদাহরণ শ্রেণি শিক্ষক", 1000);
  await L.scrollTo(h, O, { text: "একজন শিক্ষক বাছুন…" });
  await h.shot(O, "content-qr-assign", 3, [{ text: "উদাহরণ শ্রেণি শিক্ষক" }, { text: "একসাথে বরাদ্দ" }, { text: "১৩" }]);
  await h.tap(O, "একসাথে বরাদ্দ", 4000);
  await L.back(O);
  await h.tap(O, "পর্যালোচনার অগ্রগতি", 4000);
  await L.scrollTo(h, O, { text: "এই অংশের সামগ্রিক চিত্র" }, 60);
  await h.shot(O, "content-qr-progress", 1, [{ text: "এই অংশের সামগ্রিক চিত্র" }, { text: "উদাহরণ শ্রেণি শিক্ষক" }, { text: "অপেক্ষমাণ" }]);

  await L.home(O);
  await L.menuShot(h, O, null, 0, "একাডেমিক", "প্রশ্ন");
  await h.tap(O, { re: "^Listen to the library" }, 3500);
  await h.shot(O, "content-qb-edit", 0, [{ text: "সম্পাদনা" }]);
  await h.tap(O, "সম্পাদনা", 2500);
  await L.scrollTo(h, O, { text: "প্রশ্ন সংশোধন" });
  await h.shot(O, "content-qb-edit", 1, [
    { text: "প্রশ্ন", exact: true },
    { text: "নম্বর", exact: true, last: true },
    { text: "সঠিক" },
  ]);
  await L.scrollTo(h, O, { text: "সঠিক", last: true });
  await h.shot(O, "content-qb-edit", 2, [{ text: "সংরক্ষণ করুন" }, { text: "প্রশ্ন বাতিল করুন" }]);
  await O.context().close();

  // ── principal: publish an accepted question ──────────────────────────────
  const P = await L.login(h, "principal@help.test");
  await L.openItem(h, P, "একাডেমিক", "পর্যালোচনা");
  await h.tap(P, "পর্যালোচনা", 3500);
  await h.shot(P, "content-qr-publish", 0, [{ text: "প্রশ্ন প্রকাশ" }]);
  await h.tap(P, "প্রশ্ন প্রকাশ", 4000);
  await h.tap(P, { text: "○" }, 800);
  await L.scrollTo(h, P, { text: "গৃহীত", minY: 70 });
  await h.shot(P, "content-qr-publish", 1, [
    { text: "গৃহীত", minY: 70 },
    { text: "✓" },
    { text: "নির্বাচিতগুলো প্রকাশ করুন" },
    { re: "^সব প্রকাশ করুন" },
  ], { anchor: { text: "গৃহীত", minY: 70 } });
  await h.tap(P, "নির্বাচিতগুলো প্রকাশ করুন", 4000);
  await P.context().close();

  // ── teacher2: find questions, build a set ────────────────────────────────
  const T2 = await L.login(h, "teacher2@help.test");
  await L.menuShot(h, T2, "content-qb-find", 0, "একাডেমিক", "প্রশ্ন");
  await h.shot(T2, "content-qb-find", 1, [{ placeholder: "প্রশ্ন বা কোড খুঁজুন…" }, { text: "ফিল্টার" }]);
  await h.tap(T2, "ফিল্টার", 2000);
  await h.tap(T2, { text: "বাংলা", last: true }, 800);
  await h.tap(T2, { text: "১৩", last: true }, 800);
  await h.shot(T2, "content-qb-find", 2, [{ text: "বাংলা", last: true }, { text: "১৩", last: true }, { text: "দেখুন", last: true }]);
  await h.tap(T2, { text: "দেখুন", last: true }, 3000);
  await h.shot(T2, "content-qb-find", 3, [{ re: "^'পাখির মতো' কবিতায়" }]);

  await h.tap(T2, { css: '[role="checkbox"]' }, 800);
  await h.tap(T2, { css: '[role="checkbox"]', last: true }, 800);
  await h.shot(T2, "content-qb-set", 0, [{ text: "✓" }, { text: "সেট তৈরি করুন" }]);
  await h.tap(T2, "সেট তৈরি করুন", 2500);
  await L.fill(h, T2, { placeholder: "সেটের নাম (ঐচ্ছিক)" }, "অধ্যায় ১৩ ক্লাস টেস্ট");
  await h.tap(T2, "শ্রেণি পরীক্ষা", 1000);
  await h.shot(T2, "content-qb-set", 1, [{ placeholder: "সেটের নাম (ঐচ্ছিক)" }, { text: "সেটের ধরন" }, { text: "শাখা নির্বাচন করুন" }]);
  await h.tap(T2, "শাখা নির্বাচন করুন", 3000);
  await h.shot(T2, "content-qb-set", 2, [{ re: "^৫ম শ্রেণি · ক" }]);
  await h.tap(T2, { re: "^৫ম শ্রেণি · ক" }, 3000);
  await h.tap(T2, "সেট তৈরি করুন", 2500);
  await h.shot(T2, "content-qb-set", 3, [{ text: "তৈরি করুন", last: true }]);
};
