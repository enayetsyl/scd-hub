/**
 * Capture spec — notes & guides and the English drive (content area).
 *
 * LOCAL ONLY: the walk writes a suggestion, uploads a note and a drive document, and marks a
 * suggestion addressed. Data: scripts/help/fixtures/content.ts.
 *   teacher  (৩য় গণিত/বাংলা) reads a note, suggests a change, fills the print card;
 *   office   uploads a note, handles open suggestions, uploads a drive document;
 *   teacher2 (৫ম English) opens a drive document and fills its print card.
 */
const L = require("./content-lib.cjs");

const NOTE_MD = `# গণিত: বিয়োগের উত্তর লেখার নিয়ম

## হিসাব করা
1. বড় সংখ্যাটি ওপরে, ছোটটি নিচে লেখো।
2. এককের ঘর থেকে বিয়োগ শুরু করো।

## উত্তর লেখা
- শেষে একটি পূর্ণ বাক্যে উত্তর লেখো।
`;

const DRIVE_MD = `# Block 2 — Homework 1

1. Write three things you can see in your classroom.
2. Draw your school bag and write its colour.
`;

exports.run = async (h) => {
  if (h.PROD) throw new Error("the content-notes spec saves while it walks; run it locally (see its header)");

  // ── teacher: read, suggest, print card ───────────────────────────────────
  const T = await L.login(h, "teacher@help.test");
  await L.menuShot(h, T, "content-tn-read", 0, "একাডেমিক", "নোট ও গাইড");
  await L.pick(h, T, { text: "বিষয়", exact: true, minY: 80 }, "গণিত");
  await h.shot(T, "content-tn-read", 1, [{ text: "গণিত", minY: 80 }, { re: "উত্তর লেখার গাইড$" }, { text: "যোগের উত্তর লেখার নিয়ম" }]);
  await h.tap(T, "যোগের উত্তর লেখার নিয়ম", 4000);

  await L.fill(h, T, { placeholder: "কী উন্নত করা যায় লিখুন" }, "শেষে দুটি অনুশীলনীর প্রশ্ন দিলে শিক্ষার্থীরা নিজে চেষ্টা করতে পারবে।");
  await L.fill(h, T, { css: "input", last: true }, "উত্তর লেখা");
  await L.scrollTo(h, T, { placeholder: "কী উন্নত করা যায় লিখুন" }, 120);
  await h.shot(T, "content-tn-comment", 0, [
    { placeholder: "কী উন্নত করা যায় লিখুন" },
    { text: "কোন অংশ (ঐচ্ছিক)" },
    { text: "পরামর্শ দিন", last: true },
  ]);
  await h.tap(T, { text: "পরামর্শ দিন", last: true }, 3000);

  await L.scrollTo(h, T, { re: "প্রিন্টে পাঠান$" }, 200);
  await h.shot(T, "content-tn-print", 0, [{ re: "প্রিন্টে পাঠান$" }]);
  await h.tap(T, { re: "প্রিন্টে পাঠান$" }, 2000);
  await L.scrollTo(h, T, { text: "কোন শ্রেণি / শাখার জন্য" }, 60);
  await h.shot(T, "content-tn-print", 1, [
    { text: "কোন শ্রেণি / শাখার জন্য" },
    { text: "কপি সংখ্যা" },
    { text: "যেদিন প্রিন্ট ব্যবহার হবে" },
    { text: "প্রিন্টে পাঠান", last: true },
  ]);
  await T.context().close();

  // ── office: upload a note, open suggestions, upload a drive document ─────
  const O = await L.login(h, "office@help.test");
  await L.menuShot(h, O, null, 0, "একাডেমিক", "নোট ও গাইড");
  await h.shot(O, "content-tn-upload", 0, [{ re: "নতুন নোট$" }]);
  await h.shot(O, "content-tn-feedback", 0, [{ re: "বাকি পরামর্শ$" }]);
  await h.tap(O, { re: "নতুন নোট$" }, 3500);
  await L.chooseFiles(h, O, "ফাইল বাছুন (.md / PDF / Word)", [L.tmpFile("biyog-niyom.md", NOTE_MD)]);
  await L.pick(h, O, { text: "শ্রেণি", exact: true, minY: 80 }, "শ্রেণি ৩");
  await L.pick(h, O, { text: "বিষয়", exact: true, minY: 80 }, "গণিত");
  await L.pick(h, O, { text: "ধরন", exact: true, minY: 80 }, "উত্তর লেখার গাইড");
  await h.shot(O, "content-tn-upload", 1, [
    { text: "ফাইল বাছুন (.md / PDF / Word)" },
    { text: "শ্রেণি", exact: true, last: true, minY: 80 },
    { text: "বিষয়", exact: true, last: true, minY: 80 },
    { text: "ধরন", exact: true, last: true, minY: 80 },
    { text: "শিরোনাম", exact: true, last: true },
  ]);
  await L.scrollTo(h, O, { text: "শিরোনাম", exact: true, last: true });
  await h.shot(O, "content-tn-upload", 2, [{ text: "নতুন নোট", last: true, minY: 120 }]);
  await h.tap(O, { text: "নতুন নোট", last: true, minY: 120 }, 4000);

  await L.home(O);
  await L.menuShot(h, O, null, 0, "একাডেমিক", "নোট ও গাইড");
  await h.tap(O, { re: "বাকি পরামর্শ$" }, 3500);
  await h.shot(O, "content-tn-feedback", 1, [{ re: "^শেষে দুটি অনুশীলনীর" }]);
  await h.tap(O, { re: "^শেষে দুটি অনুশীলনীর" }, 4000);
  await L.scrollTo(h, O, { text: "পরামর্শ", exact: true });
  await h.shot(O, "content-tn-feedback", 2, [{ text: "সমাধান হয়েছে", last: true }]);
  await h.tap(O, { text: "সমাধান হয়েছে", last: true }, 2500);

  await L.home(O);
  await L.menuShot(h, O, null, 0, "একাডেমিক", "ইংরেজি ড্রাইভ");
  await h.shot(O, "content-ed-upload", 0, [{ re: "ডকুমেন্ট আপলোড$" }]);
  await h.tap(O, { re: "ডকুমেন্ট আপলোড$" }, 3500);
  await L.chooseFiles(h, O, "ফাইল বাছাই (.md / PDF / DOCX)", [L.tmpFile("Block2-HW1.md", DRIVE_MD)]);
  await h.shot(O, "content-ed-upload", 1, [
    { text: "ফাইল বাছাই (.md / PDF / DOCX)" },
    { text: "শ্রেণি", exact: true, minY: 80 },
    { text: "ডকুমেন্টের ধরন" },
    { text: "ব্লক নম্বর" },
  ]);
  await L.scrollTo(h, O, { text: "শিরোনাম", exact: true });
  await h.shot(O, "content-ed-upload", 2, [{ re: "^সবগুলো আপলোড করুন" }]);
  await O.context().close();

  // ── teacher2: open a drive document, print card ──────────────────────────
  const T2 = await L.login(h, "teacher2@help.test");
  await L.menuShot(h, T2, "content-ed-read", 0, "একাডেমিক", "ইংরেজি ড্রাইভ");
  await L.pick(h, T2, { text: "শ্রেণি", exact: true, minY: 80 }, "শ্রেণি ৫");
  await h.shot(T2, "content-ed-read", 1, [{ text: "শ্রেণি", exact: true, minY: 80 }, { re: "ব্লক ১$" }, { text: "Greetings and names" }]);
  await h.tap(T2, "Greetings and names", 4000);
  await h.shot(T2, "content-ed-print", 0, [{ text: "সম্পাদনা করে প্রিন্ট" }, { text: "PDF প্রিভিউ" }, { re: "প্রিন্টে পাঠান$" }]);
  await h.tap(T2, "সম্পাদনা করে প্রিন্ট", 2000);
  await L.scrollTo(h, T2, { text: "লেখার আকার" }, 60);
  await h.shot(T2, "content-ed-print", 1, [{ text: "লেখার আকার" }, { text: "বিষয়বস্তু (মার্কডাউন)" }]);
  await h.tap(T2, { re: "প্রিন্টে পাঠান$" }, 2000);
  await L.scrollTo(h, T2, { text: "কোন শ্রেণি / শাখার জন্য" }, 60);
  await h.shot(T2, "content-ed-print", 2, [{ text: "কোন শ্রেণি / শাখার জন্য" }, { text: "কপি সংখ্যা" }, { text: "প্রিন্টে পাঠান", last: true }]);
};
