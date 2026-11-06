/**
 * Capture spec — parents' meeting (অভিভাবক সভা), family area. LOCAL ONLY: it creates a
 * meeting, builds its slots, sends it, approves a change request, marks attendance,
 * writes notes, a summary and a final comment.
 * Data: scripts/help/fixtures/family.ts (run it with --reset before a re-shoot). The fixture's
 * "২০২৬ — ২য় অভিভাবক সভা" (14 Nov) already has its timetable sent and comment collection open.
 */
const { wrap, session, fresh, menuShot, shotAt, reveal } = require("./family-lib.cjs");

const M2 = "২০২৬ — ২য় অভিভাবক সভা";
const NEW = "২০২৬ — বার্ষিক ফলাফল সভা";

async function toMeetings(h, page, guide) {
  if (guide) await menuShot(h, page, guide, 0, "মন্তব্য");
  else {
    await h.openMenu(page);
    await h.tap(page, { text: "মন্তব্য", last: true }, 3500);
  }
  if (guide) await h.shot(page, guide, 1, [{ text: "অভিভাবক সভা", last: true }]);
  await h.tap(page, { text: "অভিভাবক সভা", last: true }, 3500);
}

exports.run = async (h0) => {
  const h = wrap(h0);
  if (h.PROD) throw new Error("the family specs save while they walk; run them locally");

  // ── Subject teacher: a note for the meeting (Today card) ──
  const T = (await session(h, "teacher@help.test")).page;
  await h.shot(T, "family-meeting-subject-note", 0, [{ text: "অভিভাবক সভার মন্তব্য" }]);
  await h.tap(T, "অভিভাবক সভার মন্তব্য", 2000);
  await h.shot(T, "family-meeting-subject-note", 1, [{ text: "লিখুন ›" }]);
  await h.tap(T, "লিখুন ›", 4000);
  const boxes = T.locator("textarea").locator("visible=true");
  await boxes.nth(0).fill("নিয়মিত পড়া তৈরি করে আসে, ক্লাসে প্রশ্ন করে।");
  await boxes.nth(1).fill("লেখার সময় তাড়াহুড়া করে, বানানে ভুল হয়।");
  await T.mouse.move(200, 600);
  await T.mouse.wheel(0, 1200);
  await h.shot(T, "family-meeting-subject-note", 2, [{ text: "ভালো দিক" }, { text: "চিন্তার বিষয়" }, { text: "সংরক্ষণ করে পরের জন" }]);
  await h.tap(T, "সংরক্ষণ করে পরের জন", 3000);

  // ── Class teacher of ৩য় বালিকা: a summary ──
  const T2 = (await session(h, "teacher2@help.test")).page;
  await reveal(T2, { re: "^সভার সারাংশ" });
  await h.tap(T2, { re: "^সভার সারাংশ" }, 2000);
  await shotAt(h, T2, "family-meeting-summary", 0, [{ re: "^সভার সারাংশ" }, { text: "সারাংশ লিখুন ›" }], { re: "^সভার সারাংশ" });
  await h.tap(T2, "সারাংশ লিখুন ›", 6000);
  const sum = T2.locator("textarea").locator("visible=true");
  await sum.nth(0).fill("সব বিষয়ে মনোযোগী, শিক্ষকদের কথা শোনে।");
  await sum.nth(1).fill("ইংরেজি বানানে আরও যত্ন দরকার।");
  await shotAt(h, T2, "family-meeting-summary", 1, [{ text: "বিষয় শিক্ষকদের মন্তব্য" }], { text: "বিষয় শিক্ষকদের মন্তব্য" });
  await shotAt(h, T2, "family-meeting-summary", 2, [{ text: "আপনার সারাংশ" }], { text: "আপনার সারাংশ" });
  // A button at the very end of the page: let shot() centre it (an anchor would push it off the bottom).
  await h.shot(T2, "family-meeting-summary", 3, [{ text: "প্রধান শিক্ষকের কাছে পাঠান" }]);
  await h.tap(T2, "প্রধান শিক্ষকের কাছে পাঠান", 3000);

  // ── Principal: create, slots, send ──
  const P = (await session(h, "principal@help.test")).page;
  await toMeetings(h, P, "family-meeting-create");
  const inputs = P.locator("input").locator("visible=true");
  await inputs.nth(0).fill(NEW);
  await P.locator('input[type="date"]').locator("visible=true").first().fill("2026-12-12");
  await inputs.nth(2).fill("10");
  await inputs.nth(3).fill("540");
  await h.shot(P, "family-meeting-create", 2, [
    { text: "সভার শিরোনাম (যেমন ২০২৬ — ১ম)" },
    { text: "সভার তারিখ" },
    { text: "প্রতি পরিবারের সময় (মিনিট)" },
    { text: "দিন শুরুর সময়" },
    { text: "সভা তৈরি করুন" },
  ]);
  await h.tap(P, "সভা তৈরি করুন", 4000);

  await h.shot(P, "family-meeting-slots", 0, [{ text: NEW }]);
  await h.tap(P, NEW, 4000);
  await h.shot(P, "family-meeting-slots", 1, [{ text: "স্লট তৈরি করুন" }]);
  await h.tap(P, "স্লট তৈরি করুন", 5000);
  const brk = P.locator("input").locator("visible=true");
  await brk.nth(0).fill("10:00");
  await brk.nth(1).fill("10:15");
  await shotAt(h, P, "family-meeting-slots", 2, [{ text: "শুরু (HH:MM)" }, { text: "বিরতি যোগ করুন" }], { text: "বিরতি", exact: true });
  await h.tap(P, "বিরতি যোগ করুন", 4000);
  await shotAt(h, P, "family-meeting-slots", 3, [{ text: "উপরে" }, { text: "On Call করুন" }], { re: "^২\\. " });

  await shotAt(h, P, "family-meeting-send", 0, [{ text: "সময়সূচি পাঠান" }], { text: "সময়সূচি পাঠান" });
  await h.tap(P, "সময়সূচি পাঠান", 5000);
  await shotAt(h, P, "family-meeting-send", 1, [{ text: "হোয়াটসঅ্যাপ" }], { text: "হোয়াটসঅ্যাপ" });

  // ── Principal on the 14 Nov meeting: change request, attendance, brief ──
  await fresh(h, P);
  await toMeetings(h, P, null);
  for (const g of ["family-meeting-change", "family-meeting-attendance", "family-meeting-brief"]) await h.shot(P, g, 0, [{ text: M2 }]);
  await h.tap(P, M2, 4000);
  await shotAt(h, P, "family-meeting-change", 1, [{ text: "সময় পরিবর্তনের অনুরোধ" }, { text: "অনুমোদন (সময় অদলবদল)" }, { text: "নাকচ" }], { text: "সময় পরিবর্তনের অনুরোধ" });
  await h.tap(P, "অনুমোদন (সময় অদলবদল)", 4000);
  await shotAt(h, P, "family-meeting-attendance", 1, [{ text: "উপস্থিত", exact: true }, { text: "অনুপস্থিত" }], { re: "^১\\. " });
  await h.tap(P, "উপস্থিত", 3000);
  await shotAt(h, P, "family-meeting-attendance", 2, [{ text: "সারসংক্ষেপ" }], { text: "সারসংক্ষেপ" });
  await shotAt(h, P, "family-meeting-brief", 1, [{ re: "^ব্রিফ" }], { re: "^১\\. " });
  await h.tap(P, { re: "^ব্রিফ" }, 5000);
  await h.shot(P, "family-meeting-brief", 2, [{ text: "প্রিন্ট" }]);
  await h.tap(P, "প্রিন্ট", 2500);
  await h.shot(P, "family-meeting-brief", 3, [{ text: "শুধু এই শিক্ষার্থী" }, { text: "PDF তৈরি করুন" }]);

  // ── Final comment, then comment collection on the new meeting ──
  await fresh(h, P);
  await toMeetings(h, P, null);
  await h.tap(P, M2, 4000);
  await shotAt(h, P, "family-meeting-final", 0, [{ text: "সভার মন্তব্য" }], { text: "সভার মন্তব্য" });
  await h.tap(P, "সভার মন্তব্য", 4000);
  await h.shot(P, "family-meeting-final", 1, [{ text: "চূড়ান্ত মন্তব্য লিখুন" }]);
  await h.tap(P, "চূড়ান্ত মন্তব্য লিখুন", 4000);
  await h.shot(P, "family-meeting-final", 2, [{ re: "^আপনার অপেক্ষায়" }]);
  await h.tap(P, "তাসনিম জাহান", 4000);
  await h.shot(P, "family-meeting-final", 3, [{ text: "যেমন আছে রাখুন" }, { text: "সম্পাদনা করুন" }]);
  await h.tap(P, "যেমন আছে রাখুন", 3000);

  await fresh(h, P);
  await toMeetings(h, P, null);
  await h.tap(P, NEW, 4000);
  await shotAt(h, P, "family-meeting-collect", 0, [{ text: "সভার মন্তব্য" }], { text: "সভার মন্তব্য" });
  await h.tap(P, "সভার মন্তব্য", 4000);
  const dues = P.locator('input[type="date"]').locator("visible=true");
  await dues.nth(0).fill("2026-12-06");
  await dues.nth(1).fill("2026-12-09");
  await h.shot(P, "family-meeting-collect", 1, [{ text: "বিষয় শিক্ষকদের শেষ তারিখ" }, { text: "শ্রেণি শিক্ষকের সারাংশের শেষ তারিখ" }, { text: "শুরু করুন" }]);
  await h.tap(P, "শুরু করুন", 5000);
  await shotAt(h, P, "family-meeting-collect", 2, [{ text: "রিমাইন্ডার পাঠান" }], { text: "শিক্ষক অনুযায়ী বাকি মন্তব্য" });
};
