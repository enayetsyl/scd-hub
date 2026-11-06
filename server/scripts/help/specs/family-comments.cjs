/**
 * Capture spec — daily comments (family area). LOCAL ONLY: it saves a comment and sends one.
 * Data: scripts/help/fixtures/family.ts (run it with --reset before a re-shoot).
 */
const { wrap, session, fresh, menuShot } = require("./family-lib.cjs");

exports.run = async (h0) => {
  const h = wrap(h0);
  if (h.PROD) throw new Error("the family specs save while they walk; run them locally");

  // ── Teacher writes a comment ──
  const T = (await session(h, "teacher@help.test")).page;
  await menuShot(h, T, "family-comment-write", 0, "মন্তব্য");
  await h.shot(T, "family-comment-write", 1, [{ text: "দৈনিক মন্তব্য", last: true }]);
  await h.tap(T, { text: "দৈনিক মন্তব্য", last: true }, 3000);
  await h.tap(T, "শ্রেণি নির্বাচন করুন", 1000);
  await h.tap(T, "৩য় শ্রেণি", 1200);
  await h.tap(T, { text: "শাখা নির্বাচন করুন", last: true }, 1000);
  await h.tap(T, "বালক", 2500);
  await h.shot(T, "family-comment-write", 2, [{ text: "বালক", minY: 120 }, { text: "নতুন মন্তব্য" }], { anchor: { text: "শ্রেণি", exact: true } });
  await h.tap(T, "নতুন মন্তব্য", 3000);
  await h.tap(T, "পড়াশোনা / বাড়ির কাজ", 600);
  await h.tap(T, "ইতিবাচক", 600);
  const box = await h.topmost(T, { placeholder: "শিক্ষার্থী সম্পর্কে মন্তব্য লিখুন…" }, { scroll: true });
  await box.fill("আজ গণিতের অঙ্কগুলো নিজে নিজে করেছে, খুব মনোযোগী ছিল।");
  await h.shot(T, "family-comment-write", 3, [
    { text: "পড়াশোনা / বাড়ির কাজ" },
    { text: "ইতিবাচক" },
    { placeholder: "শিক্ষার্থী সম্পর্কে মন্তব্য লিখুন…" },
    { text: "মন্তব্য সংরক্ষণ" },
  ]);
  await h.tap(T, "মন্তব্য সংরক্ষণ", 3000);

  // ── Office reviews and sends; the unread list ──
  const O = (await session(h, "office@help.test")).page;
  await menuShot(h, O, "family-comment-review", 0, "মন্তব্য");
  await h.shot(O, "family-comment-review", 1, [{ text: "পর্যালোচনা ও পাঠানো", last: true }]);
  await h.tap(O, { text: "পর্যালোচনা ও পাঠানো", last: true }, 3000);
  await h.shot(O, "family-comment-review", 2, [{ text: "আজ গণিতের অঙ্কগুলো নিজে নিজে করেছে, খুব মনোযোগী ছিল।" }, { text: "বাতিল করুন" }]);
  await h.tap(O, "আজ গণিতের অঙ্কগুলো নিজে নিজে করেছে, খুব মনোযোগী ছিল।", 3000);
  await h.shot(O, "family-comment-review", 3, [{ css: "textarea" }, { text: "মন্তব্য সম্পাদনা" }, { text: "অভিভাবককে পাঠান" }]);
  await h.tap(O, "অভিভাবককে পাঠান", 3000);

  await fresh(h, O);
  await menuShot(h, O, "family-comment-unread", 0, "মন্তব্য");
  await h.shot(O, "family-comment-unread", 1, [{ text: "অভিভাবক এখনো পড়েননি", last: true }]);
  await h.tap(O, { text: "অভিভাবক এখনো পড়েননি", last: true }, 3000);
  await h.shot(O, "family-comment-unread", 2, [{ re: "^ফোন করুন" }]);
};
