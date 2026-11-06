/**
 * Capture spec — school operations (ops area): the admin Today dashboard, the library desk and
 * catalogue, the script-archive boxes, class and subject teachers, শাখা merge/split, academic years.
 *
 * LOCAL ONLY: it issues a book, adds a book, a box, a class teacher, a subject teacher and the
 * 2027 year, and merges then splits ৩য় শ্রেণি. Data: scripts/help/fixtures/ops.ts. Run it after
 * ops-comms (the ৩য় বালক notice) since the merge briefly folds that শাখা.
 */
const { PASSWORD, menu, reveal, fill, home } = require("./ops-common.cjs");

async function admin(h, page, item, guide) {
  await home(page);
  await menu(h, page, "প্রশাসন");
  if (guide) await h.shot(page, guide, 0, [{ text: item }]);
  await h.tap(page, item, 3500);
}

/** Pick a name in the searchable select that `placeholder` opens. */
async function pick(h, page, placeholder, name, minY) {
  await h.tap(page, { text: placeholder, minY }, 1500);
  await h.tap(page, { text: name, last: true }, 1500);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("ops-school saves while it walks; run it locally (see its header)");

  // ── Office: dashboard, library, archive ──────────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await h.shot(O, "ops-admin-dashboard", 0, [{ text: "এখন যে ক্লাসগুলো চলছে" }, { text: "উপস্থিতি", minY: 120 }]);
  await reveal(O, { text: "রিপোর্ট" });
  await h.shot(O, "ops-admin-dashboard", 1, [{ text: "প্রিন্ট কিউ", minY: 80 }, { text: "রিপোর্ট", minY: 80 }]);

  await menu(h, O, "লাইব্রেরি");
  await h.shot(O, "ops-library-issue", 0, [{ text: "ডেস্ক (ইস্যু/ফেরত)" }]);
  await h.tap(O, "ডেস্ক (ইস্যু/ফেরত)", 3000);
  await fill(h, O, { css: "input" }, "তানভীর", 2500);
  await h.shot(O, "ops-library-issue", 1, [{ text: "শিক্ষার্থী" }, { css: "input" }, { text: "তানভীর আহমেদ" }]);
  await h.shot(O, "ops-library-return", 0, [{ css: "input" }]);
  await h.tap(O, "তানভীর আহমেদ", 2500);
  await h.shot(O, "ops-library-return", 1, [
    { text: "পাঠকের ইস্যু করা বই" },
    { text: "ফেরত" },
    { text: "নবায়ন" },
    { text: "হারানো ঘোষণা" },
  ]);
  await fill(h, O, { css: "input" }, "LIB-001", 800);
  await h.shot(O, "ops-library-issue", 2, [{ css: "input" }, { text: "ইস্যু করুন", last: true }]);
  await h.tap(O, { text: "ইস্যু করুন", last: true }, 3000);

  await home(O);
  await menu(h, O, "লাইব্রেরি");
  await h.shot(O, "ops-library-add-book", 0, [{ text: "ক্যাটালগ ব্যবস্থাপনা" }]);
  await h.tap(O, "ক্যাটালগ ব্যবস্থাপনা", 3000);
  await fill(h, O, { css: "input" }, "গোপাল ভাঁড়ের গল্প", 800);
  await h.shot(O, "ops-library-add-book", 1, [{ css: "input" }, { text: "নতুন বই যোগ করুন", last: true }]);
  await h.tap(O, { text: "নতুন বই যোগ করুন", last: true }, 3000);
  await h.tap(O, "গোপাল ভাঁড়ের গল্প", 2500);
  await reveal(O, { text: "কপি যোগ করুন" });
  await fill(h, O, { css: "input", last: true }, "LIB-005", 800);
  await h.shot(O, "ops-library-add-book", 2, [{ css: "input", last: true }, { text: "কপি যোগ করুন" }]);
  await h.tap(O, "কপি যোগ করুন", 2500);

  await home(O);
  await menu(h, O, "ক্লাস টেস্ট", "ট্র্যাকার");
  await h.shot(O, "ops-archive-box", 0, [{ text: "খাতা আর্কাইভ (স্ক্রিপ্ট সংরক্ষণ)" }]);
  await h.tap(O, "খাতা আর্কাইভ (স্ক্রিপ্ট সংরক্ষণ)", 3000);
  await h.shot(O, "ops-archive-find", 0, [
    { placeholder: "টেস্ট আইডি খুঁজুন" },
    { re: "^BX-2026-01" },
    { text: "বের করা বান্ডিল" },
  ]);
  await fill(h, O, { placeholder: "বাক্সের নাম" }, "৩য় শ্রেণি · ২০২৬", 500);
  await fill(h, O, { placeholder: "অবস্থান" }, "অফিস আলমারি, তাক ৩", 800);
  await h.shot(O, "ops-archive-box", 1, [{ placeholder: "বাক্সের নাম" }, { placeholder: "অবস্থান" }, { text: "বাক্স তৈরি করুন" }]);
  await h.tap(O, "বাক্স তৈরি করুন", 3000);

  // ── Principal: teachers, শাখা, years ─────────────────────────────────────
  const P = (await h.login("principal@help.test", PASSWORD)).page;
  await admin(h, P, "শ্রেণি শিক্ষক নির্ধারণ", "ops-class-teacher");
  await reveal(P, { text: "ক" });
  await h.shot(P, "ops-class-teacher", 1, [{ text: "ক" }]);
  await h.tap(P, "ক", 2500);
  await h.shot(P, "ops-class-teacher", 2, [{ text: "শিক্ষক নির্বাচন করুন…" }, { text: "নির্ধারণ করুন" }], {
    anchor: { text: "বর্তমান শ্রেণি শিক্ষক" },
  });
  await pick(h, P, "শিক্ষক নির্বাচন করুন…", "উদাহরণ ইংরেজি শিক্ষক");
  await h.tap(P, "নির্ধারণ করুন", 3000);

  await admin(h, P, "বিষয়শিক্ষক নিয়োগ", "ops-subject-teacher");
  await h.tap(P, "৫", 3000);
  await h.shot(P, "ops-subject-teacher", 1, [
    { text: "৫" },
    { text: "বিষয় নির্বাচন করুন…" },
    { text: "শিক্ষক নির্বাচন করুন…" },
    { text: "নিয়োগ দিন" },
  ]);
  await pick(h, P, "বিষয় নির্বাচন করুন…", "গণিত");
  await pick(h, P, "শিক্ষক নির্বাচন করুন…", "উদাহরণ শ্রেণি শিক্ষক");
  await h.tap(P, "নিয়োগ দিন", 4000);
  await h.tap(P, { re: "^(রুটিন আপডেট করুন|ঠিক আছে|OK)$" }, 2000).catch(() => {});
  await h.shot(P, "ops-subject-teacher", 2, [{ text: "সরান" }]);

  await admin(h, P, "শিক্ষাবর্ষ ব্যবস্থাপনা", "ops-academic-year");
  await fill(h, P, { placeholder: "২০২৭" }, "2027", 800).catch(async () => fill(h, P, { css: "input" }, "2027", 800));
  await h.shot(P, "ops-academic-year", 1, [{ css: "input" }, { text: "এটিকে চলতি বছর করুন" }, { text: "নতুন শিক্ষাবর্ষ যোগ করুন", last: true }]);
  await h.tap(P, { text: "নতুন শিক্ষাবর্ষ যোগ করুন", last: true }, 3000);
  await h.shot(P, "ops-academic-year", 2, [{ text: "চলতি করুন" }]);

  await admin(h, P, "শাখা বিন্যাস", "ops-section-merge");
  await h.shot(P, "ops-section-merge", 1, [{ placeholder: "সম্মিলিত" }, { text: "শাখা একত্র করুন" }]);
  await h.tap(P, "শাখা একত্র করুন", 3000);
  await h.tap(P, { re: "^(একত্র করুন|ঠিক আছে|OK)$", last: true }, 3000).catch(() => {});
  await h.shot(P, "ops-section-merge", 2, [{ text: "আবার আলাদা করুন" }]);
  await h.tap(P, "আবার আলাদা করুন", 3000);
  await h.tap(P, { re: "^(আলাদা করুন|ঠিক আছে|OK)$", last: true }, 3000).catch(() => {});
};
