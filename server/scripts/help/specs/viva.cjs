/**
 * Capture spec — Nursery oral exam (viva, D-#1080–#1084, D-#1275–#1277, D-#1281): the teacher's Today
 * card, the tap that draws a child's set, letter and number marks, absent; the Office's paper
 * editor (questions, sets, letter questions, the wording fix after the start), examiners and the
 * per-child move, live progress, results and lock.
 *
 * LOCAL ONLY: it draws, marks, saves examiners and fixes a question's wording, because those
 * screens only exist after those steps. Data: scripts/help/fixtures/viva.ts (--reset first):
 * নার্সারি, 22 example children, বাংলা oral TODAY (teacher@help.test), ইংরেজি in 3 days, আরবি
 * picture oral tomorrow (D-#1282: the Office's picture picker, the teacher's picture viewer).
 * The fixture draws its example pictures with Chrome, so set PLAYWRIGHT_CORE for it too.
 */
const L = require("./exam-lib.cjs");
const SETS = require("../../../assets/viva/nursery-sets-2026.json");

const VIVA = "মৌখিক পরীক্ষা";
const BAN = "নার্সারি · বাংলা";
const ENG = "নার্সারি · ইংরেজি";
const FIRST = "আয়েশা সিদ্দিকা"; // roll ১
const THIRD = "ফাতিমা জান্নাত"; // roll ৩
const LAST = "২২. হামজা রশিদ"; // the examiners screen shows "roll. name"
const T1 = "উদাহরণ শ্রেণি শিক্ষক";
const T2 = "উদাহরণ ইংরেজি শিক্ষক";
const BN = "০১২৩৪৫৬৭৮৯";

/** A paper card's button, found after the card's "class · subject" title. */
const inCard = (title, label) => ({ css: `xpath=//*[normalize-space(.)='${title}']/following::*[normalize-space(text())='${label}'][1]` });
/** The first element with exactly `label` after the element whose text is exactly `after`. */
const after = (afterText, label) => ({ css: `xpath=//*[normalize-space(.)='${afterText}']/following::*[normalize-space(text())='${label}'][1]` });

async function expectText(page, re, what) {
  const body = await page.locator("body").innerText();
  if (!re.test(body)) throw new Error(`expected ${what} (${re}) on screen`);
  console.log(`ok: ${what}`);
}

async function teacher(h) {
  const T = await L.login(h, "teacher@help.test");
  await h.shot(T, "exam-viva-examine", 0, [{ text: "তালিকা খুলে নম্বর দিন" }], { anchor: { text: "আজ মৌখিক পরীক্ষা" } });
  await h.tap(T, "তালিকা খুলে নম্বর দিন", 5000);

  // Before the draw: only the names.
  await h.shot(T, "exam-viva-examine", 1, [{ text: FIRST }, { text: "সেট আনুন" }]);
  await h.tap(T, { text: FIRST }, 3500);
  const badge = await (await h.topmost(T, { re: "^সেট [১-৮]$" }, { scroll: false })).innerText();
  const n = BN.indexOf(badge.trim().slice(-1));
  const set = SETS.papers.find((p) => p.subject === "BAN").sets[n - 1];
  console.log(`ok: drew ${badge.trim()} (${set.items[0].parts.join(",")})`);
  await h.tap(T, { text: FIRST }, 1500);
  if ((await (await h.topmost(T, { re: "^সেট [১-৮]$" }, { scroll: false })).innerText()).trim() !== badge.trim()) {
    throw new Error("a second tap changed the set");
  }
  console.log("ok: a second tap keeps the set");

  const firstLetter = set.items[0].parts[0];
  await h.shot(T, "exam-viva-examine", 2, [{ re: "^সেট [১-৮]$" }, { text: firstLetter }, { text: "২" }]);
  // Letters: ✓ ✓ ✗ ✓ = 1.5; the other questions 2 each = 8 → 9.5 / 10.
  const marksFor = [0.5, 0.5, 0, 0.5];
  for (const [i, letter] of set.items[0].parts.entries()) {
    await h.tap(T, { text: letter }, 900);
    if (marksFor[i] === 0) await h.tap(T, { text: `${letter} ✓` }, 900);
  }
  const twos = T.getByText("২", { exact: true }).locator("visible=true");
  for (let i = 0; i < 4; i++) {
    await twos.nth(i).click();
    await T.waitForTimeout(900);
  }
  // Letters 1.5 + a tap on "২" in each other question (min(2, its marks)).
  const want = 1.5 + set.items.slice(1).reduce((t, it) => t + Math.min(2, it.marks), 0);
  const whole = String(Math.floor(want)).replace(/\d/g, (d) => BN[d]);
  const half = want % 1 ? "(\\.৫|½)" : "";
  await expectText(T, new RegExp(`(^|\\s)${whole}${half}/১০`), `child 1 marked ${want}/10`);

  await h.shot(T, "exam-viva-examine", 3, [{ text: "অনুপস্থিত" }, { re: "^বাকি [০-৯]+$" }]);
  await h.tap(T, after(THIRD, "অনুপস্থিত"), 2500);
  await expectText(T, /অনুপস্থিত — মৌখিক ০ ধরা হবে/, "child 3 absent");
  await T.context().close();
}

async function office(h) {
  const O = await L.login(h, "office@help.test");
  await L.go(h, O, null, VIVA, 5000);

  // Home cards.
  await h.shot(O, "exam-viva-examiners", 0, [inCard(BAN, "পরীক্ষক")]);
  await h.shot(O, "exam-viva-paper", 0, [inCard(ENG, "প্রশ্নপত্র")], { anchor: { text: ENG } });

  // ইংরেজি paper (nothing drawn yet): sets, questions, letters.
  await h.tap(O, inCard(ENG, "প্রশ্নপত্র"), 4000);
  await h.shot(O, "exam-viva-sets", 0, [{ text: "+ সেট" }, { re: "^সেট ২ · " }]);
  await h.shot(O, "exam-viva-sets", 1, [{ text: "বর্ণগুলো (কমা দিয়ে)" }, { text: "প্রতি বর্ণে নম্বর" }], { anchor: { text: "প্রশ্ন ১" } });
  await h.shot(O, "exam-viva-paper", 1, [{ text: "প্রশ্ন ২" }, { text: "নম্বর" }], { anchor: { text: "প্রশ্ন ২" } });
  await h.topmost(O, { text: "+ প্রশ্ন যোগ করুন" }, { scroll: true });
  await h.shot(O, "exam-viva-paper", 2, [{ text: "+ প্রশ্ন যোগ করুন" }, { text: "সংরক্ষণ করুন" }], { anchor: { text: "+ প্রশ্ন যোগ করুন" } });
  await h.shot(O, "exam-viva-sets", 2, [{ text: "+ বর্ণের প্রশ্ন" }, { text: "এই সেট বাদ দিন" }], { anchor: { text: "+ প্রশ্ন যোগ করুন" } });
  await L.back(O);

  // Examiners of বাংলা: add the second teacher, split by roll, move the last child back, save.
  await h.tap(O, inCard(BAN, "পরীক্ষক"), 4000);
  await h.shot(O, "exam-viva-examiners", 1, [{ text: "শিক্ষক বাছাই করুন" }]);
  await L.pick(h, O, "শিক্ষক বাছাই করুন", T2);
  await h.shot(O, "exam-viva-examiners", 2, [{ text: "রোল অনুযায়ী সমান ভাগ করুন" }, { text: "এই পরীক্ষক বাদ দিন" }]);
  await h.tap(O, "রোল অনুযায়ী সমান ভাগ করুন", 1500);
  await h.topmost(O, { text: LAST }, { scroll: true });
  await h.shot(O, "exam-viva-examiners", 3, [after(LAST, T1), { text: "সংরক্ষণ করুন" }], { anchor: { text: LAST } });
  await h.tap(O, after(LAST, T1), 800);
  await h.tap(O, "সংরক্ষণ করুন", 4000);
  await expectText(O, new RegExp(`${T1} \\(১/১২\\)`), "teacher 1 now hears 12 (11 by roll + the moved child)");
  await expectText(O, new RegExp(`${T2} \\(০/১০\\)`), "teacher 2 hears 10");

  // Live progress, results, correction and lock.
  await h.shot(O, "exam-viva-monitor", 0, [{ re: "^২২ জনের মধ্যে" }, inCard(BAN, "ফলাফল")]);
  await h.shot(O, "exam-viva-monitor", 2, [inCard(BAN, "নম্বর দিন"), inCard(BAN, "নম্বর লক করুন")]);
  await h.tap(O, inCard(BAN, "ফলাফল"), 4000);
  await h.shot(O, "exam-viva-monitor", 1, [{ text: "সেট অনুযায়ী (অনুপস্থিত বাদে)" }, { text: "অনু." }]);
  await L.back(O);

  // The বাংলা paper after the first draw: wording only (D-#1281).
  await h.tap(O, inCard(BAN, "প্রশ্নপত্র"), 4000);
  await expectText(O, /এখন শুধু প্রশ্নের লেখা/, "frozen paper says wording only");
  const adds = await O.getByText("+ প্রশ্ন যোগ করুন", { exact: true }).locator("visible=true").count();
  if (adds !== 0) throw new Error("add-question is still offered after the draw");
  await h.topmost(O, { text: "প্রশ্ন ৫" }, { scroll: true });
  await h.shot(O, "exam-viva-paper", 3, [{ text: "প্রশ্ন ৫" }, { text: "সংরক্ষণ করুন" }], { anchor: { text: "প্রশ্ন ৫" } });
  await L.fillAfter(O, "প্রশ্ন ৫", "সপ্তাহের ৭ দিনের নাম বল");
  await h.tap(O, "সংরক্ষণ করুন", 4000);
  await expectText(O, /নার্সারি · বাংলা/, "wording fix saved (back on the list)");
  await h.tap(O, inCard(BAN, "প্রশ্নপত্র"), 4000);
  const v = await O.getByText("সপ্তাহের ৭ দিনের নাম বল", { exact: true }).count();
  const inputs = await O.locator("textarea, input").evaluateAll((els) => els.map((e) => e.value));
  if (!v && !inputs.includes("সপ্তাহের ৭ দিনের নাম বল")) throw new Error("the fixed wording did not stick");
  console.log("ok: fixed wording is on the paper");
  await O.context().close();
}

// ── Picture question (D-#1282): আরবি oral tomorrow, 4 sets × 10 pictures ─────────────────────
const ARB = "নার্সারি · আরবি";

async function officePictures(h) {
  const O = await L.login(h, "office@help.test");
  await L.go(h, O, null, VIVA, 5000);
  await h.tap(O, inCard(ARB, "প্রশ্নপত্র"), 5000);
  await h.shot(O, "exam-viva-picture-paper", 0, [{ re: "^১\\. " }, { text: "ছবি বাছুন" }, { text: "প্রতি ছবিতে নম্বর" }], { anchor: { re: "^প্রশ্ন ১$" } });
  await h.tap(O, "ছবি বাছুন", 4000);
  await h.shot(O, "exam-viva-picture-paper", 1, [{ text: "আরবি বই ১ (নার্সারি)" }, { text: "جَمَلٌ" }, { re: "^বাছাই শেষ \\(" }]);
  // Take the first picture out and put it back at the end, then check the count stays ১০.
  await h.tap(O, { text: "بَيْتٌ" }, 800);
  await expectText(O, /বাছাই শেষ \(৯টি\)/, "one picture taken out");
  await h.tap(O, { text: "بَيْتٌ" }, 800);
  await expectText(O, /বাছাই শেষ \(১০টি\)/, "and put back");
  await h.tap(O, { re: "^বাছাই শেষ \\(" }, 1500);
  await expectText(O, /১০টি ছবি · মোট ১০/, "the question is 10 pictures × 1 = 10");
  await h.topmost(O, { text: "+ ছবির প্রশ্ন" }, { scroll: true });
  await h.shot(O, "exam-viva-picture-paper", 2, [{ text: "+ ছবির প্রশ্ন" }, { text: "সংরক্ষণ করুন" }], { anchor: { text: "+ প্রশ্ন যোগ করুন" } });
  await h.tap(O, "সংরক্ষণ করুন", 4000);
  await expectText(O, new RegExp(ARB), "paper saved (back on the list)");
  await O.context().close();
}

async function teacherPictures(h) {
  const T = await L.login(h, "teacher@help.test");
  await L.go(h, T, null, VIVA, 5000);
  await h.tap(T, inCard(ARB, "নম্বর দিন"), 5000);
  await h.tap(T, { text: FIRST }, 3500);
  // The first picture chip (not the roll number "১" above it).
  const chip1 = { css: "xpath=//*[starts-with(normalize-space(.),'ছবি দেখে শব্দ বলা')]/following::*[normalize-space(text())='১'][1]" };
  await h.shot(T, "exam-viva-pictures", 0, [chip1, { text: "ছবি দেখান" }]);
  await h.tap(T, "ছবি দেখান", 3000);
  const right = { re: "^✓ পেরেছে \\(১\\)" };
  const wrong = { re: "^✗ পারেনি \\(০\\)" };
  await h.shot(T, "exam-viva-pictures", 1, [{ text: "১/১০" }, { text: "উত্তর দেখুন" }, right, wrong, { text: "পরের ›" }, { text: "বন্ধ করুন" }]);
  await h.tap(T, "উত্তর দেখুন", 800);
  await expectText(T, /লুকাতে আবার চাপুন/, "answer shown on tap");
  // ✓ ✓ ✗ then ✓ for the rest → 9/10; every mark moves on by itself.
  for (let i = 0; i < 10; i++) await h.tap(T, i === 2 ? wrong : right, 1200);
  await expectText(T, /১০\/১০টি ছবির নম্বর · মোট ৯/, "10 pictures marked, total 9");
  await h.tap(T, "বন্ধ করুন", 1500);
  await expectText(T, /৯\/১০/, "card shows 9/10");
  await T.context().close();
}

exports.run = async (h) => {
  if (h.PROD) throw new Error("the viva spec draws, marks and saves while it walks; run it locally (see its header)");
  await teacher(h);
  await office(h);
  await officePictures(h);
  await teacherPictures(h);
};
