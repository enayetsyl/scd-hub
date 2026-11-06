/**
 * Capture spec — messages and pop-ups (ops area): staff chat, a new group, the guardian
 * WhatsApp notice, pop-up notices to staff and to guardians, the pop-up report, and
 * আমার বার্তা for a staff member and a guardian.
 *
 * LOCAL ONLY: it sends chat messages, creates a group and a notice, and sends two pop-ups
 * (“শিক্ষক সভা” to reviewer@help.test only, “অভিভাবক সমাবেশ” to every guardian). Run it after
 * ops-start and before ops-help (the pop-ups appear on those logins). Data: fixtures/ops.ts.
 */
const { PASSWORD, menu, menuShot, fill, home, reveal, closePopups } = require("./ops-common.cjs");

async function confirmSend(h, page) {
  await h.tap(page, { text: "পাঠান", last: true }, 2500);
  // The confirm dialog repeats the button; tap it when it is there.
  await h.tap(page, { text: "পাঠান", last: true }, 4000).catch(() => {});
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("ops-comms sends messages and pop-ups; run it locally (see its header)");

  // ── Teacher: a 1:1 message, the guardian notice ──────────────────────────
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await menu(h, T, "বার্তা");
  await h.shot(T, "ops-chat-send", 0, [{ text: "নতুন বার্তা" }, { text: "স্কুল-ব্যাপী" }]);
  await h.tap(T, "নতুন বার্তা", 3000);
  await h.shot(T, "ops-chat-send", 1, [{ re: "উদাহরণ অধ্যক্ষ$" }]);
  await h.tap(T, { re: "উদাহরণ অধ্যক্ষ$" }, 4000);
  await fill(h, T, { placeholder: "বার্তা লিখুন…" }, "আসসালামু আলাইকুম। আগামীকালের সভা কয়টায়, জানাবেন?", 800);
  await h.shot(T, "ops-chat-send", 2, [{ placeholder: "বার্তা লিখুন…" }, { text: "পাঠান" }]);
  await h.tap(T, "পাঠান", 3000);

  await home(T);
  await menu(h, T, "বার্তা");
  await h.shot(T, "ops-chat-notice", 0, [{ text: "📣 অভিভাবক নোটিশ" }]);
  await h.tap(T, "📣 অভিভাবক নোটিশ", 3500);
  await h.tap(T, "বালক", 1200);
  await fill(h, T, { placeholder: "নোটিশের শিরোনাম" }, "অভিভাবক সভা — শনিবার", 400);
  await fill(h, T, { placeholder: "নোটিশের বিস্তারিত লিখুন…" }, "শনিবার সকাল ১০টায় ৩য় শ্রেণির অভিভাবক সভা হবে। অনুগ্রহ করে সময়মতো আসবেন।", 800);
  await h.shot(T, "ops-chat-notice", 1, [
    { text: "বালক" },
    { placeholder: "নোটিশের শিরোনাম" },
    { placeholder: "নোটিশের বিস্তারিত লিখুন…" },
    { text: "নোটিশ তৈরি করুন" },
  ]);
  await h.tap(T, "নোটিশ তৈরি করুন", 4000);
  await h.shot(T, "ops-chat-notice", 2, [{ re: "আরিফ হোসেন — হোয়াটসঅ্যাপে পাঠান$" }]);

  // ── Office: a group, two pop-ups, the report ─────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await menu(h, O, "বার্তা");
  await h.shot(O, "ops-chat-group", 0, [{ text: "নতুন গ্রুপ" }]);
  await h.tap(O, "নতুন গ্রুপ", 3000);
  await fill(h, O, { placeholder: "গ্রুপের নাম লিখুন" }, "বার্ষিক ক্রীড়া দল", 800);
  await h.shot(O, "ops-chat-group", 1, [{ placeholder: "গ্রুপের নাম লিখুন" }, { text: "উন্মুক্ত আলোচনা" }]);
  await h.tap(O, "উদাহরণ শ্রেণি শিক্ষক", 600);
  await h.tap(O, "উদাহরণ ইংরেজি শিক্ষক", 600);
  await h.shot(O, "ops-chat-group", 2, [{ text: "উদাহরণ শ্রেণি শিক্ষক" }, { text: "তৈরি করুন" }]);
  await h.tap(O, "তৈরি করুন", 4000);

  await home(O);
  await menu(h, O, "পপ-আপ বার্তা");
  await h.shot(O, "ops-popup-staff", 0, [{ text: "＋ নতুন পপ-আপ বার্তা" }]);
  await h.shot(O, "ops-popup-guardian", 0, [{ text: "＋ নতুন পপ-আপ বার্তা" }]);
  await h.tap(O, "＋ নতুন পপ-আপ বার্তা", 3500);
  await fill(h, O, { placeholder: "নাম বা আইডি লিখুন…" }, "উদাহরণ শিক্ষক", 2500);
  await h.tap(O, "যোগ করুন", 1500);
  await h.shot(O, "ops-popup-staff", 1, [{ text: "সব শিক্ষক" }, { placeholder: "নাম বা আইডি লিখুন…" }], {
    anchor: { text: "এক ট্যাপে" },
  });
  await h.tap(O, "পরের ধাপ →", 2500);
  await fill(h, O, { placeholder: "যেমন: অভিভাবক সমাবেশ — শনিবার সকাল ১০টা" }, "শিক্ষক সভা", 300);
  await fill(h, O, { css: "textarea" }, "রবিবার দুপুর ১টায় অফিস কক্ষে শিক্ষক সভা হবে। সবাই সময়মতো আসবেন।", 800);
  await h.shot(O, "ops-popup-staff", 2, [{ placeholder: "যেমন: অভিভাবক সমাবেশ — শনিবার সকাল ১০টা" }, { css: "textarea" }, { text: "৫ · পাঠান" }]);
  await h.tap(O, "৫ · পাঠান", 2500);
  await h.shot(O, "ops-popup-staff", 3, [{ text: "পাঠান", last: true }]);
  await confirmSend(h, O);

  await home(O);
  await menu(h, O, "পপ-আপ বার্তা");
  await h.tap(O, "＋ নতুন পপ-আপ বার্তা", 3500);
  await h.tap(O, "সব অভিভাবক", 1500);
  await h.shot(O, "ops-popup-guardian", 1, [{ text: "সব অভিভাবক" }]);
  await h.tap(O, "পরের ধাপ →", 2500);
  await fill(h, O, { placeholder: "যেমন: অভিভাবক সমাবেশ — শনিবার সকাল ১০টা" }, "অভিভাবক সমাবেশ", 300);
  await fill(h, O, { css: "textarea" }, "শনিবার সকাল ১০টায় স্কুলে অভিভাবক সমাবেশ হবে। সঙ্গে আনবেন: ", 600);
  await h.tap(O, "＋ {সন্তান}", 800);
  await h.shot(O, "ops-popup-guardian", 2, [
    { placeholder: "যেমন: অভিভাবক সমাবেশ — শনিবার সকাল ১০টা" },
    { css: "textarea" },
    { text: "＋ {সন্তান}" },
    { text: "৫ · পাঠান" },
  ]);
  await h.tap(O, "৫ · পাঠান", 2500);
  await h.shot(O, "ops-popup-guardian", 3, [{ text: "পাঠান", last: true }]);
  await confirmSend(h, O);

  await home(O);
  await menu(h, O, "পপ-আপ বার্তা");
  await h.shot(O, "ops-popup-report", 0, [{ text: "অভিভাবক সমাবেশ" }]);
  await h.tap(O, "অভিভাবক সমাবেশ", 4000);
  await h.shot(O, "ops-popup-report", 1, [{ text: "দেখেছেন" }, { text: "প্রত্যেকের অবস্থা" }]);
  await reveal(O, { text: "নতুন যারা মেলে, যোগ করুন" });
  await h.shot(O, "ops-popup-report", 2, [{ re: "^বাকিদের আবার দেখান" }, { text: "নতুন যারা মেলে, যোগ করুন" }]);

  // ── আমার বার্তা: the staff pop-up's one recipient, then the guardian ──────
  const R = (await h.login("reviewer@help.test", PASSWORD)).page;
  await R.waitForTimeout(7000);
  await closePopups(h, R);
  await menuShot(h, R, "ops-popup-mine", 0, [{ text: "আমার বার্তা" }]);
  await h.tap(R, "আমার বার্তা", 3500);
  await h.shot(R, "ops-popup-mine", 1, [{ text: "শিক্ষক সভা" }]);

  const G = (await h.login("01800000001", PASSWORD)).page;
  await G.waitForTimeout(7000);
  await closePopups(h, G);
  await menuShot(h, G, "ops-popup-mine-guardian", 0, [{ text: "আমার বার্তা" }]);
  await h.tap(G, "আমার বার্তা", 3500);
  await h.shot(G, "ops-popup-mine-guardian", 1, [{ text: "অভিভাবক সমাবেশ" }]);
};
