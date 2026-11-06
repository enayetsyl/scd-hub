/**
 * notes spec, part 3 — the Office (office@help.test): today's class board, covers, bell duty,
 * holidays, class-note report and admin list, the routine grid and editor.
 * The science teacher is on an approved leave today (fixture), so periods need a cover.
 */
/** The Routine tab's landing screen (pops whatever the tab still has on top). */
async function routineHome(h, x, page) {
  await x.drawer(h, page, "একাডেমিক", "রুটিন");
  await h.tap(page, "রুটিন", 3500);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1200);
    const home = await h.topmost(page, { text: "আমার ক্লাস লোড" }, { scroll: true }).then(() => true, () => false);
    if (home) return;
    await x.back(h, page).catch(() => undefined);
  }
  await x.peek(page, "routine-home-fail");
  throw new Error("routineHome: could not get back to the Routine landing screen");
}
exports.routineHome = routineHome;

exports.run = async (h, x) => {
  const { context, page: O } = await x.loginAt(h, "office@help.test");
  // NOTES_FROM=late skips straight to the class-note admin list (spec development only).
  if (process.env.NOTES_FROM !== "late") {

  // ── আজকের ক্লাস বোর্ড ──────────────────────────────────────────────────────
  await x.drawerShot(h, O, "notes-live-board", 0, "একাডেমিক", "রুটিন");
  await x.peek(O, "o-routine-home");
  await h.shot(O, "notes-live-board", 1, [{ text: "আজকের ক্লাস বোর্ড" }]);
  await h.tap(O, "আজকের ক্লাস বোর্ড", 4000);
  await x.peek(O, "o-board");
  await h.shot(O, "notes-live-board", 2, [{ text: "শুধু শিক্ষকবিহীন" }, { re: "^আজ শিক্ষকবিহীন" }, { re: "^শিক্ষকবিহীন ক্লাস" }]);
  // The grid scrolls sideways: bring the current period into view.
  await O.getByText("পিরিয়ড ৬ · এখন", { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: "center", inline: "center" }));
  await O.waitForTimeout(800);
  await x.peek(O, "o-board-grid");
  await h.shot(O, "notes-live-board", 3, [{ text: "পিরিয়ড ৬ · এখন" }, { text: "শিক্ষক নেই" }]);

  // ── কভার শিক্ষক দেওয়া (board → CoverManage, P5 ৫ম ক বিজ্ঞান) ────────────────
  await x.scrollTo(h, O, { re: "^শিক্ষকবিহীন ক্লাস" });
  await h.shot(O, "notes-cover-assign", 0, [{ re: "^পিরিয়ড ৫ · ৫ম শ্রেণি" }], { anchor: { re: "^শিক্ষকবিহীন ক্লাস" } });
  await h.tap(O, { re: "^পিরিয়ড ৫ · ৫ম শ্রেণি" }, 3500);
  await x.peek(O, "o-cover");
  const find = await x.mark(O, "কভার খুঁজুন", 0, "cover-find");
  await h.shot(O, "notes-cover-assign", 1, [{ text: "2026-11-05" }, find]);
  await h.tap(O, find, 3000);
  await x.peek(O, "o-cover-avail");
  const assignBtn = await x.mark(O, "কভার নিয়োগ", 0, "cover-assign");
  await h.shot(O, "notes-cover-assign", 2, [{ text: "উপলব্ধ শিক্ষক" }, { text: "ফাঁকা" }, assignBtn], { anchor: { text: "উপলব্ধ শিক্ষক" } });
  await h.tap(O, assignBtn, 3500);
  await x.peek(O, "o-cover-done");
  await h.shot(O, "notes-cover-assign", 3, [{ text: "কভার নিয়োগ হয়েছে।" }, { text: "কভার করা হয়েছে" }]);

  // ── কভার বাতিল (shown, not cancelled) ───────────────────────────────────────
  await x.scrollTo(h, O, { text: "আজকের কভার" });
  const cancelBtn = await x.mark(O, "বাতিল", 0, "cover-cancel");
  await h.shot(O, "notes-cover-cancel", 0, [{ text: "আজকের কভার" }, cancelBtn], { anchor: { text: "আজকের কভার" } });

  // ── কভার প্রয়োজন (ছুটির কারণে খালি ক্লাস, P8 ৩য় বালক) ────────────────────────
  await x.drawer(h, O, null, "কর্মী");
  await h.tap(O, "কর্মী", 3500);
  await x.peek(O, "o-hr");
  await h.shot(O, "notes-needs-cover", 0, [{ text: "ছুটি ব্যবস্থাপনা" }]);
  await h.tap(O, "ছুটি ব্যবস্থাপনা", 3500);
  await x.peek(O, "o-leave-admin");
  await h.shot(O, "notes-needs-cover", 1, [{ text: "কভার প্রয়োজন", minY: 70 }]);
  await h.tap(O, { text: "কভার প্রয়োজন", minY: 70 }, 4000);
  await x.peek(O, "o-needs-cover");
  const sel = await x.mark(O, "শিক্ষক নির্বাচন করুন…", 1, "nc-select");
  await h.tap(O, sel, 1500);
  await x.peek(O, "o-needs-cover-open");
  await h.shot(O, "notes-needs-cover", 2, [{ re: "^পিরিয়ড ৮ · বিজ্ঞান" }, { text: "উদাহরণ ইংরেজি শিক্ষক", last: true }], {
    anchor: { re: "^পিরিয়ড ৮ · বিজ্ঞান" },
  });
  await h.tap(O, { text: "উদাহরণ ইংরেজি শিক্ষক", last: true }, 1500);
  const approve = await x.mark(O, "অনুমোদন", 1, "nc-approve");
  await h.shot(O, "notes-needs-cover", 3, [{ text: "উদাহরণ ইংরেজি শিক্ষক" }, approve], { anchor: { re: "^পিরিয়ড ৮ · বিজ্ঞান" } });
  await h.tap(O, approve, 4000);
  await x.peek(O, "o-needs-cover-done");

  // ── ঘণ্টা সূচি ও ঘণ্টার দায়িত্ব ─────────────────────────────────────────────
  await routineHome(h, x, O);
  await h.shot(O, "notes-bell", 0, [{ text: "ঘণ্টা সূচি" }]);
  await h.tap(O, "ঘণ্টা সূচি", 3500);
  await x.peek(O, "o-bell");
  await h.tap(O, { text: "শিক্ষক নির্বাচন করুন…" }, 1500);
  await x.peek(O, "o-bell-open");
  await h.tap(O, { text: "উদাহরণ কুরআন শিক্ষক", last: true }, 1200);
  await h.shot(O, "notes-bell", 1, [{ text: "2026-11-05" }, { text: "উদাহরণ কুরআন শিক্ষক" }, { text: "ঘণ্টা দায়িত্ব নিয়োগ" }]);
  await h.tap(O, "ঘণ্টা দায়িত্ব নিয়োগ", 3000);
  await x.peek(O, "o-bell-done");
  await x.scrollTo(h, O, { re: "^পিরিয়ড ১ · পিরিয়ড শেষ" });
  await h.shot(O, "notes-bell", 2, [{ re: "^পিরিয়ড ১ · পিরিয়ড শেষ" }], { anchor: { re: "^পিরিয়ড ১ · পিরিয়ড শেষ" } });

  // ── ছুটির দিন ─────────────────────────────────────────────────────────────
  await routineHome(h, x, O);
  await h.shot(O, "notes-holiday-add", 0, [{ text: "ছুটির দিন" }]);
  await h.tap(O, "ছুটির দিন", 3500);
  await x.peek(O, "o-holidays");
  const dates = O.getByPlaceholder("YYYY-MM-DD").locator("visible=true");
  await dates.nth(0).fill("2026-12-28");
  await dates.nth(0).evaluate((e) => e.setAttribute("data-help", "hx-from"));
  await dates.nth(1).fill("2026-12-31");
  await dates.nth(1).evaluate((e) => e.setAttribute("data-help", "hx-to"));
  await h.tap(O, { text: "সরকারি ছুটি" }, 1200);
  await h.tap(O, { text: "বিশেষ ছুটি" }, 1200);
  const name = O.getByPlaceholder("যেমন: ঈদুল ফিতর").locator("visible=true").first();
  await name.fill("শীতকালীন ছুটি");
  await name.evaluate((e) => e.setAttribute("data-help", "hx-name"));
  await x.scrollTo(h, O, { text: "ছুটি যোগ করুন" });
  await x.peek(O, "o-holiday-filled");
  await h.shot(
    O,
    "notes-holiday-add",
    1,
    [{ css: '[data-help="hx-from"]' }, { css: '[data-help="hx-to"]' }, { text: "বিশেষ ছুটি" }, { css: '[data-help="hx-name"]' }, { text: "সংরক্ষণ করুন" }],
    { anchor: { text: "ছুটি যোগ করুন" } },
  );
  await h.tap(O, "সংরক্ষণ করুন", 3500);
  await x.scrollTo(h, O, { text: "আসন্ন ছুটি" });
  await x.peek(O, "o-holiday-saved");
  await h.shot(O, "notes-holiday-add", 2, [{ text: "আসন্ন ছুটি" }], { anchor: { text: "আসন্ন ছুটি" } });
  const remove = await x.mark(O, "বাতিল করুন", 0, "hx-remove");
  await h.shot(O, "notes-holiday-remove", 0, [{ text: "আসন্ন ছুটি" }, remove], { anchor: { text: "আসন্ন ছুটি" } });

  // ── ক্লাস নোট জমার রিপোর্ট ────────────────────────────────────────────────
  await routineHome(h, x, O);
  await h.shot(O, "notes-report", 0, [{ text: "ক্লাস নোট জমা" }]);
  await h.tap(O, "ক্লাস নোট জমা", 4000);
  await x.peek(O, "o-report");
  await h.shot(O, "notes-report", 1, [{ text: "2026-11-05" }, { re: "^প্রকাশিত বিষয়:" }, { re: "^বাকি বিষয়:" }, { text: "এক্সেল" }]);
  const status = await x.mark(O, "সব", 5, "rep-status");
  await h.tap(O, status, 1200);
  await h.tap(O, { text: "বাকি আছে", last: true }, 2500);
  await x.scrollTo(h, O, { text: "অবস্থা" });
  await x.peek(O, "o-report-filtered");
  await h.shot(O, "notes-report", 2, [{ text: "বাকি আছে" }, { re: "^SL" }], { anchor: { text: "অবস্থা" } });

  }

  // ── ক্লাস নোট (ব্যবস্থাপনা): সব শিক্ষকের নোট দেখা ও ঠিক করা ──────────────
  await routineHome(h, x, O);
  await h.shot(O, "notes-admin-list", 0, [{ text: "ক্লাস নোট (ব্যবস্থাপনা)" }]);
  await h.tap(O, "ক্লাস নোট (ব্যবস্থাপনা)", 4000);
  await x.peek(O, "o-notes-admin");
  const teacherSel = await x.mark(O, "সব", 1, "na-teacher");
  const editNote = await x.mark(O, "নোট সম্পাদনা", 0, "na-edit");
  const delNote = await x.mark(O, "সরান", 0, "na-del");
  await h.shot(O, "notes-admin-list", 1, [{ text: "৭ দিন" }, teacherSel, editNote, delNote]);
  await h.tap(O, editNote, 2000);
  const box = O.locator("textarea").locator("visible=true").first();
  await box.fill("‘আমাদের গ্রাম’ কবিতাটি সবাই মিলে পড়া হয়েছে, কঠিন শব্দের অর্থ খাতায় লেখানো হয়েছে।");
  await x.peek(O, "o-notes-admin-edit");
  await h.shot(O, "notes-admin-list", 2, [{ css: "textarea" }, { text: "সংরক্ষণ" }]);
  await h.tap(O, "সংরক্ষণ", 3000);

  // ── সম্পূর্ণ রুটিন গ্রিড ও একটি পিরিয়ড বদলানো ──────────────────────────────
  await routineHome(h, x, O);
  await h.shot(O, "notes-master-grid", 0, [{ text: "সম্পূর্ণ রুটিন গ্রিড" }]);
  await h.tap(O, "সম্পূর্ণ রুটিন গ্রিড", 5000);
  await x.peek(O, "o-master");
  await h.shot(O, "notes-master-grid", 1, [{ text: "রবিবার" }, { text: "2026-11-05" }, { text: "কোনো সংঘর্ষ নেই" }]);

  // Change one period: Sunday P8 ইসলাম শিক্ষা in ৩য় বালিকা → another teacher.
  await h.tap(O, { text: "রবিবার" }, 3000);
  await O.getByText("ইসলাম শিক্ষা", { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: "center", inline: "center" }));
  await O.waitForTimeout(800);
  await x.peek(O, "o-master-sun");
  await h.shot(O, "notes-routine-edit", 0, [{ text: "ইসলাম শিক্ষা" }]);
  await h.tap(O, { text: "ইসলাম শিক্ষা" }, 2000);
  await x.peek(O, "o-master-modal");
  await h.tap(O, { text: "উদাহরণ ইসলাম শিক্ষা শিক্ষক", last: true }, 1200);
  await h.tap(O, { text: "উদাহরণ শিক্ষক", last: true }, 1200);
  await x.peek(O, "o-master-modal2");
  await h.shot(O, "notes-routine-edit", 1, [{ text: "বিষয়", last: true }, { text: "উদাহরণ শিক্ষক", last: true }, { text: "শুধু এই পিরিয়ড" }, { text: "সংরক্ষণ", last: true }]);
  await h.tap(O, { text: "সংরক্ষণ", last: true }, 3500);
  await x.peek(O, "o-master-saved");

  // ── শাখার রুটিনে নতুন পিরিয়ড (৫ম ক, রবিবার P7 খালি) ──────────────────────
  await routineHome(h, x, O);
  await h.tap(O, { text: "৫", minY: 70 }, 2500);
  const editBtn = await x.mark(O, "রুটিন সম্পাদনা", 0, "sec-edit");
  await h.shot(O, "notes-routine-add", 0, [{ text: "৫", minY: 70 }]);
  await x.scrollTo(h, O, { text: "শাখার রুটিন" });
  await h.shot(O, "notes-routine-add", 1, [editBtn], { anchor: { text: "শাখার রুটিন" } });
  await h.tap(O, editBtn, 3500);
  await x.peek(O, "o-editor");
  const period = O.locator('input[inputmode="numeric"]').locator("visible=true").first();
  await period.fill("7");
  await period.evaluate((e) => e.setAttribute("data-help", "ed-period"));
  await h.tap(O, { text: "ইংরেজি" }, 800);
  await h.shot(O, "notes-routine-add", 2, [{ text: "রবিবার" }, { css: '[data-help="ed-period"]' }, { text: "ইংরেজি" }]);
  await h.tap(O, { text: "শিক্ষক নির্বাচন করুন…" }, 1500);
  await h.tap(O, { text: "উদাহরণ ইংরেজি শিক্ষক", last: true }, 1200);
  await x.scrollTo(h, O, { text: "শিক্ষক", minY: 70 });
  await x.peek(O, "o-editor-filled");
  await h.shot(O, "notes-routine-add", 3, [{ text: "উদাহরণ ইংরেজি শিক্ষক" }, { text: "2026-11-05" }, { text: "স্লট যোগ করুন", last: true }], {
    anchor: { text: "শিক্ষক", minY: 70 },
  });
  await h.tap(O, { text: "স্লট যোগ করুন", last: true }, 3500);
  await x.peek(O, "o-editor-saved");
  await context.close();
};
