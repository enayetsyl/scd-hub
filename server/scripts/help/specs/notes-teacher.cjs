/**
 * notes spec, part 2 — what a subject teacher does (teacher@help.test, class teacher of
 * ৩য় বালক; today: P5 গণিত ৩য় বালক, P6 বাংলা ৩য় বালক (now), P8 গণিত ৫ম ক).
 */
exports.run = async (h, x) => {
  const { context, page: T } = await x.loginAt(h, "teacher@help.test");

  // ── আজ: আমার পিরিয়ড ───────────────────────────────────────────────────────
  await x.peek(T, "t-today");
  await h.shot(T, "notes-today-periods", 0, [{ text: "আমার পিরিয়ড" }, { text: "এখন" }, { text: "বাংলা" }], {
    anchor: { text: "আমার পিরিয়ড" },
  });
  await h.tap(T, "বাংলা", 3500);
  await x.peek(T, "t-myperiods");
  const p6Note = await x.mark(T, "ক্লাস নোট", 1, "p6-note", { minY: 150 });
  await h.shot(T, "notes-today-periods", 1, [p6Note]);

  // ── ক্লাস নোট লেখা (P6 বাংলা) ───────────────────────────────────────────────
  await x.drawerShot(h, T, "notes-write", 0, "ক্লাস নোট", "আমার পিরিয়ড");
  const p6 = await x.mark(T, "ক্লাস নোট", 1, "p6-note2", { minY: 150 });
  await h.shot(T, "notes-write", 1, [{ text: "2026-11-05" }, p6]);
  await h.tap(T, p6, 2500);
  await x.peek(T, "t-p6-open");
  const taught = T.locator("textarea").locator("visible=true").first();
  await taught.fill("‘আমাদের গ্রাম’ কবিতার শেষ দুই স্তবক পড়া ও কঠিন শব্দের অর্থ লেখা হয়েছে।");
  await h.tap(T, { text: "নেই", minY: 150 }, 1000);
  await h.tap(T, { text: "রিভিশন", minY: 150 }, 800);
  await x.peek(T, "t-p6-filled");
  await x.scrollTo(h, T, { text: "আজ যা পড়ানো হয়েছে" });
  await h.shot(T, "notes-write", 2, [{ css: "textarea" }, { text: "নেই", minY: 150 }, { text: "রিভিশন", minY: 150 }, { text: "প্রকাশ করুন" }], {
    anchor: { text: "আজ যা পড়ানো হয়েছে" },
  });
  await h.tap(T, "প্রকাশ করুন", 3500);
  await x.peek(T, "t-p6-published");
  await h.shot(T, "notes-write", 3, [{ text: "✓ প্রকাশিত হয়েছে।" }]);

  // ── নোট সংশোধন (P6) ─────────────────────────────────────────────────────────
  await h.shot(T, "notes-edit", 0, [{ text: "2026-11-05" }, { text: "নোট সম্পাদনা" }]);
  await h.tap(T, "নোট সম্পাদনা", 2000);
  const edit = T.locator("textarea").locator("visible=true").first();
  await edit.fill("‘আমাদের গ্রাম’ কবিতার শেষ দুই স্তবক পড়া, কঠিন শব্দের অর্থ ও দুটি প্রশ্নের উত্তর লেখা হয়েছে।");
  await x.scrollTo(h, T, { css: "textarea" });
  await h.shot(T, "notes-edit", 1, [{ css: "textarea" }, { text: "প্রকাশ করুন" }], { anchor: { css: "textarea" } });
  await h.tap(T, "প্রকাশ করুন", 3500);
  await x.peek(T, "t-p6-edited");

  // ── পাঠ পরিকল্পনার সেশন (P5 গণিত, ৩য় বালক) ──────────────────────────────────
  await x.scrollTo(h, T, { text: "2026-11-05" });
  const p5 = await x.mark(T, "ক্লাস নোট", 0, "p5-note", { minY: 150 });
  await h.tap(T, p5, 3000);
  await x.peek(T, "t-p5-open");
  await x.scrollTo(h, T, { text: "পাঠ পরিকল্পনা — আজ কোন সেশন পড়ালেন?" });
  await h.shot(
    T,
    "notes-lesson-mark",
    0,
    [{ text: "পাঠ পরিকল্পনা — আজ কোন সেশন পড়ালেন?" }, { text: "২.২ হাতে রেখে যোগ" }, { text: "শেষ হয়েছে" }, { text: "চলমান" }, { text: "সব সেশন দেখুন" }],
    { anchor: { text: "পাঠ পরিকল্পনা — আজ কোন সেশন পড়ালেন?" } },
  );
  await x.scrollTo(h, T, { css: "textarea" });
  await h.shot(T, "notes-lesson-mark", 1, [{ css: "textarea" }, { text: "প্রকাশ করুন" }], { anchor: { css: "textarea" } });
  await h.tap(T, "প্রকাশ করুন", 3500);
  await x.peek(T, "t-p5-published");
  await x.scrollTo(h, T, { text: "2026-11-05" });
  await h.shot(T, "notes-lesson-mark", 2, [{ re: "^📘" }]);

  // ── P8 গণিত ৫ম ক: সংযুক্তি, বাড়ির কাজ ─────────────────────────────────────
  const p8 = await x.mark(T, "ক্লাস নোট", 0, "p8-note", { minY: 150 });
  await h.tap(T, p8, 3000);
  await x.scrollTo(h, T, { re: "^সংযুক্তি \\(" });
  await x.peek(T, "t-p8-open");
  await h.shot(T, "notes-attach", 0, [{ text: "ফাইল যুক্ত করুন" }, { text: "অথবা ফাইল এখানে টেনে এনে ছাড়ুন" }, { re: "^সংযুক্তি \\(" }], {
    anchor: { re: "^সংযুক্তি \\(" },
  });
  await h.tap(T, { text: "আছে", minY: 150 }, 2500);
  await x.peek(T, "t-p8-hw");
  const areas = T.locator("textarea").locator("visible=true");
  await areas.nth(0).fill("গুণের নামতা ৮ ও ৯ মুখস্থ ও খাতায় লেখা অনুশীলন।");
  await areas.nth(1).fill("নামতা ৮ ও ৯ খাতায় দুবার লিখে আনবে।");
  await areas.nth(1).evaluate((e) => e.setAttribute("data-help", "hw-desc"));
  const nums = T.locator('input[inputmode="numeric"]').locator("visible=true");
  await nums.nth(0).evaluate((e) => e.setAttribute("data-help", "hw-time"));
  await nums.nth(1).fill("৪".length ? "4" : "4");
  await nums.nth(1).evaluate((e) => e.setAttribute("data-help", "hw-q"));
  await x.scrollTo(h, T, { text: "বাড়ির কাজ" , minY: 150 });
  await x.peek(T, "t-p8-hw-filled");
  await h.shot(
    T,
    "notes-homework",
    0,
    [{ text: "আছে", minY: 150 }, { text: "সাধারণ (নির্দিষ্ট অধ্যায় নয়)" }, { css: '[data-help="hw-desc"]' }, { css: '[data-help="hw-time"]' }, { css: '[data-help="hw-q"]' }],
    { anchor: { text: "আছে", minY: 150 } },
  );
  await x.scrollTo(h, T, { css: '[data-help="hw-q"]' });
  await h.shot(T, "notes-homework", 1, [{ text: "প্রকাশ করুন" }]);
  await h.tap(T, "প্রকাশ করুন", 4000);
  await x.peek(T, "t-p8-published");

  // ── সব ক্লাস নোট (নিজের নোটের আর্কাইভ) ────────────────────────────────────
  await x.drawerShot(h, T, "notes-archive", 0, "ক্লাস নোট", "সব ক্লাস নোট");
  await x.peek(T, "t-archive");
  const fromBox = await x.mark(T, "Choose a date", 0, "cn-from");
  const classSel = await x.mark(T, "সব", 0, "cn-class");
  const subjSel = await x.mark(T, "সব", 2, "cn-subject");
  await x.scrollTo(h, T, { text: "শুরু" });
  await h.shot(T, "notes-archive", 1, [fromBox, classSel, subjSel], { anchor: { text: "শুরু" } });
  await x.scrollTo(h, T, { text: "▾ সব খুলুন" });
  await x.peek(T, "t-archive-table");
  const firstRow = await x.mark(T, "২০২৬-১১-০৫", 0, "cn-row");
  await h.shot(T, "notes-archive", 2, [{ text: "▾ সব খুলুন" }, firstRow], { anchor: { text: "▾ সব খুলুন" } });

  // ── শাখার পাঠ পরিকল্পনার অগ্রগতি ───────────────────────────────────────────
  await x.drawerShot(h, T, "notes-lesson-tracker", 0, "ক্লাস নোট", "পাঠ পরিকল্পনার অগ্রগতি");
  await x.peek(T, "t-lp");
  await h.shot(T, "notes-lesson-tracker", 1, [{ text: "৩য় শ্রেণি · বালক — গণিত" }, { re: "সেশন শেষ \\(" }, { re: "^শেষ সেশন" }]);
  await h.tap(T, "৩য় শ্রেণি · বালক — গণিত", 3500);
  await x.peek(T, "t-tracker");
  await x.scrollTo(h, T, { text: "অধ্যায় ২ · যোগ" }, 60);
  await h.shot(T, "notes-lesson-tracker", 2, [{ text: "অধ্যায় ২ · যোগ" }, { text: "শেষ", last: true, minY: 150 }, { text: "বাকি" }], {
    anchor: { text: "অধ্যায় ২ · যোগ" },
  });

  // ── আমার রুটিন / শাখার রুটিন ───────────────────────────────────────────────
  await x.drawerShot(h, T, "notes-my-routine", 0, "একাডেমিক", "রুটিন");
  await h.shot(T, "notes-my-routine", 1, [{ text: "আমার রুটিন" }]);
  await h.tap(T, "আমার রুটিন", 3500);
  await x.peek(T, "t-myroutine");
  await h.shot(T, "notes-my-routine", 2, [{ text: "2026-11-05" }, { text: "রবিবার" }]);
  await x.scrollTo(h, T, { text: "বৃহস্পতিবার" }, 70);
  await h.shot(T, "notes-my-routine", 3, [{ text: "বৃহস্পতিবার" }, { text: "আজ", minY: 120 }], { anchor: { text: "বৃহস্পতিবার" } });

  await x.back(h, T);
  await x.peek(T, "t-routine-home");
  await h.tap(T, { text: "৩", minY: 70 }, 2000);
  await x.peek(T, "t-routine-c3");
  // One শাখা in ৩য় শ্রেণি for this teacher → it is picked by itself (no শাখা row).
  const sectionView = await x.mark(T, "রুটিন দেখুন", 0, "sec-view");
  await h.shot(T, "notes-section-routine", 0, [{ text: "৩", minY: 70 }, { text: "শাখার রুটিন" }, sectionView]);
  await h.tap(T, sectionView, 3500);
  await x.peek(T, "t-group-routine");
  await h.shot(T, "notes-section-routine", 1, [{ text: "2026-11-05" }, { text: "রবিবার" }]);
  await context.close();
};
