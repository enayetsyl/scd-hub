/**
 * Capture spec — বেতন ও অর্থ (payroll + salary advances + finance books), guides fin-*.
 *
 * LOCAL ONLY. Run on scripts/help/fixtures/fin.ts (example school, example amounts). The
 * walk saves while it goes: it prepares and locks October 2026, tells one payment group
 * that its salary went out, gives an advance and records a few finance entries, because
 * the later screens only exist after those steps.
 *
 * Fields are boxed as a whole (label + input), marked with a data-help attribute so the
 * capture's `{ css }` target can find them; a `below` text picks the copy of a repeated
 * label that sits under a given heading (for example the second "কত দিন কাটবেন").
 */
const PASSWORD = "Help@123";

/**
 * Mark an element for a picture and return its css target.
 *   text   exact text of the element (a field's label, a chip, a heading)
 *   field  true: mark the label's parent (label + input/select together)
 *   below  only a copy that comes after this exact text in the page
 *   last   prefer the last match
 */
let seq = 0;
async function mark(page, text, { field = false, below = null, last = false, re = false } = {}) {
  const key = `h${++seq}`;
  const ok = await page.evaluate(
    ({ text, field, below, last, key, re }) => {
      const leaf = (el) => {
        const own = (el.innerText || "").trim();
        return re ? new RegExp(text).test(own) && ![...el.children].some((c) => new RegExp(text).test((c.innerText || "").trim())) : own === text && ![...el.children].some((c) => (c.innerText || "").trim() === text);
      };
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        for (let p = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
        }
        return true;
      };
      const onTop = (el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
      };
      const all = [...document.querySelectorAll("div, span, input, textarea")].filter((e) => leaf(e) && visible(e));
      let anchor = null;
      if (below) {
        const as = [...document.querySelectorAll("div, span")].filter((e) => {
          const own = (e.innerText || "").trim();
          return own === below && ![...e.children].some((c) => (c.innerText || "").trim() === below) && visible(e) && onTop(e);
        });
        anchor = as[0] ?? null;
        if (!anchor) return `anchor not found: ${below}`;
      }
      let list = anchor ? all.filter((e) => anchor.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) : all;
      if (last) list = list.reverse();
      const el = list.find(onTop);
      if (!el) return `not found: ${text}`;
      (field ? el.parentElement : el).setAttribute("data-help", key);
      return "ok";
    },
    { text, field, below, last, key, re },
  );
  if (ok !== "ok") {
    const seen = (await page.locator("body").innerText()).slice(0, 900).split("\n").join(" | ");
    throw new Error(`mark: ${ok}\n  page text: ${seen}`);
  }
  return { css: `[data-help="${key}"]` };
}
const field = (page, label, opts = {}) => mark(page, label, { ...opts, field: true });

async function fill(page, label, value, opts = {}) {
  const t = await field(page, label, opts);
  await page.locator(`${t.css} input, ${t.css} textarea`).first().fill(value);
  await page.waitForTimeout(400);
  return t;
}

/** A Select: open it, then tap the option (the last on-top copy of its text). */
async function pick(h, page, label, option, opts = {}) {
  const t = await field(page, label, opts);
  const box = await page.locator(t.css).boundingBox();
  // The trigger sits under the label, inside the same wrapper.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 18);
  await page.waitForTimeout(700);
  const o = await mark(page, option, { below: label === opts.below ? null : null, last: true });
  await page.locator(o.css).click();
  await page.waitForTimeout(900);
  return t;
}

/** The hidden <input type=date> of a DateField. */
async function setDate(page, label, value, opts = {}) {
  const t = await field(page, label, opts);
  await page.locator(`${t.css} input[type=date]`).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(600);
  return t;
}

async function back(h, page) {
  await (await h.topmost(page, { css: '[aria-label="Go back"]' }, { scroll: false })).click();
  await page.waitForTimeout(2000);
}

async function tapCss(page, t, wait = 2000) {
  await page.locator(t.css).click();
  await page.waitForTimeout(wait);
}

/** Drawer → an item. The drawer keeps a stack where it was, so callers start from a fresh load. */
async function drawer(h, page, item) {
  await h.openMenu(page);
  await h.tap(page, item, 2500);
}

async function fresh(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
}


exports.helpers = { mark, field, fill, pick, setDate, back, tapCss, drawer, fresh, PASSWORD };

exports.run = async (h) => {
  if (h.PROD) throw new Error("the fin spec saves while it walks; run it locally (see its header)");

  // ── Office: pay, prepare October ─────────────────────────────────────────
  const O = (await h.login("office@help.test", PASSWORD)).page;
  await drawer(h, O, "কর্মী");
  for (const g of ["fin-staff-pay-set", "fin-payroll-prepare"]) await h.shot(O, g, 0, [{ text: "☰" }, { text: "বেতন" }]);
  await h.tap(O, "বেতন", 2500);
  await h.shot(O, "fin-staff-pay-set", 1, [{ text: "কর্মীর বেতন" }]);
  for (const g of ["fin-payroll-prepare", "fin-payroll-leave-charge", "fin-payroll-lateness-charge", "fin-payroll-adjustment"]) {
    await h.shot(O, g, g === "fin-payroll-prepare" ? 1 : 0, [{ text: "নতুন রান প্রস্তুত করুন" }]);
  }
  await h.shot(O, "fin-advance-view", 0, [{ text: "অগ্রিম / ঋণ" }]);

  await h.tap(O, "কর্মীর বেতন", 2500);
  {
    const who = await pick(h, O, "কর্মী", "উদাহরণ শ্রেণি শিক্ষক");
    const sal = await fill(O, "মাসিক বেতন", "25000");
    const how = await pick(h, O, "পেমেন্ট পদ্ধতি", "ব্যাংক");
    await h.shot(O, "fin-staff-pay-set", 2, [who, sal, how, { text: "বরাদ্দ সংরক্ষণ" }]);
  }
  await back(h, O);

  await h.tap(O, "নতুন রান প্রস্তুত করুন", 2500);
  {
    const month = await fill(O, "মাস (YYYY-MM)", "2026-10");
    const days = await fill(O, "কর্মদিবস", "27");
    await O.waitForTimeout(2500);
    await h.shot(O, "fin-payroll-prepare", 2, [month, days], { anchor: { text: "মাস (YYYY-MM)" } });
    for (const g of ["fin-payroll-leave-charge", "fin-payroll-lateness-charge"]) {
      await h.shot(O, g, 1, [await field(O, "মাস (YYYY-MM)")], { anchor: { text: "মাস (YYYY-MM)" } });
    }
  }
  // Leave over the balance: teacher2's held probation days.
  {
    const title = "ছুটির বাড়তি দিনের বেতন কর্তন";
    const yes = await mark(O, "হ্যাঁ", { below: title });
    await tapCss(O, yes, 1200);
    const days = await field(O, "কত দিন কাটবেন", { below: title });
    await h.shot(O, "fin-payroll-leave-charge", 2, [{ text: title }, yes, days], { anchor: { text: title } });
  }
  // Lateness: both people, salary.
  {
    const title = "বিলম্বের কর্তন (একজন একজন করে)";
    const yes1 = await mark(O, "হ্যাঁ", { below: "উদাহরণ শিক্ষক" });
    await tapCss(O, yes1, 1200);
    const yes2 = await mark(O, "হ্যাঁ", { below: "উদাহরণ শ্রেণি শিক্ষক" });
    await tapCss(O, yes2, 1200);
    const yes = await mark(O, "হ্যাঁ", { below: "উদাহরণ শিক্ষক" });
    const days = await field(O, "কত দিন কাটবেন", { below: title });
    const salary = await mark(O, "বেতন থেকে", { below: title });
    await h.shot(O, "fin-payroll-lateness-charge", 2, [{ text: title }, yes, days, salary], { anchor: { text: title } });
  }
  // A one-off arrears line.
  {
    const title = "এই মাসের আলাদা সমন্বয়";
    await h.shot(O, "fin-payroll-adjustment", 1, [{ text: "সমন্বয় যোগ করুন" }]);
    await h.tap(O, "সমন্বয় যোগ করুন", 1500);
    const who = await pick(h, O, "কর্মী", "উদাহরণ শ্রেণি শিক্ষক", { below: title });
    const sign = await field(O, "যোগ না কর্তন", { below: title });
    const type = await field(O, "ধরন", { below: title });
    const amount = await fill(O, "টাকার অঙ্ক", "1000", { below: title });
    const why = await fill(O, "কারণ (পে-স্লিপে ছাপা হবে)", "উদাহরণ: সেপ্টেম্বরের বর্ধিত বেতনের বকেয়া", { below: title });
    await h.shot(O, "fin-payroll-adjustment", 2, [who, sign, type, amount, why], { anchor: { text: "যোগ না কর্তন" } });
  }
  for (const g of ["fin-payroll-prepare", "fin-payroll-leave-charge", "fin-payroll-lateness-charge", "fin-payroll-adjustment"]) {
    await h.shot(O, g, 3, [{ text: "প্রস্তুত করুন", last: true }]);
  }
  await h.tap(O, { text: "প্রস্তুত করুন", last: true }, 6000);

  // The prepared run: cancel (shown, not done).
  await h.shot(O, "fin-payroll-cancel", 1, [{ text: "রান বাতিল" }]);
  await h.tap(O, "রান বাতিল", 1500);
  await h.shot(O, "fin-payroll-cancel", 2, [{ text: "রান বাতিল", last: true }]);
  await h.tap(O, { text: "বাতিল", last: true }, 1500);
  await back(h, O);
  await h.shot(O, "fin-payroll-cancel", 0, [{ text: "২০২৬-১০" }]);

  // ── Principal: approve + lock October; reopen (shown); advances ───────────
  const P = (await h.login("principal@help.test", PASSWORD)).page;
  await drawer(h, P, "কর্মী");
  await h.shot(P, "fin-payroll-approve-lock", 0, [{ text: "☰" }, { text: "বেতন" }]);
  await h.tap(P, "বেতন", 2500);
  await h.shot(P, "fin-payroll-approve-lock", 1, [{ text: "২০২৬-১০" }]);
  await h.tap(P, "২০২৬-১০", 3000);
  await h.shot(P, "fin-payroll-approve-lock", 2, [{ text: "হিসাবের রেজিস্টার (Excel)", last: true }, { text: "অনুমোদন ও লক" }]);
  await h.tap(P, "অনুমোদন ও লক", 4000);
  await h.shot(P, "fin-payroll-approve-lock", 3, [{ text: "অনুমোদিত ও লকড" }]);

  await h.shot(P, "fin-payroll-reopen", 1, [{ text: "আবার খুলুন (সংশোধনের জন্য)" }]);
  await h.tap(P, "আবার খুলুন (সংশোধনের জন্য)", 1200);
  {
    const why = await fill(P, "কেন আবার খুলছেন", "উদাহরণ: একজনের বকেয়া ভুল লেখা হয়েছিল");
    await h.shot(P, "fin-payroll-reopen", 2, [why, { text: "নিশ্চিত — আবার খুলুন" }]);
    await h.tap(P, { text: "বাতিল", below: "কেন আবার খুলছেন" }, 1200);
  }
  await back(h, P);
  await h.shot(P, "fin-payroll-reopen", 0, [{ text: "২০২৬-১০" }]);

  for (const g of ["fin-advance-issue", "fin-advance-settle"]) await h.shot(P, g, 0, [{ text: "অগ্রিম / ঋণ" }]);
  await h.tap(P, "অগ্রিম / ঋণ", 2500);
  {
    const who = await pick(h, P, "কর্মী", "উদাহরণ শ্রেণি শিক্ষক");
    await P.waitForTimeout(1500);
    await h.shot(P, "fin-advance-issue", 1, [who]);
    const amount = await fill(P, "মূল পরিমাণ", "5000");
    const date = await setDate(P, "ইস্যু তারিখ", "2026-11-05");
    const mode = await pick(h, P, "আদায় পদ্ধতি", "কিস্তি");
    const inst = await fill(P, "কিস্তির পরিমাণ", "1000");
    await h.shot(P, "fin-advance-issue", 2, [amount, date, mode, inst, { text: "অগ্রিম ইস্যু করুন", last: true }], {
      anchor: { text: "মূল পরিমাণ" },
    });
    await h.tap(P, { text: "অগ্রিম ইস্যু করুন", last: true }, 3000);
  }
  {
    const who = await pick(h, P, "কর্মী", "উদাহরণ ইংরেজি শিক্ষক");
    await P.waitForTimeout(2000);
    await h.shot(P, "fin-advance-settle", 1, [who, { text: "নিষ্পত্তি" }, { text: "মওকুফ" }], { anchor: { text: "কর্মী" } });
  }
  await P.context().close();

  // ── Office again: advances, payslips, files, salary sent ──────────────────
  await fresh(O);
  await drawer(h, O, "কর্মী");
  await h.tap(O, "বেতন", 2500);
  await h.tap(O, "অগ্রিম / ঋণ", 2500);
  {
    const who = await pick(h, O, "কর্মী", "উদাহরণ ইংরেজি শিক্ষক");
    await O.waitForTimeout(2000);
    await h.shot(O, "fin-advance-view", 1, [who, { text: "বাকি" }], { anchor: { text: "কর্মী" } });
  }
  await back(h, O);

  await h.shot(O, "fin-payroll-payslips", 0, [{ text: "২০২৬-১০" }]);
  await h.tap(O, "২০২৬-১০", 3500);
  {
    const name = await mark(O, "উদাহরণ ইংরেজি শিক্ষক", { below: "পে-স্লিপ" });
    const gross = await mark(O, "মোট বেতন", { below: "উদাহরণ ইংরেজি শিক্ষক" });
    const cut = await mark(O, "কর্তন", { below: "উদাহরণ ইংরেজি শিক্ষক" });
    const net = await mark(O, "নিট বেতন", { below: "উদাহরণ ইংরেজি শিক্ষক" });
    await h.shot(O, "fin-payroll-payslips", 1, [name, gross, cut, net], { anchor: { text: "উদাহরণ ইংরেজি শিক্ষক" } });
  }
  await back(h, O);

  for (const g of ["fin-payroll-register", "fin-payroll-salary-sheet", "fin-payroll-advice", "fin-payroll-salary-sent"]) {
    await h.shot(O, g, 0, [{ text: "২০২৬-০৯" }]);
  }
  await h.tap(O, "২০২৬-০৯", 3500);
  await h.shot(O, "fin-payroll-register", 1, [{ text: "হিসাবের রেজিস্টার (Excel)", last: true }]);
  await h.shot(O, "fin-payroll-salary-sheet", 1, [{ text: "বেতন শিট (PDF)", last: true }]);
  {
    const title = "বেতন দেওয়া হয়েছে — কর্মীদের জানান";
    const both = await mark(O, "দুটোই", { below: title });
    const tell = await mark(O, "এই দলকে জানান", { below: title });
    await h.shot(O, "fin-payroll-salary-sent", 1, [{ text: title }, both, tell], { anchor: { text: title } });
    await tapCss(O, tell, 1500);
    await h.shot(O, "fin-payroll-salary-sent", 2, [{ text: "জানান", last: true }]);
    await h.tap(O, { text: "জানান", last: true }, 4000);
    const lastSent = await mark(O, "^শেষ জানানো হয়েছে", { re: true });
    await h.shot(O, "fin-payroll-salary-sent", 3, [lastSent], { anchor: { text: title } });
  }
  await h.shot(O, "fin-payroll-advice", 1, [{ text: "পেমেন্ট এক্সপোর্ট" }]);
  await h.tap(O, "পেমেন্ট এক্সপোর্ট", 4000);
  {
    const total = await mark(O, "মোট");
    await h.shot(O, "fin-payroll-advice", 2, [total, { text: "ব্যাংকের চিঠি ও শিট (PDF)" }, { text: "CSV ফাইল ডাউনলোড" }]);
    const why = await mark(O, "রাউটিং", { re: true });
    await h.shot(O, "fin-payroll-advice", 3, [why]);
  }
  await O.context().close();

  // ── Teacher: own payslips ────────────────────────────────────────────────
  const T = (await h.login("teacher@help.test", PASSWORD)).page;
  await drawer(h, T, "কর্মী");
  await h.shot(T, "fin-my-payslips", 0, [{ text: "☰" }, { text: "আমার রেকর্ড" }]);
  await h.tap(T, "আমার রেকর্ড", 4000);
  {
    const head = "আমার পে-স্লিপ";
    // The newest locked month comes first (myPayslips sorts by month, newest first).
    const month = await mark(T, "^20[0-9][0-9]-[0-9][0-9]$", { below: head, re: true });
    const gross = await mark(T, "মোট বেতন", { below: head });
    await h.shot(T, "fin-my-payslips", 1, [{ text: head }, month, gross], { anchor: { text: head } });
  }
  await T.context().close();
};
