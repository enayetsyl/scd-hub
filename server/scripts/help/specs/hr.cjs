/**
 * Capture spec — HR area (staff records, leave, cover approval, letters, appraisal,
 * conduct, grievances, staff mistakes, exit, classroom observation, staff attendance).
 *
 * LOCAL ONLY: it walks the example school from scripts/help/fixtures/hr.ts and saves as
 * it goes (approves a leave, decides a cover slot, explains and decides a mistake, …),
 * because some screens only exist after those steps. Re-seed with --reset before a re-run.
 *
 * Logins come from scripts/help/fixture.ts (example data; password Help@123).
 * Generic helpers live here (not in capture.cjs): xpath field/select/date targets.
 */
const PASSWORD = "Help@123";

// ── Targets ─────────────────────────────────────────────────────────────────
/** The Select trigger right after its label. */
const sel = (label, extra = {}) => ({ css: `xpath=//*[text()="${label}"]/following::*[@tabindex="0"][1]`, ...extra });
/** The text box right after its label. */
const fld = (label, extra = {}) => ({ css: `xpath=//*[text()="${label}"]/following::*[self::input or self::textarea][1]`, ...extra });
/** A DateField's tap target (web). */
const dateBtn = (label) => ({ css: `button[aria-label="${label}"]` });
const t = (text, extra = {}) => ({ text, ...extra });

// ── Actions ─────────────────────────────────────────────────────────────────
async function fresh(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(5500);
}
async function pick(h, page, label, option, wait = 900) {
  await h.tap(page, sel(label), 700);
  await h.tap(page, { text: option, ...(typeof option === "object" ? option : {}) }, wait);
}
async function pickText(h, page, label, option, wait = 900) {
  await h.tap(page, sel(label), 700);
  await h.tap(page, option, wait);
}
async function fill(h, page, label, value) {
  const el = await h.topmost(page, fld(label), { scroll: true });
  await el.fill(value);
  await page.waitForTimeout(300);
}
async function setDate(page, label, value) {
  await page.locator(`input[type="date"][aria-label="${label}"]`).locator("visible=true").first().fill(value);
  await page.waitForTimeout(400);
}

/** ☰ → a drawer item; shoots the drawer as `row` of `guide` when given. */
async function menu(h, page, item, guide, row = 0) {
  await h.openMenu(page);
  if (guide) await h.shot(page, guide, row, [t(item)]);
  await h.tap(page, item, 3000);
}
/** From the HR home, shoot the card as `row` and open it. */
async function hrCard(h, page, label, guide, row) {
  if (guide) await h.shot(page, guide, row, [t(label, { minY: 100 })]);
  await h.tap(page, { text: label, minY: 100 }, 3500);
}
async function openHr(h, page, label, guides = []) {
  await fresh(page);
  await menu(h, page, "কর্মী", guides.menu, 0);
  for (const [g, row] of guides.cards ?? []) await h.shot(page, g, row, [t(label, { minY: 100 })]);
  await h.tap(page, { text: label, minY: 100 }, 3500);
}
/** প্রশাসন → কর্মী তালিকা → a person's hub. */
async function openStaff(h, page, name, { listShots = [] } = {}) {
  await fresh(page);
  await menu(h, page, "প্রশাসন");
  await h.tap(page, { text: "কর্মী তালিকা", minY: 100 }, 3500);
  for (const g of listShots) await h.shot(page, g, 0, [t(name)]);
  await h.tap(page, name, 4000);
}

// ── Walks ───────────────────────────────────────────────────────────────────
async function teacherLeave(h, T) {
  // hr-leave-apply
  await openHr(h, T, "আমার ছুটি", { menu: "hr-leave-apply", cards: [["hr-leave-apply", 1], ["hr-leave-mine", 0]] });
  await pick(h, T, "ছুটির ধরন", "নৈমিত্তিক");
  await setDate(T, "শুরুর তারিখ", "2026-11-16");
  await setDate(T, "শেষ তারিখ", "2026-11-17");
  await fill(h, T, "কারণ", "মায়ের চিকিৎসার জন্য ঢাকায় যেতে হবে");
  await h.shot(
    T,
    "hr-leave-apply",
    2,
    [sel("ছুটির ধরন"), dateBtn("শুরুর তারিখ"), dateBtn("শেষ তারিখ"), fld("কারণ"), t("আবেদন জমা দিন")],
    { anchor: t("ছুটির আবেদন", { minY: 100 }) },
  );
  // hr-leave-mine (the form above is left unsent)
  await h.shot(T, "hr-leave-mine", 1, [t("বাকি")], { anchor: t("ছুটির হিসাব") });
  await h.shot(T, "hr-leave-mine", 2, [t("আবেদিত"), t("কভার দেখুন"), t("বাতিল করুন")], { anchor: t("আমার আবেদন") });
}

async function teacherMistake(h, T) {
  await openHr(h, T, "আমার ভুল ও ব্যাখ্যা", { menu: "staff-mistakes-explain", cards: [["staff-mistakes-explain", 1]] });
  await h.shot(T, "staff-mistakes-explain", 2, [t("সময়মতো উপস্থিতি নেওয়া হয়নি"), { re: "মধ্যে ব্যাখ্যা দিন", last: true }, t("ব্যাখ্যা দিন", { last: true })]);
  await h.tap(T, t("ব্যাখ্যা দিন", { last: true }), 1500);
  await h.tap(T, "অ্যাপ / ইন্টারনেট সমস্যা", 800);
  await h.shot(T, "staff-mistakes-explain", 3, [t("কী হয়েছিল?"), t("জমা দিন")]);
  await h.tap(T, "জমা দিন", 3000);
}

async function principalCover(h, P) {
  await openHr(h, P, "ছুটি ব্যবস্থাপনা");
  await h.shot(P, "hr-cover-approve", 0, [t("কভার ব্যবস্থাপনা", { last: true })], { anchor: t("অবস্থা অনুযায়ী") });
  await h.tap(P, t("কভার ব্যবস্থাপনা", { last: true }), 3500);
  await h.shot(P, "hr-cover-approve", 1, [t("প্রস্তাবিত শিক্ষক"), t("অনুমোদন"), t("প্রত্যাখ্যান"), t("অন্য কাউকে দিন")]);
  await h.tap(P, "অনুমোদন", 3500);
  await h.shot(P, "hr-cover-approve", 2, [t("শিক্ষক নির্বাচন করুন…"), t("অনুমোদন")], { anchor: t("বাংলা") });
}

async function principalLeave(h, P) {
  // record on behalf + allowance (shown, not saved)
  await openHr(h, P, "ছুটি ব্যবস্থাপনা", { menu: "hr-leave-approve", cards: [["hr-leave-approve", 1], ["hr-leave-record", 0], ["hr-leave-allowance", 0]] });
  await pickText(h, P, "কর্মী", t("উদাহরণ দারোয়ান"));
  await pick(h, P, "ছুটির ধরন", "অসুস্থতাজনিত");
  await setDate(P, "শুরুর তারিখ", "2026-11-08");
  await setDate(P, "শেষ তারিখ", "2026-11-08");
  await fill(h, P, "কারণ", "জ্বর — ফোনে জানিয়েছেন");
  await h.shot(
    P,
    "hr-leave-record",
    1,
    [sel("কর্মী"), sel("ছুটির ধরন"), dateBtn("শুরুর তারিখ"), dateBtn("শেষ তারিখ"), fld("কারণ"), t("ছুটি নথিভুক্ত করুন")],
    { anchor: t("কর্মীর পক্ষে ছুটি নথিভুক্ত করুন") },
  );
  // allowance editor at the bottom (second কর্মী / ছুটির ধরন selects)
  const ent = (label) => ({ css: `xpath=(//*[text()="ছুটির বরাদ্দ"]/following::*[text()="${label}"])[1]/following::*[@tabindex="0"][1]` });
  await h.tap(P, ent("কর্মী"), 700);
  await h.tap(P, t("উদাহরণ শ্রেণি শিক্ষক", { last: true }), 900);
  await h.tap(P, ent("ছুটির ধরন"), 700);
  await h.tap(P, t("নৈমিত্তিক", { last: true }), 900);
  await fill(h, P, "বরাদ্দ (দিন)", "15");
  await fill(h, P, "জমা / গত বছর (দিন)", "3");
  await h.shot(
    P,
    "hr-leave-allowance",
    1,
    [ent("কর্মী"), ent("ছুটির ধরন"), fld("বরাদ্দ (দিন)"), fld("জমা / গত বছর (দিন)"), t("বরাদ্দ সংরক্ষণ")],
    { anchor: t("ছুটির বরাদ্দ") },
  );
  // approve: both pending leaves
  await fresh(P);
  await menu(h, P, "কর্মী");
  await h.tap(P, { text: "ছুটি ব্যবস্থাপনা", minY: 100 }, 3500);
  await h.shot(P, "hr-leave-approve", 2, [t("আবেদিত", { minY: 100 }), t("অনুমোদন"), t("প্রত্যাখ্যান")], { anchor: t("অবস্থা অনুযায়ী") });
  await h.tap(P, "অনুমোদন", 3500);
  await h.tap(P, "অনুমোদন", 3500);
  await h.tap(P, t("অনুমোদিত", { minY: 100 }), 3000);
  await h.shot(P, "hr-leave-approve", 3, [t("অনুমোদিত", { minY: 100 }), { re: "^সবেতন: " }], { anchor: t("অবস্থা অনুযায়ী") });
}

async function principalStaff(h, P) {
  await fresh(P);
  await menu(h, P, "প্রশাসন", "hr-staff-open", 0);
  await h.shot(P, "hr-staff-open", 1, [t("কর্মী তালিকা", { minY: 100 })]);
  await h.tap(P, { text: "কর্মী তালিকা", minY: 100 }, 3500);
  await h.shot(P, "hr-staff-open", 2, [{ placeholder: "নাম বা ফোন দিয়ে খুঁজুন" }, t("শিক্ষক"), t("উদাহরণ ইংরেজি শিক্ষক")]);
  await h.shot(P, "hr-leave-balances", 0, [t("উদাহরণ ইংরেজি শিক্ষক")]);
  await h.tap(P, "উদাহরণ ইংরেজি শিক্ষক", 4000);
  await h.shot(P, "hr-staff-open", 3, [t("উপস্থিতি", { minY: 150 })]);
  await h.shot(P, "hr-leave-balances", 1, [t("ছুটি", { minY: 150 })]);
  await h.tap(P, t("ছুটি", { minY: 150 }), 2500);
  await h.shot(P, "hr-leave-balances", 2, [t("নেওয়া"), t("স্থায়ী হলে পাবেন"), t("প্রবেশনকালীন জমা")], { anchor: t("বার্ষিক ছুটির পুল") });
}

async function principalMistakes(h, P) {
  await openHr(h, P, "ব্যাখ্যা যাচাই", { menu: "staff-mistakes-review", cards: [["staff-mistakes-review", 1]] });
  await h.shot(P, "staff-mistakes-review", 2, [t("বিবেচনাধীন", { minY: 100 }), t("সিদ্ধান্ত দিন")]);
  await h.tap(P, "সিদ্ধান্ত দিন", 1500);
  await fill(h, P, "কর্মীকে মন্তব্য (ঐচ্ছিক)", "ঠিক আছে — ওয়াইফাই সমস্যার কথা অফিসেও জানানো হয়েছে।");
  await h.shot(P, "staff-mistakes-review", 3, [fld("কর্মীকে মন্তব্য (ঐচ্ছিক)"), t("কারণ গ্রহণযোগ্য — গণ্য হবে না"), t("ভুল হিসেবে গণ্য"), t("অন্যের দায় — সরান")]);
  await h.tap(P, "কারণ গ্রহণযোগ্য — গণ্য হবে না", 3000);

  await openHr(h, P, "কর্মীর ভুলের হিসাব", { cards: [["staff-mistakes-summary", 0]] });
  await h.shot(P, "staff-mistakes-summary", 1, [t("গত ৩০ দিন"), t("উদাহরণ ইংরেজি শিক্ষক")]);
  await h.tap(P, "উদাহরণ ইংরেজি শিক্ষক", 3500);
  await h.shot(P, "staff-mistakes-summary", 2, [t("আলোচনার সময় ঠিক করুন"), t("আলোচনার রেকর্ড লিখুন")], { anchor: t("সতর্কবার্তা ও আলোচনা") });
  await h.tap(P, "আলোচনার সময় ঠিক করুন", 1200);
  await fill(h, P, "তারিখ ও সময় (যেমন 2026-11-10 12:30)", "2026-11-10 12:30");
  await fill(h, P, "জায়গা", "প্রধান শিক্ষকের কক্ষ");
  await h.shot(P, "staff-mistakes-summary", 3, [fld("তারিখ ও সময় (যেমন 2026-11-10 12:30)"), fld("জায়গা"), t("সংরক্ষণ")], {
    anchor: t("সতর্কবার্তা ও আলোচনা"),
  });
  await h.tap(P, "সংরক্ষণ", 3000);

  await openHr(h, P, "ভুলের রেকর্ড — নিয়ম", { cards: [["staff-mistakes-rules", 0]] });
  await h.shot(P, "staff-mistakes-rules", 1, [t("সতর্কবার্তার সিঁড়ি"), t("একটি গণ্য ভুলের ওজন")], { anchor: t("সতর্কবার্তার সিঁড়ি") });
  await h.shot(P, "staff-mistakes-rules", 2, [t("ব্যাখ্যা দেওয়ার সময়"), t("যেসব জায়গায় চালু")], { anchor: t("ব্যাখ্যা দেওয়ার সময়") });
  await h.shot(P, "staff-mistakes-rules", 3, [t("সংরক্ষণ")], { anchor: t("সংরক্ষণ") });
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the hr spec saves while it walks; run it locally (see its header)");
  // capture.cjs looks for an anchor without scrolling; bring it on screen first.
  const shot0 = h.shot;
  h.shot = async (page, guide, row, targets, opts = {}) => {
    if (opts.anchor) await h.topmost(page, opts.anchor, { scroll: true }).catch(() => {});
    return shot0(page, guide, row, targets, opts);
  };
  const only = (process.env.HR_WALKS || "").split(",").filter(Boolean);
  const safe = async (name, fn) => {
    if (only.length && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      failures.push(name);
      console.error(`WALK FAILED: ${name}
${String(e.stack || e).slice(0, 1500)}`);
    }
  };
  const failures = [];
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await safe("teacherLeave", () => teacherLeave(h, T));
  await safe("teacherMistake", () => teacherMistake(h, T));

  const P = (await h.login("principal@help.test", PASSWORD)).page;
  await safe("principalCover", () => principalCover(h, P));
  await safe("principalLeave", () => principalLeave(h, P));
  await safe("principalStaff", () => principalStaff(h, P));
  await safe("principalMistakes", () => principalMistakes(h, P));
  if (failures.length) console.error(`FAILED WALKS: ${failures.join(", ")}`);
};
