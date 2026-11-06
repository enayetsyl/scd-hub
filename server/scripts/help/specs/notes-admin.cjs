/**
 * notes spec, part 4 — classes & শাখা and teaching assignments (প্রশাসন), as the Principal
 * (the subject-teacher action is Principal-only by default).
 */
async function adminItem(h, x, page, guide, item) {
  await x.drawer(h, page, null, "প্রশাসন");
  await h.tap(page, "প্রশাসন", 3500);
  for (let i = 0; i < 3; i++) {
    const home = await h.topmost(page, { text: item }, { scroll: true }).then(() => true, () => false);
    if (home) break;
    await x.back(h, page);
  }
  await x.scrollTo(h, page, { text: item });
  await h.shot(page, guide, 0, [{ text: item }], { anchor: { text: item } });
  await h.tap(page, item, 3500);
}

exports.run = async (h, x) => {
  const { context, page: P } = await x.loginAt(h, "principal@help.test");

  // ── শ্রেণি শিক্ষক নির্ধারণ (৫ম ক has none) ──────────────────────────────────
  await adminItem(h, x, P, "notes-class-teacher", "শ্রেণি শিক্ষক নির্ধারণ");
  await x.peek(P, "a-ct");
  const c5Row = await x.mark(P, "ক", 0, "ct-c5");
  await x.scrollTo(h, P, { text: "শ্রেণি শিক্ষক তালিকা" });
  await h.shot(P, "notes-class-teacher", 1, [{ text: "শ্রেণি শিক্ষক তালিকা" }, c5Row], { anchor: { text: "শ্রেণি শিক্ষক তালিকা" } });
  await h.tap(P, c5Row, 2500);
  const ctSel = await x.mark(P, "শিক্ষক নির্বাচন করুন…", 1, "ct-select");
  await h.tap(P, ctSel, 1500);
  await h.tap(P, { text: "উদাহরণ শিক্ষক", last: true }, 1200);
  await x.scrollTo(h, P, { text: "বর্তমান শ্রেণি শিক্ষক" });
  await x.peek(P, "a-ct-picked");
  await h.shot(P, "notes-class-teacher", 2, [{ text: "বর্তমান শ্রেণি শিক্ষক" }, { text: "উদাহরণ শিক্ষক" }, { text: "নির্ধারণ করুন" }], {
    anchor: { text: "বর্তমান শ্রেণি শিক্ষক" },
  });
  await h.tap(P, "নির্ধারণ করুন", 3500);
  await x.peek(P, "a-ct-done");
  await x.scrollTo(h, P, { text: "শ্রেণি শিক্ষক নির্ধারিত হয়েছে" });
  await h.shot(P, "notes-class-teacher", 3, [{ text: "শ্রেণি শিক্ষক নির্ধারিত হয়েছে" }], { anchor: { text: "শ্রেণি শিক্ষক নির্ধারিত হয়েছে" } });

  // ── বিষয়শিক্ষক নিয়োগ (৫ম ক, ইসলাম শিক্ষা) ───────────────────────────────────
  await adminItem(h, x, P, "notes-subject-teacher", "বিষয়শিক্ষক নিয়োগ");
  await h.tap(P, { text: "৫", minY: 70 }, 3000);
  await x.peek(P, "a-st");
  await h.shot(P, "notes-subject-teacher", 1, [{ text: "৫", minY: 70 }, { text: "নিয়োগকৃত বিষয়শিক্ষক" }, { re: "^রুটিনে:" }]);
  await h.tap(P, { text: "বিষয় নির্বাচন করুন…" }, 1500);
  await h.tap(P, { text: "ইসলাম শিক্ষা", last: true }, 1200);
  await h.tap(P, { text: "শিক্ষক নির্বাচন করুন…" }, 1500);
  await h.tap(P, { text: "উদাহরণ ইসলাম শিক্ষা শিক্ষক", last: true }, 1200);
  await x.scrollTo(h, P, { text: "নিয়োগ দিন" }, 300);
  await x.peek(P, "a-st-picked");
  await h.shot(P, "notes-subject-teacher", 2, [{ text: "ইসলাম শিক্ষা", last: true }, { text: "উদাহরণ ইসলাম শিক্ষা শিক্ষক", last: true }, { text: "নিয়োগ দিন" }]);
  await h.tap(P, "নিয়োগ দিন", 3500);
  await x.peek(P, "a-st-done");

  // ── শাখা বিন্যাস (shown, not merged) ───────────────────────────────────────
  await adminItem(h, x, P, "notes-section-merge", "শাখা বিন্যাস");
  await x.peek(P, "a-sc");
  await h.shot(P, "notes-section-merge", 1, [{ text: "একত্রিত শাখার নাম" }, { re: "^শ্রেণি ৩ ·" }, { text: "শাখা একত্র করুন" }]);
  await context.close();
};
