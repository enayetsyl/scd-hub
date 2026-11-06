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
const sel = (label, extra = {}) => ({ css: `xpath=//*[text()="${label}"]/following-sibling::*[@tabindex="0"][1]`, ...extra });
/** The text box right after its label. */
const fld = (label, extra = {}) => ({ css: `xpath=//*[text()="${label}"]/following::*[self::input or self::textarea][1]`, ...extra });
/** The text box inside the same field wrapper as its label (when the label text repeats elsewhere). */
const fldIn = (label, extra = {}) => ({ css: `xpath=//*[text()="${label}"]/parent::*//*[self::input or self::textarea]`, ...extra });
/** A DateField's tap target (web). */
const dateBtn = (label) => ({ css: `button[aria-label="${label}"]` });
const t = (text, extra = {}) => ({ text, ...extra });

// ── Actions ─────────────────────────────────────────────────────────────────
async function fresh(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(5500);
  await relogin(page);
}
/** A long walk can land back on the sign-in page; sign in again as the same example login. */
async function relogin(page) {
  const box = page.getByPlaceholder("you@school.edu / 01XXXXXXXXX");
  if (!page.__hrUser) return;
  const formShown = async () =>
    (await box.count()) > 0 &&
    (await box.first().evaluate((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === e || e.contains(hit));
    }).catch(() => false));
  // A sign-in still in flight also shows the form: give it time before typing again.
  for (let i = 0; i < 20 && (await formShown()); i++) await page.waitForTimeout(1000);
  if (!(await formShown())) return;
  await box.first().fill(page.__hrUser);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByText("লগইন", { exact: true }).last().click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(7000);
}
/** Open a Select and choose an option from ITS menu (the chosen label also shows in other
 *  triggers, so a plain text match can land on the wrong one). `contains` matches part of the label. */
async function pick(h, page, label, option, wait = 900, { contains = false } = {}) {
  await h.tap(page, sel(label), 700);
  const cond = contains ? `contains(text(),"${option}")` : `text()="${option}"`;
  await h.tap(page, { css: `xpath=//*[text()="${label}"]/following-sibling::*[@tabindex="0"][1]/following-sibling::*//*[${cond}]` }, wait);
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
  await pick(h, P, "কর্মী", "উদাহরণ দারোয়ান");
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
  // the needs-cover inbox (both leaves are approved now, so their open periods show)
  await h.shot(P, "hr-cover-needs", 0, [t("কভার প্রয়োজন")], { anchor: t("কভার প্রয়োজন") });
  await h.tap(P, t("কভার প্রয়োজন"), 4000);
  await h.shot(P, "hr-cover-needs", 1, [dateBtn("তারিখ (YYYY-MM-DD)"), t("শিক্ষক নির্বাচন করুন…"), t("অনুমোদন")]);
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

/** The header ← of a pushed screen (falls back to browser history). */
async function back(h, page) {
  const btn = await h.topmost(page, { css: '[aria-label="Go back"]' }, { scroll: false }).catch(() => null);
  if (btn) await btn.click();
  else await page.goBack();
  await page.waitForTimeout(2500);
}

async function teacherSelf(h, T) {
  // আমার চিঠি
  await openHr(h, T, "আমার চিঠি", { menu: "hr-my-letters", cards: [["hr-my-letters", 1]] });
  await h.shot(T, "hr-my-letters", 2, [t("PDF দেখুন")]);
  // আমার রেকর্ড: record, attendance, grievance
  await fresh(T);
  await h.openMenu(T);
  await h.shot(T, "hr-my-record", 0, [t("কর্মী")]);
  await h.shot(T, "hr-grievance-raise", 0, [t("কর্মী")]);
  await h.tap(T, "কর্মী", 3000);
  for (const [g, row] of [["hr-my-record", 1], ["hr-my-attendance", 0], ["hr-grievance-raise", 1]]) {
    await h.shot(T, g, row, [t("আমার রেকর্ড", { minY: 100 })]);
  }
  await h.tap(T, { text: "আমার রেকর্ড", minY: 100 }, 3500);
  await h.shot(T, "hr-my-attendance", 1, [t("গত ৩০ দিনের উপস্থিতি"), t("বিলম্বে"), t("07:24 AM · 01:10 PM")], {
    anchor: t("গত ৩০ দিনের উপস্থিতি"),
  });
  await h.shot(T, "hr-my-record", 2, [t("বার্ষিক মূল্যায়ন"), t("আচরণ রেকর্ড")], { anchor: t("বার্ষিক মূল্যায়ন") });
  await fill(h, T, "বিষয়", "শিক্ষকদের কক্ষে খাবার পানির ব্যবস্থা নেই");
  await fill(h, T, "বিস্তারিত", "দুই সপ্তাহ ধরে শিক্ষকদের কক্ষের পানির ফিল্টার নষ্ট। অফিসে মুখে জানানো হয়েছে।");
  await h.shot(T, "hr-grievance-raise", 2, [fld("বিষয়"), fld("বিস্তারিত"), t("অভিযোগ জমা দিন")], { anchor: t("আমার অভিযোগ") });
}

async function teacherObservation(h, T) {
  await fresh(T);
  await menu(h, T, "পর্যবেক্ষণ", "hr-obs-reply", 0);
  await h.shot(T, "hr-obs-reply", 1, [t("আমার পর্যবেক্ষণ", { minY: 100 })]);
  await h.tap(T, { text: "আমার পর্যবেক্ষণ", minY: 100 }, 3500);
  await h.shot(T, "hr-obs-reply", 2, [t("পর্যবেক্ষণ বিবরণ")]);
  await h.tap(T, "পর্যবেক্ষণ বিবরণ", 4000);
  await fill(h, T, "শিক্ষকের জবাব", "পরামর্শের জন্য ধন্যবাদ। পরের ক্লাস থেকে পেছনের সারিতেও প্রশ্ন করব।");
  await h.shot(T, "hr-obs-reply", 3, [fld("শিক্ষকের জবাব"), t("জবাব দিন")], { bottom: true });
  await h.tap(T, "জবাব দিন", 3000);
}

const DOMAINS = ["পরিকল্পনা ও স্পষ্টতা", "প্রশ্ন ও চিন্তন (ব্লুম)", "সম্পৃক্ততা ও অংশগ্রহণ", "মূল্যায়ন ও ফিডব্যাক", "শ্রেণিকক্ষের পরিবেশ ও ব্যবস্থাপনা"];
const DOMAIN_NOTES = [
  "পাঠের লক্ষ্য শুরুতেই বলেছেন।",
  "কয়েকটি “কেন” প্রশ্ন ছিল, বাকিগুলো মনে রাখার প্রশ্ন।",
  "জোড়ায় কাজে প্রায় সবাই অংশ নিয়েছে।",
  "শেষে তিনটি প্রশ্নে বোঝা যাচাই করেছেন।",
  "শ্রেণিকক্ষ শান্ত ছিল।",
];
async function observerReview(h, T2) {
  // teacher2 has a booked warning meeting: the pop-up greets them first.
  const okBtn = T2.getByText("বুঝেছি — সময়টা ঠিক আছে", { exact: true });
  await okBtn.first().waitFor({ timeout: 20000 }).catch(() => {});
  if (await okBtn.count()) {
    await h.shot(T2, "hr-mistake-warning", 0, [t("সতর্কবার্তা"), t("বুঝেছি — সময়টা ঠিক আছে"), t("অন্য সময় চাই")]);
    await h.tap(T2, "বুঝেছি — সময়টা ঠিক আছে", 2500);
  }
  await fresh(T2);
  await menu(h, T2, "পর্যবেক্ষণ");
  await h.tap(T2, { text: "আমার রিভিউ কিউ", minY: 100 }, 3500);
  await h.shot(T2, "hr-obs-review", 0, [t("রিভিউ করুন")]);
  await h.tap(T2, "রিভিউ করুন", 4500);
  for (const [i, d] of DOMAINS.entries()) {
    await pick(h, T2, d, ["কার্যকর মান", "বিকাশমান", "কার্যকর মান", "শক্তিশালী", "কার্যকর মান"][i]);
    await fill(h, T2, d, DOMAIN_NOTES[i]);
  }
  await h.shot(T2, "hr-obs-review", 1, [sel(DOMAINS[0]), fld(DOMAINS[0])], { anchor: t("ডোমেইন স্কোর (১–৪)") });
  await pick(h, T2, "নিরাপদ ও সম্মানজনক পরিবেশ", "উত্তীর্ণ");
  await pick(h, T2, "অন্তর্ভুক্তি ও ন্যায্য আচরণ", "উত্তীর্ণ");
  await (await h.topmost(T2, fldIn("একটি ভালো দিক"), { scroll: true })).fill("জোড়ায় কাজের নির্দেশনা খুব পরিষ্কার ছিল।");
  await (await h.topmost(T2, fldIn("উন্নতির লক্ষ্য"), { scroll: true })).fill("প্রশ্নের পর একটু অপেক্ষা করুন, যাতে সবাই ভাবার সময় পায়।");
  await T2.waitForTimeout(600);
  await h.shot(T2, "hr-obs-review", 2, [sel("নিরাপদ ও সম্মানজনক পরিবেশ"), fldIn("একটি ভালো দিক"), fldIn("উন্নতির লক্ষ্য")], { anchor: t("গেট", { exact: true }) });
  await h.shot(T2, "hr-obs-review", 3, [t("রিভিউ জমা দিন")], { bottom: true });
  await h.tap(T2, "রিভিউ জমা দিন", 4000);
}

async function principalPolicy(h, P) {
  await openHr(h, P, "এইচআর নীতিমালা", { cards: [["hr-policy", 0]] });
  await h.shot(P, "hr-policy", 1, [fld("বার্ষিক ছুটির পুল (দিন)"), t("প্রবেশনকালীন ছুটি জমা রাখা")], { anchor: t("ছুটির নীতিমালা") });
  await h.shot(P, "hr-policy", 2, [t("বিলম্ব কর্তন চালু"), fld("কত দিন বিলম্বে ১ দিন কর্তন"), fld("স্বাক্ষরকারীর নাম")], { anchor: t("বিলম্ব কর্তন") });
  await h.shot(P, "hr-policy", 3, [t("সংরক্ষণ", { last: true })], { anchor: t("সংরক্ষণ", { last: true }) });
}

async function principalLetters(h, P) {
  await openStaff(h, P, "উদাহরণ শ্রেণি শিক্ষক");
  await h.shot(P, "hr-letter-issue", 0, [t("কাগজপত্র", { minY: 150 })]);
  await h.tap(P, t("কাগজপত্র", { minY: 150 }), 3000);
  await h.shot(P, "hr-letter-send", 0, [t("অ্যাপে পাঠান")], { anchor: t("ইস্যু করা পত্র") });
  await h.shot(P, "hr-letter-void", 0, [t("বাতিল করুন")], { anchor: t("ইস্যু করা পত্র") });
  await h.tap(P, "অ্যাপে পাঠান", 1200);
  await h.tap(P, "দুটোই", 600);
  await h.shot(P, "hr-letter-send", 1, [t("দুটোই"), t("পাঠান")], { anchor: t("ইস্যু করা পত্র") });
  await h.tap(P, "পাঠান", 3500);
  await h.tap(P, "বাতিল করুন", 1200);
  await fill(h, P, "বাতিলের কারণ লিখুন", "পত্রের তারিখ ভুল ছিল");
  const voidBtn = { css: 'xpath=//*[text()="বাতিলের কারণ লিখুন"]/following::*[text()="বাতিল করুন"][1]' };
  await h.shot(P, "hr-letter-void", 1, [fld("বাতিলের কারণ লিখুন"), voidBtn], { anchor: t("ইস্যু করা পত্র") });
  await h.shot(P, "hr-letter-issue", 1, [t("প্রত্যয়নপত্র")], { anchor: t("নতুন পত্র তৈরি") });
  await h.tap(P, "প্রত্যয়নপত্র", 3500);
  await h.tap(P, "দুটোই", 600);
  await h.shot(P, "hr-letter-issue", 2, [fld("পদবি"), fld("পত্রের তারিখ"), t("দুটোই")]);
  await h.shot(P, "hr-letter-issue", 3, [t("প্রিভিউ দেখুন"), t("তৈরি করে PDF")], { bottom: true });
}

async function principalStaffRecords(h, P) {
  const name = "উদাহরণ ইংরেজি শিক্ষক";
  await openStaff(h, P, name, { listShots: ["hr-staff-edit", "hr-staff-confirm", "hr-staff-attendance"] });
  await h.shot(P, "hr-staff-edit", 1, [t("সম্পাদনা", { minY: 150 })], { anchor: t("দ্রুত কাজ") });
  await h.shot(P, "hr-staff-confirm", 1, [t("স্থায়ীকরণ", { minY: 150 })], { anchor: t("দ্রুত কাজ") });
  await h.shot(P, "hr-staff-attendance", 1, [t("উপস্থিতি", { minY: 150 })]);
  await h.tap(P, t("উপস্থিতি", { minY: 150 }), 3000);
  await h.shot(P, "hr-staff-attendance", 2, [t("‹"), t("সারাংশ"), t("প্রবেশ ও প্রস্থানের সময়")], { anchor: t("‹") });
  await h.tap(P, t("সম্পাদনা", { minY: 100 }), 3500);
  await fill(h, P, "পদবি", "সহকারী শিক্ষক (ইংরেজি)");
  await h.shot(P, "hr-staff-edit", 2, [fld("পদবি"), fld("যোগদানের তারিখ")], { anchor: t("পদবি") });
  await h.shot(P, "hr-staff-edit", 3, [t("সংরক্ষণ")], { bottom: true });
  await back(h, P);
  await h.tap(P, t("স্থায়ীকরণ", { minY: 100 }), 3500);
  await (await h.topmost(P, fldIn("স্থায়ীকরণের তারিখ"), { scroll: true })).fill("2026-11-01");
  await h.shot(P, "hr-staff-confirm", 2, [fldIn("স্থায়ীকরণের তারিখ"), t("যা যা বদলাবে")], { anchor: t("স্থায়ীকরণের তারিখ") });
  await h.shot(P, "hr-staff-confirm", 3, [t("হ্যাঁ"), t("নিশ্চিত করুন")], { bottom: true });
}

async function principalStaffAdd(h, P) {
  await fresh(P);
  await menu(h, P, "প্রশাসন");
  await h.tap(P, { text: "কর্মী তালিকা", minY: 100 }, 3500);
  await h.shot(P, "hr-staff-add", 0, [t("+ নতুন কর্মী")]);
  await h.tap(P, "+ নতুন কর্মী", 3500);
  await fill(h, P, "নাম *", "Example New Teacher");
  await fill(h, P, "বাংলা নাম", "উদাহরণ নতুন শিক্ষক");
  await fill(h, P, "পদবি *", "সহকারী শিক্ষক");
  const idBox = await h.topmost(P, fldIn("আইডি *"), { scroll: true });
  if (!(await idBox.inputValue())) await idBox.fill("S-08");
  await h.tap(P, { css: 'xpath=//*[text()="ক্যাটাগরি *"]/following::*[text()="শিক্ষক"][1]' }, 500);
  await h.tap(P, { css: 'xpath=//*[text()="চাকরির ধরন *"]/following::*[text()="পূর্ণকালীন"][1]' }, 500);
  await h.shot(P, "hr-staff-add", 1, [fld("নাম *"), fld("পদবি *"), t("ক্যাটাগরি *")], { anchor: t("নাম *") });
  await (await h.topmost(P, fldIn("ফোন"), { scroll: true })).fill("01700000008");
  await h.shot(P, "hr-staff-add", 2, [fldIn("ফোন"), t("পরবর্তী: বেতন")], { bottom: true });
  await h.tap(P, "পরবর্তী: বেতন", 4000);
  await fill(h, P, "মাসিক বেতন", "20000");
  await h.shot(P, "hr-staff-add", 3, [fld("মাসিক বেতন")], { anchor: t("মাসিক বেতন") });
}

async function principalPerformance(h, P) {
  const name = "উদাহরণ ইংরেজি শিক্ষক";
  await openHr(h, P, "পারফরম্যান্স", { cards: [["hr-grievance-resolve", 0]] });
  await pick(h, P, "কর্মী", name);
  for (const g of ["hr-appraisal-prepare", "hr-cpd-log", "hr-conduct-record"]) await h.shot(P, g, 0, [sel("কর্মী"), t(name, { last: true })]);
  await h.tap(P, t(name, { last: true }), 3500);
  await h.shot(P, "hr-appraisal-prepare", 1, [t("বার্ষিক মূল্যায়ন")]);
  await h.shot(P, "hr-cpd-log", 1, [t("পেশাগত উন্নয়ন (CPD)")]);
  await h.shot(P, "hr-conduct-record", 1, [t("আচরণ")]);
  // appraisal
  await h.tap(P, "বার্ষিক মূল্যায়ন", 3500);
  await fill(h, P, "লক্ষ্য (প্রতি লাইনে একটি)", "প্রতি সপ্তাহে একটি পাঠ পরিকল্পনা জমা দেওয়া\nশিক্ষার্থীদের বলার দক্ষতা বাড়ানো");
  await fill(h, P, "উন্নয়ন প্রয়োজন (প্রতি লাইনে একটি)", "শ্রেণিকক্ষ ব্যবস্থাপনা প্রশিক্ষণ");
  await h.shot(P, "hr-appraisal-prepare", 2, [fld("লক্ষ্য (প্রতি লাইনে একটি)"), fld("উন্নয়ন প্রয়োজন (প্রতি লাইনে একটি)"), t("খসড়া সংরক্ষণ")]);
  await h.tap(P, "খসড়া সংরক্ষণ", 3000);
  await back(h, P);
  // CPD
  await h.tap(P, "পেশাগত উন্নয়ন (CPD)", 3500);
  await fill(h, P, "কার্যক্রম", "শ্রেণিকক্ষ ব্যবস্থাপনা কর্মশালা (এক দিন)");
  await setDate(P, "তারিখ (ঐচ্ছিক)", "2026-11-03");
  await fill(h, P, "ফলাফল", "দলগত কাজের নতুন কৌশল শিখেছেন");
  await h.shot(P, "hr-cpd-log", 2, [fld("কার্যক্রম"), dateBtn("তারিখ (ঐচ্ছিক)"), fld("ফলাফল"), t("জমা দিন")]);
  await h.tap(P, "জমা দিন", 3000);
  await back(h, P);
  // conduct: a new step (shown, not sent) and the hearing on the existing draft
  await h.tap(P, "আচরণ", 3500);
  await pick(h, P, "ধাপ", "লিখিত সতর্কতা");
  await fill(h, P, "বিষয়", "অনুমতি ছাড়া ক্লাস শেষ হওয়ার আগে চলে যাওয়া");
  await h.shot(P, "hr-conduct-record", 2, [sel("ধাপ"), fld("বিষয়"), t("জমা দিন")]);
  await fill(h, P, "শুনানির বিবরণ", "কর্মী জানিয়েছেন বাসার দূরত্বের কারণে দেরি হয়েছে; এখন থেকে সময়মতো আসবেন।");
  await h.shot(P, "hr-conduct-hearing", 0, [fld("শুনানির বিবরণ"), t("শুনানি রেকর্ড করুন")], { anchor: t("শুনানির বিবরণ") });
  await h.tap(P, "শুনানি রেকর্ড করুন", 3000);
  // grievance inbox
  await back(h, P);
  await back(h, P);
  await h.shot(P, "hr-grievance-resolve", 1, [t("অভিযোগ", { minY: 100 })]);
  await h.tap(P, { text: "অভিযোগ", minY: 100 }, 3500);
  await pick(h, P, "অবস্থা পরিবর্তন", "পর্যালোচনাধীন");
  await fill(h, P, "সমাধান নোট (ঐচ্ছিক)", "রক্ষণাবেক্ষণ কর্মীকে জানানো হয়েছে; এই সপ্তাহে পাখা বদলানো হবে।");
  await h.shot(P, "hr-grievance-resolve", 2, [t("উত্থাপিত", { minY: 100 }), sel("অবস্থা পরিবর্তন"), fld("সমাধান নোট (ঐচ্ছিক)"), t("অবস্থা পরিবর্তন", { last: true })]);
  await h.tap(P, t("অবস্থা পরিবর্তন", { last: true }), 3000);
}

async function principalExit(h, P) {
  await openHr(h, P, "অফবোর্ডিং", { menu: "hr-offboarding-start", cards: [["hr-offboarding-start", 1]] });
  await pick(h, P, "কর্মী", "উদাহরণ দারোয়ান");
  await pick(h, P, "কারণ", "পদত্যাগ");
  await setDate(P, "শেষ কর্মদিবস", "2026-12-31");
  await h.shot(P, "hr-offboarding-start", 2, [sel("কর্মী"), sel("কারণ"), dateBtn("শেষ কর্মদিবস"), t("শুরু করুন")]);
  await h.shot(P, "hr-offboarding-clearance", 0, [t("উদাহরণ সহায়ক কর্মী", { last: true })]);
  await h.shot(P, "hr-offboarding-dues", 0, [t("উদাহরণ সহায়ক কর্মী", { last: true })]);
  await h.tap(P, t("উদাহরণ সহায়ক কর্মী", { last: true }), 3500);
  await pick(h, P, "অবস্থা", "সম্পন্ন");
  await fill(h, P, "নোট (ঐচ্ছিক)", "চাবি ও লাইব্রেরির বই ফেরত দিয়েছেন");
  await h.shot(P, "hr-offboarding-clearance", 1, [sel("অবস্থা"), fld("নোট (ঐচ্ছিক)"), t("আইটেম হালনাগাদ করুন")], { anchor: t("ক্লিয়ারেন্স চেকলিস্ট") });
  await h.tap(P, "আইটেম হালনাগাদ করুন", 3000);
  await fill(h, P, "মতামত", "স্কুলের পরিবেশ ভালো লেগেছে; বাসা বদলের কারণে চাকরি ছাড়ছেন।");
  await h.shot(P, "hr-offboarding-clearance", 2, [fld("মতামত"), t("সংরক্ষণ")], { anchor: t("প্রস্থান সাক্ষাৎকার") });
  await h.tap(P, "সংরক্ষণ", 3000);
  await h.shot(P, "hr-offboarding-access", 0, [t("এখনই অ্যাক্সেস বাতিল করুন")], { anchor: t("সিস্টেম অ্যাক্সেস") });
  await fill(h, P, "মাসের কর্মদিবস", "26");
  await fill(h, P, "বকেয়া পরিমাণ (ঐচ্ছিক)", "1500");
  await h.shot(P, "hr-offboarding-dues", 1, [fld("মাসের কর্মদিবস"), fld("বকেয়া পরিমাণ (ঐচ্ছিক)"), t("গণনা করুন")], { anchor: t("নিষ্পত্তি গণনা করুন") });
  await h.tap(P, "গণনা করুন", 3500);
  await h.shot(P, "hr-offboarding-dues", 2, [t("চূড়ান্ত নিষ্পত্তি")], { anchor: t("চূড়ান্ত নিষ্পত্তি") });
  await h.shot(P, "hr-offboarding-certificate", 0, [t("সার্টিফিকেট ইস্যু করুন")], { anchor: t("সার্ভিস সার্টিফিকেট") });
}

async function principalObservation(h, P) {
  await fresh(P);
  await menu(h, P, "পর্যবেক্ষণ");
  await h.shot(P, "hr-obs-upload", 0, [t("নতুন পর্যবেক্ষণ আপলোড")]);
  await h.tap(P, "নতুন পর্যবেক্ষণ আপলোড", 3500);
  await pick(h, P, "ফর্ম", "REF-11 ফর্ম");
  await pick(h, P, "বিষয়", "ইংরেজি");
  await pick(h, P, "শিক্ষকের নাম", "উদাহরণ ইংরেজি শিক্ষক");
  await pick(h, P, "পর্যবেক্ষকের আইডি (ঐচ্ছিক)", "উদাহরণ শিক্ষক");
  await h.shot(P, "hr-obs-upload", 1, [sel("ফর্ম"), sel("বিষয়"), sel("শিক্ষকের নাম"), sel("পর্যবেক্ষকের আইডি (ঐচ্ছিক)")], { anchor: t("ফর্ম") });
  await setDate(P, "ক্লাসের তারিখ", "2026-11-04");
  await pick(h, P, "ক্লাসের নাম", "বালিকা", 900, { contains: true });
  await fill(h, P, "ইউটিউব লিংক", "https://youtu.be/exampleVid1");
  await h.shot(P, "hr-obs-upload", 2, [dateBtn("ক্লাসের তারিখ"), sel("ক্লাসের নাম"), t("আপলোড করুন")], { bottom: true });
  await h.tap(P, "আপলোড করুন", 4000);

  await fresh(P);
  await menu(h, P, "পর্যবেক্ষণ");
  await h.shot(P, "hr-obs-publish", 0, [t("সকল পর্যবেক্ষণ")]);
  await h.tap(P, "সকল পর্যবেক্ষণ", 3500);
  await h.tap(P, "প্রকাশের অপেক্ষায়", 3500);
  // newest class date first: the fixture's reviewed English class (2026-11-02) is the last card
  const detail = t("পর্যবেক্ষণ বিবরণ", { last: true });
  await h.shot(P, "hr-obs-publish", 1, [t("প্রকাশের অপেক্ষায়")], { anchor: t("প্রকাশ অবস্থা") });
  await P.waitForTimeout(2500);
  await h.shot(P, "hr-obs-publish", 2, [detail], { bottom: true });
  await h.tap(P, detail, 4500);
  await h.shot(P, "hr-obs-publish", 3, [t("শিক্ষকের কাছে প্রকাশ করুন"), t("প্রকাশ স্থগিত করুন")], { anchor: t("শিক্ষকের কাছে প্রকাশ করুন") });
  await h.tap(P, "শিক্ষকের কাছে প্রকাশ করুন", 3500);
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the hr spec saves while it walks; run it locally (see its header)");
  // capture.cjs looks for an anchor without scrolling; bring it on screen first.
  const shot0 = h.shot;
  // `bottom: true` scrolls the page to its end and pins it there: capture.cjs would otherwise
  // scroll the first target to the middle (or an anchor to the top, minus 70px), and a button
  // at the very end of a page then falls below the picture.
  h.shot = async (page, guide, row, targets, opts = {}) => {
    if (opts.bottom) {
      await page.evaluate(() => {
        const boxes = [...document.querySelectorAll("div")].filter((d) => {
          const s = getComputedStyle(d);
          const r = d.getBoundingClientRect();
          return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight && r.width > 300 && r.height > 400 && r.left >= 0 && r.left < 50;
        });
        for (const b of boxes) b.scrollTop = b.scrollHeight;
        document.getElementById("hrw-keep")?.remove();
        const main = boxes.filter((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit && b.contains(hit);
        }).pop();
        if (!main) return;
        // A marker 70px below the visible top: "scroll it to the top, then back 70px" is a no-op.
        // The page is at its end, so 70px of room is added below it first (else the scroll clamps).
        const host = main.firstElementChild || main;
        document.getElementById("hrw-room")?.remove();
        const room = document.createElement("div");
        room.id = "hrw-room";
        room.style.cssText = "height:70px;flex-shrink:0";
        host.appendChild(room);
        const m = document.createElement("div");
        m.id = "hrw-keep";
        m.style.cssText = `position:absolute;left:0;top:${main.scrollTop + 70}px;width:2px;height:2px;z-index:99999`;
        host.appendChild(m);
      });
      await page.waitForTimeout(400);
      opts = { ...opts, anchor: { css: "#hrw-keep" } };
    } else if (opts.anchor) await h.topmost(page, opts.anchor, { scroll: true }).catch(() => {});
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
  const as = async (user) => {
    const page = (await h.login(user, PASSWORD)).page;
    page.__hrUser = user;
    await relogin(page);
    return page;
  };
  const T = await as("teacher@help.test");
  await safe("teacherLeave", () => teacherLeave(h, T));
  await safe("teacherMistake", () => teacherMistake(h, T));
  await safe("teacherSelf", () => teacherSelf(h, T));
  await safe("teacherObservation", () => teacherObservation(h, T));

  const T2 = await as("teacher2@help.test");
  await safe("observerReview", () => observerReview(h, T2));

  const P = await as("principal@help.test");
  await safe("principalCover", () => principalCover(h, P));
  await safe("principalLeave", () => principalLeave(h, P));
  await safe("principalStaff", () => principalStaff(h, P));
  await safe("principalMistakes", () => principalMistakes(h, P));
  await safe("principalPolicy", () => principalPolicy(h, P));
  await safe("principalLetters", () => principalLetters(h, P));
  await safe("principalStaffRecords", () => principalStaffRecords(h, P));
  await safe("principalPerformance", () => principalPerformance(h, P));
  await safe("principalExit", () => principalExit(h, P));
  await safe("principalObservation", () => principalObservation(h, P));
  await safe("principalStaffAdd", () => principalStaffAdd(h, P));
  if (failures.length) console.error(`FAILED WALKS: ${failures.join(", ")}`);
};
