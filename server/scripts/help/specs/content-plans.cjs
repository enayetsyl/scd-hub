/**
 * Capture spec — lesson plans and the plan review loop (content area).
 *
 * LOCAL ONLY: the walk submits a review, assigns reviewers and signs a plan off, because the
 * later screens only exist after those steps. Data: scripts/help/fixtures/content.ts.
 *   teacher2 (C5 English) reads plans and reviews session 2 (changes requested);
 *   office assigns sessions 3–4 and looks at the board;
 *   principal signs session 1 off and opens session 2's thread.
 */
const L = require("./content-lib.cjs");

const FEEDBACK = "প্রথম ধাপে সময় ৪ মিনিটের বদলে ৬ মিনিট দিন, আর শেষে একটি ছোট খেলা যোগ করুন।";

exports.run = async (h) => {
  if (h.PROD) throw new Error("the content-plans spec saves while it walks; run it locally (see its header)");

  // ── teacher2: find a plan, print/PDF, review ─────────────────────────────
  const T = await L.login(h, "teacher2@help.test");
  await L.menuShot(h, T, "content-plan-find", 0, "একাডেমিক", "পাঠ পরিকল্পনা");
  await h.tap(T, "ফিল্টার", 1500);
  await h.tap(T, "ইংরেজি", 1200);
  await h.tap(T, "৫", 1200);
  await h.shot(T, "content-plan-find", 1, [{ text: "ফিল্টার" }, { text: "ইংরেজি" }, { text: "৫" }]);
  await h.tap(T, "ফিল্টার", 1500);
  await h.shot(T, "content-plan-find", 2, [{ text: "পর্যালোচিত" }, { text: "What is an announcement?" }]);
  await h.tap(T, "What is an announcement?", 4000);
  await h.shot(T, "content-plan-print", 0, [{ re: "প্রিন্টে পাঠান$" }, { text: "PDF তৈরি করুন" }]);

  await L.menuShot(h, T, "content-plan-review", 0, "একাডেমিক", "পর্যালোচনা");
  await h.shot(T, "content-plan-review", 1, [{ text: "আমার পর্যালোচনা" }, { text: "অপেক্ষমাণ" }]);
  await h.tap(T, { re: "সেশন ২$" }, 5000);
  await h.tap(T, "পরিবর্তন প্রয়োজন", 1000);
  await L.fill(h, T, { css: "textarea" }, FEEDBACK);
  await L.scrollTo(h, T, { text: "পর্যালোচনা জমা দিন" });
  await h.shot(T, "content-plan-review", 2, [
    { text: "অনুমোদন" },
    { text: "পরিবর্তন প্রয়োজন" },
    { css: "textarea" },
    { text: "পর্যালোচনা জমা দিন", last: true, minY: 120 },
  ]);
  await h.tap(T, { text: "পর্যালোচনা জমা দিন", last: true, minY: 120 }, 4000);
  await T.context().close();

  // ── office: assign sessions 3–4, the board ───────────────────────────────
  const O = await L.login(h, "office@help.test");
  await L.menuShot(h, O, "content-plan-assign", 0, "একাডেমিক", "পর্যালোচনা");
  await h.shot(O, "content-plan-assign", 1, [{ text: "পর্যালোচক বরাদ্দ" }]);
  await h.tap(O, "পর্যালোচক বরাদ্দ", 4000);
  await L.select(h, O, { text: "একজন শিক্ষক বাছুন…", last: true }, "উদাহরণ ইংরেজি শিক্ষক");
  await h.tap(O, "শুধু বরাদ্দহীন", 2000);
  await h.tap(O, { re: "সেশন ৩ · What" }, 800);
  await h.tap(O, { re: "সেশন ৪ · What" }, 800);
  await L.scrollTo(h, O, { text: "পর্যালোচক", exact: true });
  await h.shot(
    O,
    "content-plan-assign",
    2,
    [{ text: "উদাহরণ ইংরেজি শিক্ষক", last: true }, { text: "শুধু বরাদ্দহীন" }, { text: "✓" }, { re: "^নির্বাচিতগুলো বরাদ্দ করুন" }],
    { anchor: { text: "পর্যালোচক", exact: true } },
  );
  await h.tap(O, { re: "^নির্বাচিতগুলো বরাদ্দ করুন" }, 4000);
  await L.back(O);
  await h.shot(O, "content-plan-board", 0, [{ text: "প্ল্যান পর্যালোচনার বরাদ্দ" }]);
  await h.tap(O, "প্ল্যান পর্যালোচনার বরাদ্দ", 4000);
  await h.tap(O, "মতামতের অপেক্ষায়", 2500);
  await h.shot(O, "content-plan-board", 1, [{ re: "^উদাহরণ ইংরেজি শিক্ষক \\(" }, { text: "মতামতের অপেক্ষায়" }]);
  await L.scrollTo(h, O, { re: "^ইংরেজি · শ্রেণি ৫ · Unit" });
  await h.shot(O, "content-plan-board", 2, [{ text: "পর্যালোচক বদল" }, { text: "বরাদ্দ বাতিল" }, { text: "ইতিহাস" }]);
  await O.context().close();

  // ── principal: sign off session 1, open session 2's thread ───────────────
  const P = await L.login(h, "principal@help.test");
  await L.menuShot(h, P, "content-plan-signoff", 0, "একাডেমিক", "পর্যালোচনা");
  await L.scrollTo(h, P, { text: "পর্যালোচনা ইনবক্স" });
  await h.tap(P, { css: '[role="checkbox"]' }, 1000);
  await h.shot(P, "content-plan-signoff", 1, [{ text: "পর্যালোচনা ইনবক্স" }, { text: "✓" }, { re: "^নির্বাচিতগুলো চূড়ান্ত অনুমোদন" }]);
  await h.tap(P, { re: "^নির্বাচিতগুলো চূড়ান্ত অনুমোদন" }, 4000);
  await L.scrollTo(h, P, { text: "পর্যালোচনা ইনবক্স" });
  await h.shot(P, "content-plan-changes", 0, [{ re: "সেশন ২ · What" }]);
  await h.tap(P, { re: "সেশন ২ · What" }, 4000);
  await h.shot(P, "content-plan-changes", 1, [{ text: "মতামত কপি" }]);
  await L.scrollTo(h, P, { text: "পর্যালোচনার জন্য বরাদ্দ" });
  await h.shot(P, "content-plan-changes", 2, [{ text: "শিক্ষক নির্বাচন করুন…" }, { text: "পরবর্তী রাউন্ড বরাদ্দ" }]);
};
