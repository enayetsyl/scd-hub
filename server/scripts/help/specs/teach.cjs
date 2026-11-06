/**
 * Capture spec — the `teach` area: homework, weekly assignment, gift, attendance, work
 * board, daily tracker, vocabulary test, Saturday revision (prd-help-centre §7).
 *
 * LOCAL ONLY. It saves while it walks (declares, confirms, takes submission, checks…),
 * because each screen only exists after the step before it. Run it on the teach fixture,
 * with the clock moved to Thursday 2026-11-05 10:30 (see fixtures/teach.ts):
 *
 *   $env:HELP_NOW='2026-11-05T10:30:00+06:00'
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/teach-clock.cjs'   # fixture + server
 *   node scripts/help/capture.cjs --spec teach --base http://localhost:8311  # (no NODE_OPTIONS)
 *
 * TEACH_PART=hw,as,… runs only some parts (each part expects the parts before it to have
 * run on the same database). Logins come from scripts/help/fixture.ts (password Help@123).
 */
const PASSWORD = "Help@123";
const NOW = new Date(process.env.HELP_NOW || "2026-11-05T10:30:00+06:00");
const PARTS = (process.env.TEACH_PART || "").split(",").filter(Boolean);
const want = (p) => PARTS.length === 0 || PARTS.includes(p);

/** The assignment sheet the fixture stored (a local run has no Google Drive). */
const SHEET = { fileId: "6a0000000000000000000a01", originalName: "গণিত অ্যাসাইনমেন্ট শিট.pdf", mime: "application/pdf" };

/** Sign in, then move the page's clock to NOW (homework only exists on school days). */
async function loginAt(h, user) {
  const s = await h.login(user, PASSWORD);
  await s.context.clock.install({ time: NOW });
  // Uploads go to Google Drive on a real server; locally, hand back the stored example sheet.
  await s.context.route("**/files/assignment", (route) =>
    route.request().method() === "POST" ? route.fulfill({ json: SHEET }) : route.continue(),
  );
  await s.page.reload({ waitUntil: "load" });
  await s.page.waitForTimeout(6000);
  return s.page;
}

const onTop = (h, page, target) => h.topmost(page, target, { scroll: false }).then(() => true, () => false);

/** Open ☰ and make `item` visible (expanding `group` if it is closed). */
async function openMenuAt(h, page, group, item) {
  await waitFor(h, page, { text: "☰" }, 30000);
  await h.openMenu(page);
  await waitFor(h, page, { text: group || item, minY: 60 }, 15000);
  if (group && !(await onTop(h, page, { text: item, minY: 60 }))) await h.tap(page, { text: group, minY: 60 }, 1200);
}

/** A "open the page" row: ☰ → group → item (or just item for a top-level entry). */
async function menuRow(h, page, guide, row, group, item) {
  await openMenuAt(h, page, group, item);
  const targets = group ? [{ text: group, minY: 60 }, { text: item, minY: 60 }] : [{ text: item, minY: 60 }];
  await h.shot(page, guide, row, targets, group ? { anchor: { text: group, minY: 60 } } : {});
  await h.tap(page, { text: item, minY: 60 }, 3500);
}

/** Navigate by the menu without a picture. */
async function go(h, page, group, item) {
  await openMenuAt(h, page, group, item);
  await h.tap(page, { text: item, minY: 60 }, 3500);
}

const below = (label, el = "input") => ({ css: `${el}:below(:text-is("${label}"))` });

// ── Homework ─────────────────────────────────────────────────────────────────
async function homework(h) {
  const T = await loginAt(h, "teacher@help.test");

  // Declare today's গণিত (and, without pictures, বাংলা).
  await h.shot(T, "teach-hw-declare", 0, [{ text: "বাড়ির কাজ ঘোষণা", minY: 120 }]);
  await h.tap(T, { text: "বাড়ির কাজ ঘোষণা", minY: 120 }, 3500);
  await h.tap(T, { text: "গণিত", minY: 120 }, 2000);
  await h.shot(T, "teach-hw-declare", 1, [{ text: "গণিত", minY: 120 }, { text: "গুণ", minY: 120 }]);
  await h.tap(T, { text: "গুণ", minY: 120 }, 1200);
  await (await h.topmost(T, below("প্রশ্ন সংখ্যা"), { scroll: true })).fill("8");
  await (await h.topmost(T, below("বাড়ির কাজের সংক্ষিপ্ত বিবরণ", "textarea"), { scroll: true })).fill("অনুশীলনী ৫.৩ — ১ থেকে ৮ নম্বর প্রশ্ন");
  await T.locator("body").click({ position: { x: 5, y: 400 } });
  await h.shot(T, "teach-hw-declare", 2, [below("প্রশ্ন সংখ্যা"), below("বাড়ির কাজের সংক্ষিপ্ত বিবরণ", "textarea")], {
    anchor: { text: "প্রশ্ন সংখ্যা" },
  });
  await h.shot(T, "teach-hw-declare", 3, [{ text: "ঘোষণা করুন", minY: 120 }]);
  await h.tap(T, { text: "ঘোষণা করুন", minY: 120 }, 3500);
  await dump(T, "after declare");

  // বাংলা for the same day on the same form, no pictures (the day then holds two subjects).
  await h.tap(T, { text: "বাংলা", minY: 120 }, 2000);
  await h.tap(T, { text: "ছড়া ও কবিতা", minY: 120 }, 1200);
  await (await h.topmost(T, below("প্রশ্ন সংখ্যা"), { scroll: true })).fill("4");
  await (await h.topmost(T, below("বাড়ির কাজের সংক্ষিপ্ত বিবরণ", "textarea"), { scroll: true })).fill("“ঘাসফুল” কবিতাটি মুখস্থ করা");
  await h.tap(T, { text: "ঘোষণা করুন", minY: 120 }, 3500);
  await dump(T, "after BAN");

  // teacher2: no ইংরেজি homework today for ৩য় বালক.
  const T2 = await loginAt(h, "teacher2@help.test");
  await menuRow(h, T2, "teach-hw-no-homework", 0, "ট্র্যাকার", "বাড়ির কাজ");
  await h.tap(T2, { text: "৩", minY: 120 }, 2500);
  await h.shot(T2, "teach-hw-no-homework", 1, [{ text: "৩", minY: 120 }, { re: "^বালক", minY: 120 }]);
  await h.tap(T2, { re: "^বালক", minY: 120 }, 2500);
  await h.shot(T2, "teach-hw-no-homework", 2, [{ text: "ঘোষণা করুন", minY: 120 }]);
  await h.tap(T2, { text: "ঘোষণা করুন", minY: 120 }, 3500);
  await h.tap(T2, { text: "ইংরেজি", minY: 120 }, 2000);
  await h.tap(T2, { text: "পরীক্ষা", minY: 120 }, 1000);
  await h.shot(T2, "teach-hw-no-homework", 3, [
    { text: "ইংরেজি", minY: 120 },
    { text: "পরীক্ষা", minY: 120 },
    { text: "বাড়ির কাজ নেই — ঘোষণা করুন", minY: 120 },
  ]);
  await h.tap(T2, { text: "বাড়ির কাজ নেই — ঘোষণা করুন", minY: 120 }, 3000);
  await T2.context().close();

  // Class teacher: confirm the day, সাকিব absent.
  await fresh(T);
  await menuRow(h, T, "teach-hw-confirm-day", 0, "ট্র্যাকার", "বাড়ির কাজ");
  await h.shot(T, "teach-hw-confirm-day", 1, [{ text: "সমন্বয় ও ইস্যু", minY: 120 }]);
  await h.tap(T, { text: "সমন্বয় ও ইস্যু", minY: 120 }, 3500);
  await h.shot(T, "teach-hw-confirm-day", 2, [{ text: "দিনের মোট সময়", minY: 120 }]);
  await h.tap(T, { text: "সাকিব হাসান", minY: 120 }, 1200);
  await pinnedShot(h, T, "teach-hw-confirm-day", 3, [{ re: "^সাকিব হাসান", minY: 120 }, { text: "নিশ্চিত করে ইস্যু করুন", minY: 120 }], {
    text: "নিশ্চিত করে ইস্যু করুন",
    minY: 120,
  });
  await h.tap(T, { text: "নিশ্চিত করে ইস্যু করুন", minY: 120 }, 4000);
  await dump(T, "after confirm");

  // Workspace: take submission for Wednesday's গণিত (সাকিব did not bring it).
  const WED_MATH = { re: "বুধবার · .* · গণিত$", minY: 120 };
  const openWorkspace = async (guide) => {
    await fresh(T);
    if (guide) await menuRow(h, T, guide, 0, "ট্র্যাকার", "বাড়ির কাজ");
    else await go(h, T, "ট্র্যাকার", "বাড়ির কাজ");
    if (guide) await h.shot(T, guide, 1, [{ text: "বাড়ির কাজ", minY: 120 }]);
    await h.tap(T, { text: "বাড়ির কাজ", minY: 120 }, 3500);
  };
  await openWorkspace("teach-hw-take-submission");
  await h.tap(T, WED_MATH, 2000);
  for (const n of ["আরিফ হোসেন", "তানভীর আহমেদ", "নাঈম উদ্দিন", "ফাহিম রহমান", "রাফি ইসলাম"]) await h.tap(T, { text: n, minY: 120 }, 700);
  await pinnedShot(h, T, "teach-hw-take-submission", 2, [WED_MATH, { text: "আরিফ হোসেন ✓", minY: 120 }, { text: "জমা নিশ্চিত করুন", minY: 120 }], {
    text: "জমা নিশ্চিত করুন",
    minY: 120,
  }, "center");
  await h.tap(T, { text: "জমা নিশ্চিত করুন", minY: 120 }, 2000);
  await h.shot(T, "teach-hw-take-submission", 3, [{ text: "জমা দিন", minY: 120 }]);
  await h.tap(T, { text: "জমা দিন", minY: 120 }, 3500);
  await dump(T, "after submit");

  // Undo: আরিফ's submission was a mistake.
  await openWorkspace("teach-hw-undo");
  await h.tap(T, WED_MATH, 2000);
  const arifUndo = { css: `:text-is("⤺ আনডু"):below(:text-is("আরিফ হোসেন"))` };
  await pinnedShot(h, T, "teach-hw-undo", 2, [WED_MATH, arifUndo], WED_MATH, "start");
  await h.tap(T, arifUndo, 1500);
  await h.shot(T, "teach-hw-undo", 3, [{ text: "⤺ আনডু", last: true, minY: 120 }]);
  await h.tap(T, { text: "⤺ আনডু", last: true, minY: 120 }, 3000);
  await dump(T, "after undo");

  // Check: ঠিক / আংশিক / ভুল.
  await openWorkspace("teach-hw-check");
  await h.tap(T, WED_MATH, 2000);
  const outcome = (name, label) => ({ css: `:text-is("${label}"):below(:text-is("${name}"))` });
  await pinnedShot(
    h,
    T,
    "teach-hw-check",
    2,
    [WED_MATH, outcome("তানভীর আহমেদ", "ঠিক"), outcome("তানভীর আহমেদ", "আংশিক"), outcome("তানভীর আহমেদ", "ভুল")],
    WED_MATH,
    "start",
  );
  await h.tap(T, outcome("তানভীর আহমেদ", "ঠিক"), 2500);
  await h.tap(T, outcome("নাঈম উদ্দিন", "আংশিক"), 1500);
  await h.shot(T, "teach-hw-check", 3, [{ text: "নিশ্চিত", minY: 120 }]);
  await h.tap(T, { text: "নিশ্চিত", minY: 120 }, 2500);
  await h.tap(T, outcome("ফাহিম রহমান", "ঠিক"), 2500);
  await h.tap(T, outcome("রাফি ইসলাম", "ভুল"), 1500);
  await h.tap(T, { text: "নিশ্চিত", minY: 120 }, 2500);
  await dump(T, "after check");

  // Return: three copies go back today, রাফি's is kept.
  await openWorkspace("teach-hw-return");
  await h.tap(T, WED_MATH, 2000);
  for (const n of ["তানভীর আহমেদ", "নাঈম উদ্দিন", "ফাহিম রহমান"]) await h.tap(T, { text: n, minY: 120, last: true }, 700);
  await pinnedShot(h, T, "teach-hw-return", 2, [WED_MATH, { text: "তানভীর আহমেদ ✓", minY: 120 }, { text: "ফেরত নিশ্চিত করুন", minY: 120 }], WED_MATH, "start");
  await h.tap(T, { text: "ফেরত নিশ্চিত করুন", minY: 120 }, 3000);
  await dump(T, "after return");

  // Give today's homework to সাকিব, who was absent when it was issued.
  const THU_MATH = { re: "বৃহস্পতিবার · .* · গণিত$", minY: 120 };
  await openWorkspace("teach-hw-give-absent");
  await h.tap(T, THU_MATH, 2000);
  await h.tap(T, { re: "^অনুপস্থিত ছিল", minY: 120 }, 1500);
  await pinnedShot(h, T, "teach-hw-give-absent", 2, [THU_MATH, { re: "^অনুপস্থিত ছিল", minY: 120 }, { text: "পুনরায় দিন", minY: 120 }], THU_MATH, "start");
  await h.tap(T, { text: "পুনরায় দিন", minY: 120 }, 2500);
  await dump(T, "after redeliver");
  await T.context().close();
}

/**
 * A picture whose targets sit near the bottom of a page. capture.cjs's `anchor` pulls the
 * anchor 70px down after scrolling, which pushes a bottom button off a fully-scrolled page.
 * So scroll `scrollTo` into view here and anchor on the header's ☰ (outside every scroll
 * view, so the anchor step moves nothing).
 */
async function pinnedShot(h, page, guide, row, targets, scrollTo, block = "end") {
  const el = await h.topmost(page, scrollTo, { scroll: true });
  await el.evaluate((e, b) => e.scrollIntoView({ block: b }), block);
  await page.waitForTimeout(400);
  await h.shot(page, guide, row, targets, { anchor: { text: "☰" } });
}

/** Wait until `target` is on screen (slow lists), up to `ms`. */
async function waitFor(h, page, target, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await h.topmost(page, target, { scroll: true }).then(() => true, () => false)) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`timed out waiting for ${JSON.stringify(target)}`);
}

/** Start again from the Today screen (a reload drops the saved navigation state). */
async function fresh(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
}

/** The header's ← (back) arrow. */
async function back(h, page) {
  await h.tap(page, { text: "←" }, 2500);
}

async function dump(page, label) {
  if (!process.env.TEACH_DEBUG) return;
  const text = (await page.locator("body").innerText()).split("\n").filter(Boolean).join(" | ").slice(0, 1500);
  console.log(`DUMP ${label}: ${text}`);
}

// ── Weekly assignment ────────────────────────────────────────────────────────
async function assignment(h) {
  const T = await loginAt(h, "teacher@help.test");
  const MATH_CARD = { text: "শ্রেণি ৩ বালক — গণিত", minY: 120 };

  // Deliver this week's গণিত.
  await menuRow(h, T, "teach-as-deliver", 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
  const deliverMath = { css: `:text-is("বিতরণ করুন"):below(:text-is("শ্রেণি ৩ বালক — গণিত"))` };
  await h.shot(T, "teach-as-deliver", 1, [deliverMath]);
  await h.tap(T, deliverMath, 3500);
  await (await h.topmost(T, below("অ্যাসাইনমেন্টে কী করতে হবে", "textarea"), { scroll: true })).fill(
    "শিটের ১০টি গুণের অঙ্ক খাতায় করে আনা",
  );
  await (await h.topmost(T, below("পূর্ণমান (ঐচ্ছিক)"), { scroll: true })).fill("10");
  await T.locator("body").click({ position: { x: 5, y: 300 } });
  await pinnedShot(
    h,
    T,
    "teach-as-deliver",
    2,
    [below("অ্যাসাইনমেন্টে কী করতে হবে", "textarea"), below("পূর্ণমান (ঐচ্ছিক)"), { text: "ফাইল যুক্ত করুন", minY: 120 }],
    { text: "অ্যাসাইনমেন্টে কী করতে হবে", minY: 60 },
    "start",
  );
  const [chooser] = await Promise.all([
    T.waitForEvent("filechooser", { timeout: 15000 }),
    h.tap(T, { text: "ফাইল যুক্ত করুন", minY: 120 }, 300),
  ]);
  await chooser.setFiles({ name: "গণিত অ্যাসাইনমেন্ট শিট.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% example\n") });
  await T.waitForTimeout(2500);
  const sakibPresent = { css: `:text-is("উপস্থিত"):right-of(:text("সাকিব হাসান"))` };
  await pinnedShot(h, T, "teach-as-deliver", 3, [sakibPresent, { text: "বিতরণ করুন", minY: 120 }], { text: "বিতরণ করুন", minY: 120 });
  await h.tap(T, sakibPresent, 1000);
  await h.tap(T, { text: "বিতরণ করুন", minY: 120 }, 4000);
  await dump(T, "after deliver");

  // No বাংলা assignment this week (revision).
  await fresh(T);
  await menuRow(h, T, "teach-as-no-assignment", 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
  const banNil = (label) => ({ css: `:text-is("${label}"):below(:text-is("শ্রেণি ৩ বালক — বাংলা"))` });
  await h.tap(T, banNil("রিভিশন"), 1000);
  await pinnedShot(
    h,
    T,
    "teach-as-no-assignment",
    1,
    [banNil("এই সপ্তাহে অ্যাসাইনমেন্ট নেই?"), banNil("রিভিশন"), banNil("অ্যাসাইনমেন্ট নেই — ঘোষণা করুন")],
    banNil("এই সপ্তাহে অ্যাসাইনমেন্ট নেই?"),
    "center",
  );
  await h.tap(T, banNil("অ্যাসাইনমেন্ট নেই — ঘোষণা করুন"), 3000);
  await dump(T, "after nil");

  // Class teacher: confirm the week.
  await fresh(T);
  await menuRow(h, T, "teach-as-confirm-week", 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
  await h.shot(T, "teach-as-confirm-week", 1, [{ text: "⚖️ সাপ্তাহিক লোড", minY: 120 }]);
  await h.tap(T, { text: "⚖️ সাপ্তাহিক লোড", minY: 120 }, 3500);
  await dump(T, "reconcile");
  await pinnedShot(
    h,
    T,
    "teach-as-confirm-week",
    2,
    [{ re: "সাপ্তাহিক মোট$", minY: 60 }, { text: "সপ্তাহ নিশ্চিত ও ইস্যু করুন", minY: 120 }],
    { text: "সপ্তাহ নিশ্চিত ও ইস্যু করুন", minY: 120 },
  );
  await h.tap(T, { text: "সপ্তাহ নিশ্চিত ও ইস্যু করুন", minY: 120 }, 4000);
  await dump(T, "after confirm week");

  // Last week's গণিত: take submission (রাফি brought it, সাকিব did not), check, redo, return.
  const WK44 = { re: "^▾ শ্রেণি ৩ · গণিত$", minY: 120 };
  const LAST = { re: "শ্রেণি ৩ · গণিত$", minY: 120 };
  const openAsWorkspace = async (guide) => {
    await fresh(T);
    if (guide) await menuRow(h, T, guide, 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
    else await go(h, T, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
    if (guide) await h.shot(T, guide, 1, [{ text: "📋 অ্যাসাইনমেন্ট কাজ", minY: 120 }]);
    await h.tap(T, { text: "📋 অ্যাসাইনমেন্ট কাজ", minY: 120 }, 3500);
    await dump(T, "as workspace");
    await h.tap(T, { ...LAST, last: true }, 2500);
  };
  await openAsWorkspace("teach-as-take-submission");
  await h.tap(T, { text: "রাফি ইসলাম", minY: 120 }, 800);
  await pinnedShot(h, T, "teach-as-take-submission", 2, [WK44, { text: "রাফি ইসলাম ✓", minY: 120 }, { text: "জমা নিশ্চিত করুন", minY: 120 }], WK44, "start");
  await h.tap(T, { text: "জমা নিশ্চিত করুন", minY: 120 }, 2000);
  await h.shot(T, "teach-as-take-submission", 3, [{ text: "জমা দিন", minY: 120 }]);
  await h.tap(T, { text: "জমা দিন", minY: 120 }, 3500);
  await dump(T, "after as submit");

  // Check আরিফ with marks and a comment; the others quickly.
  await openAsWorkspace("teach-as-check");
  const asOut = (name, label) => ({ css: `:text-is("${label}"):below(:text-is("${name}"))` });
  const asField = (name, label, el = "input") => ({ css: `${el}:below(:text-is("${label}")):below(:text-is("${name}"))` });
  await h.tap(T, asOut("আরিফ হোসেন", "সঠিক"), 800);
  await (await h.topmost(T, asField("আরিফ হোসেন", "প্রাপ্ত নম্বর"), { scroll: true })).fill("9");
  await (await h.topmost(T, asField("আরিফ হোসেন", "মন্তব্য"), { scroll: true })).fill("খুব সুন্দর হাতের লেখা");
  await pinnedShot(
    h,
    T,
    "teach-as-check",
    2,
    [asOut("আরিফ হোসেন", "সঠিক"), asField("আরিফ হোসেন", "প্রাপ্ত নম্বর"), asField("আরিফ হোসেন", "মন্তব্য"), asOut("আরিফ হোসেন", "যাচাই করুন")],
    { text: "আরিফ হোসেন", minY: 120 },
    "start",
  );
  await h.tap(T, asOut("আরিফ হোসেন", "যাচাই করুন"), 2500);
  for (const [n, o, m] of [["তানভীর আহমেদ", "সঠিক", "8"], ["নাঈম উদ্দিন", "আংশিক", "6"], ["ফাহিম রহমান", "সঠিক", "10"], ["রাফি ইসলাম", "ভুল", "3"]]) {
    await h.tap(T, asOut(n, o), 800);
    await (await h.topmost(T, asField(n, "প্রাপ্ত নম্বর"), { scroll: true })).fill(m);
    await h.tap(T, asOut(n, "যাচাই করুন"), 2500);
  }
  await dump(T, "after as check");

  // Ask রাফি to redo it.
  await openAsWorkspace("teach-as-redo");
  await h.tap(T, { re: "^পুনঃজমা দিন \\(", minY: 120 }, 1500);
  const rafiRedo = { css: `:text-is("পুনঃজমা দিন"):right-of(:text("রাফি ইসলাম"))` };
  await pinnedShot(h, T, "teach-as-redo", 2, [{ re: "^পুনঃজমা দিন \\(", minY: 120 }, rafiRedo], { re: "^পুনঃজমা দিন \\(", minY: 120 }, "center");
  await h.tap(T, rafiRedo, 2500);
  await dump(T, "after redo");

  // Return the other four.
  await openAsWorkspace("teach-as-return");
  for (const n of ["আরিফ হোসেন", "তানভীর আহমেদ", "নাঈম উদ্দিন", "ফাহিম রহমান"]) await h.tap(T, { text: n, minY: 120, last: true }, 700);
  await pinnedShot(h, T, "teach-as-return", 2, [{ text: "আরিফ হোসেন ✓", minY: 120 }, { text: "ফেরত নিশ্চিত করুন", minY: 120 }], {
    text: "ফেরত নিশ্চিত করুন",
    minY: 120,
  }, "center");
  await h.tap(T, { text: "ফেরত নিশ্চিত করুন", minY: 120 }, 3000);
  await dump(T, "after as return");
  await T.context().close();
}

// ── Student attendance ───────────────────────────────────────────────────────
async function attendance(h) {
  // Class teacher (the ৩য় বালক unit has no Quran group here, so the class teacher marks).
  const T = await loginAt(h, "teacher@help.test");
  await menuRow(h, T, "teach-att-mark", 0, null, "উপস্থিতি");
  await h.shot(T, "teach-att-mark", 1, [{ text: "৩য় শ্রেণি · বালক", minY: 120 }]);
  await h.tap(T, { text: "৩য় শ্রেণি · বালক", minY: 120 }, 3500);
  await h.tap(T, { text: "সাকিব হাসান", minY: 120 }, 1000);
  await pinnedShot(h, T, "teach-att-mark", 2, [{ re: "^সাকিব হাসান", minY: 120 }, { text: "উপস্থিতি জমা দিন", minY: 120 }], {
    text: "উপস্থিতি জমা দিন",
    minY: 120,
  });
  await h.tap(T, { text: "উপস্থিতি জমা দিন", minY: 120 }, 3500);
  await dump(T, "after attendance");

  // The class teacher's own section today.
  await fresh(T);
  await h.tap(T, { text: "আমার শাখার উপস্থিতি", minY: 120 }, 1500);
  await h.shot(T, "teach-att-view", 0, [{ text: "আমার শাখার উপস্থিতি", minY: 120 }, { text: "সব দেখুন →", minY: 120 }]);
  await h.tap(T, { text: "সব দেখুন →", minY: 120 }, 3500);
  await dump(T, "section attendance");
  await h.shot(T, "teach-att-view", 1, [{ re: "^সাকিব হাসান", minY: 120 }]);
  await T.context().close();

  // Office: the absentee report (remind first — recording the leave takes সাকিব off it).
  const O = await loginAt(h, "office@help.test");
  for (const guide of ["teach-att-remind", "teach-att-record-leave"]) {
    await fresh(O);
    await menuRow(h, O, guide, 0, null, "উপস্থিতি");
    await h.shot(O, guide, 1, [{ text: "📋 অনুপস্থিতির প্রতিবেদন", minY: 120 }]);
    await h.tap(O, { text: "📋 অনুপস্থিতির প্রতিবেদন", minY: 120 }, 4000);
    await dump(O, "absentee report");
    const act = guide === "teach-att-remind" ? "হোয়াটসঅ্যাপে জানান" : "ছুটির আবেদন লিখুন";
    await pinnedShot(h, O, guide, 2, [{ text: act, minY: 120 }], { text: act, minY: 120 }, "center");
  }
  await h.tap(O, { text: "ছুটির আবেদন লিখুন", minY: 120 }, 1500);
  await (await h.topmost(O, below("কারণ", "textarea"), { scroll: true })).fill("জ্বর — বাবা ফোনে জানিয়েছেন");
  await O.locator("body").click({ position: { x: 5, y: 300 } });
  await pinnedShot(
    h,
    O,
    "teach-att-record-leave",
    3,
    [{ text: "শুরুর তারিখ", minY: 120 }, { text: "শেষ তারিখ", minY: 120 }, below("কারণ", "textarea"), { text: "ছুটির আবেদন লিখুন", minY: 120 }],
    { text: "শুরুর তারিখ", minY: 120 },
    "center",
  );
  await h.tap(O, { text: "ছুটির আবেদন লিখুন", minY: 120 }, 3000);
  await dump(O, "after leave");

  // Office: hand ৩য় বালক's attendance to teacher2 for a few days.
  await fresh(O);
  await menuRow(h, O, "teach-att-assign-marker", 0, null, "উপস্থিতি");
  await h.shot(O, "teach-att-assign-marker", 1, [{ text: "👤 উপস্থিতির দায়িত্ব", minY: 120 }]);
  await h.tap(O, { text: "👤 উপস্থিতির দায়িত্ব", minY: 120 }, 4000);
  // The class list sometimes comes up empty on the first visit; a reload brings it.
  try {
    await waitFor(h, O, { text: "৩", minY: 60 }, 15000);
  } catch {
    await dump(O, "assign marker empty");
    await fresh(O);
    await go(h, O, null, "উপস্থিতি");
    await h.tap(O, { text: "👤 উপস্থিতির দায়িত্ব", minY: 120 }, 4000);
    await waitFor(h, O, { text: "৩", minY: 60 }, 30000);
  }
  await h.tap(O, { text: "৩", minY: 60 }, 2000);
  await h.tap(O, { text: "বালক (Boys)", minY: 60 }, 2000);
  await h.shot(O, "teach-att-assign-marker", 2, [{ text: "৩", minY: 60 }, { text: "বালক (Boys)", minY: 60 }]);
  await h.tap(O, { text: "শিক্ষক নির্বাচন করুন…", minY: 120 }, 1500);
  await h.tap(O, { text: "উদাহরণ ইংরেজি শিক্ষক", minY: 120 }, 1500);
  await h.shot(O, "teach-att-assign-marker", 3, [
    { text: "উদাহরণ ইংরেজি শিক্ষক", minY: 120 },
    { text: "শুরুর তারিখ", minY: 120 },
    { text: "দায়িত্ব দিন", minY: 120 },
  ]);
  await h.tap(O, { text: "দায়িত্ব দিন", minY: 120 }, 3000);
  await dump(O, "after assign marker");
  await O.context().close();
}

// ── Work board ───────────────────────────────────────────────────────────────
async function workboard(h) {
  const T = await loginAt(h, "teacher@help.test");
  await menuRow(h, T, "teach-wb-new-task", 0, "কাজের বোর্ড", "আমার কাজ");
  await h.shot(T, "teach-wb-new-task", 1, [{ text: "+ নতুন কাজ", minY: 120 }]);
  await h.tap(T, { text: "+ নতুন কাজ", minY: 120 }, 3000);
  await (await h.topmost(T, below("কাজ"), { scroll: true })).fill("অভিভাবক সভার তালিকা বানানো");
  await h.tap(T, { text: "বিকাল", minY: 120 }, 800);
  await h.shot(T, "teach-wb-new-task", 2, [below("কাজ"), { text: "শেষ তারিখ", minY: 120 }, { text: "বিকাল", minY: 120 }]);
  await pinnedShot(h, T, "teach-wb-new-task", 3, [{ text: "কাজ দিন", minY: 120 }], { text: "কাজ দিন", minY: 120 });
  await h.tap(T, { text: "কাজ দিন", minY: 120 }, 3500);
  await dump(T, "after new task");

  // Move the new task along, on its own card.
  await fresh(T);
  await menuRow(h, T, "teach-wb-task-status", 0, "কাজের বোর্ড", "আমার কাজ");
  const onCard = (label) => ({ css: `:text-is("${label}"):below(:text-is("অভিভাবক সভার তালিকা বানানো"))` });
  await pinnedShot(h, T, "teach-wb-task-status", 1, [onCard("চলছে"), onCard("শেষ"), onCard("আটকে আছে")], { text: "অভিভাবক সভার তালিকা বানানো", minY: 120 }, "center");
  await h.tap(T, onCard("চলছে"), 2500);

  // A weekly recurring task.
  await fresh(T);
  await menuRow(h, T, "teach-wb-recurring", 0, "কাজের বোর্ড", "নিয়মিত কাজ");
  await dump(T, "templates");
  await h.shot(T, "teach-wb-recurring", 1, [{ text: "+ নতুন নিয়মিত কাজ", minY: 60 }]);
  await h.tap(T, { text: "+ নতুন নিয়মিত কাজ", minY: 60 }, 3000);
  await (await h.topmost(T, below("কাজ"), { scroll: true })).fill("সাপ্তাহিক অ্যাসাইনমেন্টের শিট প্রিন্টে দেওয়া");
  await h.tap(T, { text: "প্রতি সপ্তাহে", minY: 120 }, 1200);
  await dump(T, "weekly form");
  await h.tap(T, { text: "বৃহস্পতিবার", minY: 120 }, 800);
  await h.shot(T, "teach-wb-recurring", 2, [below("কাজ"), { text: "প্রতি সপ্তাহে", minY: 120 }, { text: "বৃহস্পতিবার", minY: 120 }]);
  await pinnedShot(h, T, "teach-wb-recurring", 3, [{ text: "কাজ দিন", minY: 120 }], { text: "কাজ দিন", minY: 120 });
  await h.tap(T, { text: "কাজ দিন", minY: 120 }, 3500);
  await dump(T, "after recurring");
  await T.context().close();

  // Office gives a task to the class teacher.
  const O = await loginAt(h, "office@help.test");
  await go(h, O, "কাজের বোর্ড", "আমার কাজ");
  await h.shot(O, "teach-wb-assign", 0, [{ text: "+ নতুন কাজ", minY: 120 }]);
  await h.tap(O, { text: "+ নতুন কাজ", minY: 120 }, 3000);
  await (await h.topmost(O, below("কাজ"), { scroll: true })).fill("৩য় বালকের অভিভাবক সভার নোটিশ লেখা");
  await dump(O, "assign form");
  await h.tap(O, { text: "উদাহরণ অফিস কর্মী (নিজে)", minY: 120 }, 1500);
  await dump(O, "assignee open");
  await h.tap(O, { re: "^উদাহরণ শ্রেণি শিক্ষক", minY: 120 }, 1500);
  await h.shot(O, "teach-wb-assign", 1, [below("কাজ"), { re: "^উদাহরণ শ্রেণি শিক্ষক", minY: 120 }]);
  await pinnedShot(h, O, "teach-wb-assign", 2, [{ text: "কাজ দিন", minY: 120 }], { text: "কাজ দিন", minY: 120 });
  await h.tap(O, { text: "কাজ দিন", minY: 120 }, 3500);
  await fresh(O);
  await openMenuAt(h, O, "কাজের বোর্ড", "আমার দেওয়া কাজ");
  await h.shot(O, "teach-wb-assign", 3, [{ text: "আমার দেওয়া কাজ", minY: 60 }], { anchor: { text: "কাজের বোর্ড", minY: 60 } });
  await O.context().close();
}

// ── Same-day mark fix + own notes (after hw: সাকিব is still "দেয়নি" today) ─────
async function markfix(h) {
  const T = await loginAt(h, "teacher@help.test");
  const WED_MATH = { re: "বুধবার · .* · গণিত$", minY: 120 };
  await fresh(T);
  await go(h, T, "ট্র্যাকার", "বাড়ির কাজ");
  await h.shot(T, "teach-mark-fix", 0, [{ text: "বাড়ির কাজ", minY: 120 }]);
  await h.tap(T, { text: "বাড়ির কাজ", minY: 120 }, 3500);
  // Same-day fix: সাকিব did bring it — marked "দেয়নি" by mistake.
  await h.tap(T, WED_MATH, 2000);
  const sakibChip = { re: "^সাকিব হাসান", minY: 120 };
  await h.tap(T, sakibChip, 900);
  await pinnedShot(h, T, "teach-mark-fix", 1, [WED_MATH, sakibChip, { text: "জমা নিশ্চিত করুন", minY: 120 }], WED_MATH, "start");
  await h.tap(T, { text: "জমা নিশ্চিত করুন", minY: 120 }, 2500);
  await dump(T, "mistake reason sheet");
  // The reason sheet is a modal over the header, so these two rows use plain pictures.
  await h.shot(T, "teach-mark-fix", 2, [{ text: "আমার ভুল ছিল", minY: 120 }]);
  await h.tap(T, { text: "আমার ভুল ছিল", minY: 120 }, 1200);
  await h.shot(T, "teach-mark-fix", 3, [{ text: "জমা দিন ও বদলান", minY: 120 }]);
  await h.tap(T, { text: "জমা দিন ও বদলান", minY: 120 }, 3500);
  await dump(T, "after mark fix");

  // The teacher's own correction notes (HR → নম্বর জমায় ভুল).
  await fresh(T);
  await menuRow(h, T, "teach-mark-notes", 0, null, "কর্মী");
  await h.shot(T, "teach-mark-notes", 1, [{ text: "নম্বর জমায় ভুল", minY: 120 }]);
  await h.tap(T, { text: "নম্বর জমায় ভুল", minY: 120 }, 4000);
  await dump(T, "mark notes");

  await T.context().close();
}

// ── Office: the weekly gift handover (before the as part moves the week on) ─────
async function gift(h) {
  const O = await loginAt(h, "office@help.test");
  const GIFT = { text: "🎁 সাপ্তাহিক উপহার — কোন শ্রেণিতে কে পেল", minY: 120 };
  await waitFor(h, O, GIFT);
  await h.shot(O, "teach-gift-given", 0, [GIFT]);
  await h.tap(O, GIFT, 2000);
  const FOLD = { re: "৩য় শ্রেণি বালক \\(", minY: 120 };
  await h.shot(O, "teach-gift-given", 1, [FOLD]);
  await h.tap(O, FOLD, 2000);
  const giveArif = { css: `:text-is("উপহার দিলাম"):right-of(:text-is("আরিফ হোসেন"))` };
  await h.shot(O, "teach-gift-given", 2, [giveArif]);
  await h.tap(O, giveArif, 2500);
  await dump(O, "after gift");

  await O.context().close();
}

// ── Office: rotation, follow-up list ─────────────────────────────────────────
async function office(h) {
  const O = await loginAt(h, "office@help.test");
  // Rotation: add বিজ্ঞান for ৩য় বালিকা on rotation week 2.
  await menuRow(h, O, "teach-as-rotation", 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
  await h.shot(O, "teach-as-rotation", 1, [{ text: "⚙️ অ্যাসাইনমেন্ট রুটিন", minY: 120 }]);
  await h.tap(O, { text: "⚙️ অ্যাসাইনমেন্ট রুটিন", minY: 120 }, 4000);
  await dump(O, "schedule");
  const wk2 = { css: `:text-is("২"):below(:text-is("রোটেশন সপ্তাহ"))` };
  await h.tap(O, wk2, 800);
  await h.tap(O, { css: `:text-is("শ্রেণি"):below(:text-is("রোটেশন সপ্তাহ")) >> nth=1` }, 1200);
  await h.tap(O, { text: "৩য় শ্রেণি", minY: 120 }, 1500);
  await h.tap(O, { css: `:text-is("শাখা"):below(:text-is("রোটেশন সপ্তাহ")) >> nth=1` }, 1200);
  await dump(O, "section select open");
  await h.tap(O, { re: "বালিকা", minY: 120 }, 1200);
  await h.tap(O, { css: `:text-is("বিজ্ঞান"):below(:text-is("রোটেশন সপ্তাহ"))` }, 800);
  await h.tap(O, { css: `:text-is("শিক্ষক"):below(:text-is("বিষয়")) >> nth=1` }, 1200);
  await dump(O, "teacher select open");
  await h.tap(O, { re: "^উদাহরণ ইংরেজি শিক্ষক", minY: 120 }, 1200);
  await pinnedShot(
    h,
    O,
    "teach-as-rotation",
    2,
    [
      wk2,
      { re: "বালিকা", minY: 120 },
      { css: `:text-is("বিজ্ঞান"):below(:text-is("রোটেশন সপ্তাহ"))` },
      { re: "^উদাহরণ ইংরেজি শিক্ষক", minY: 120 },
      { text: "নতুন এন্ট্রি", minY: 120, last: true },
    ],
    { text: "রোটেশন সপ্তাহ", minY: 120 },
    "start",
  );
  await h.tap(O, { text: "নতুন এন্ট্রি", minY: 120, last: true }, 3000);
  await dump(O, "after rotation entry");

  // Follow-up list (needs the as part's chase of সাকিব).
  await fresh(O);
  await menuRow(h, O, "teach-as-chase", 0, "ট্র্যাকার", "অ্যাসাইনমেন্ট");
  await h.shot(O, "teach-as-chase", 1, [{ text: "📣 ফলো-আপ তালিকা", minY: 120 }]);
  await h.tap(O, { text: "📣 ফলো-আপ তালিকা", minY: 120 }, 4000);
  await dump(O, "chase list");
  await h.shot(O, "teach-as-chase", 2, [{ text: "পরবর্তী ধাপ নিন", minY: 120 }, { re: "^ফলো-আপ ইতিহাস", minY: 120 }]);
  await O.context().close();
}

// ── Daily tracker + Saturday revision (teacher) ─────────────────────────────
async function trackers(h) {
  const T = await loginAt(h, "teacher@help.test");
  await h.shot(T, "teach-trk-run", 0, [{ text: "ট্র্যাকার", minY: 300 }]);
  await h.tap(T, { text: "ট্র্যাকার", minY: 300 }, 3500);
  await h.shot(T, "teach-trk-run", 1, [{ text: "ট্র্যাকার খুলুন", minY: 120 }]);
  await h.tap(T, { text: "ট্র্যাকার খুলুন", minY: 120 }, 3500);
  await h.shot(T, "teach-trk-run", 2, [{ text: "খুলুন", minY: 120 }]);
  await h.tap(T, { text: "খুলুন", minY: 120 }, 3500);
  const trk = (name, label) => ({ css: `:text-is("${label}"):right-of(:text-is("${name}"))` });
  await h.tap(T, trk("আরিফ হোসেন", "সম্পন্ন"), 1200);
  await h.shot(T, "teach-trk-run", 3, [trk("তানভীর আহমেদ", "সম্পন্ন"), trk("তানভীর আহমেদ", "অসম্পূর্ণ"), { text: "✕", minY: 60 }]);
  await h.tap(T, trk("তানভীর আহমেদ", "অসম্পূর্ণ"), 1200);
  await dump(T, "tracker entry");

  // Saturday revision (the class teacher also leads হিফজ ১ on Saturdays here).
  const openGrid = async (guide) => {
    await fresh(T);
    await menuRow(h, T, guide, 0, "ট্র্যাকার", "রিভিশন");
    await waitFor(h, T, { text: "গ্রিড খুলুন", minY: 120 });
    if (guide !== "teach-rev-send") {
      await h.shot(T, guide, 1, [{ text: "গ্রিড খুলুন", minY: 120 }]);
      await h.tap(T, { text: "গ্রিড খুলুন", minY: 120 }, 4000);
    }
  };
  await openGrid("teach-rev-enter");
  const inCard = (name, label) => ({ css: `:text-is("${label}"):below(:text-is("${name}"))` });
  await h.tap(T, inCard("আদিবা হক", "উপস্থিত"), 800);
  await h.tap(T, inCard("আদিবা হক", "সম্পন্ন"), 800);
  await pinnedShot(h, T, "teach-rev-enter", 2, [inCard("আদিবা হক", "উপস্থিত"), inCard("আদিবা হক", "অবস্থা"), inCard("আদিবা হক", "শুরু")], { text: "আদিবা হক", minY: 120 }, "start");
  // Saved as absent in the walk (a range needs two long surah lists); the picture shows the form.
  await h.tap(T, inCard("আদিবা হক", "অনুপস্থিত"), 800);
  await pinnedShot(h, T, "teach-rev-enter", 3, [inCard("আদিবা হক", "সংরক্ষণ করুন")], inCard("আদিবা হক", "সংরক্ষণ করুন"), "center");
  await h.tap(T, inCard("আদিবা হক", "সংরক্ষণ করুন"), 3000);
  await dump(T, "after revision save");

  await openGrid("teach-rev-send");
  await h.shot(T, "teach-rev-send", 1, [{ text: "পাঠান", minY: 120 }]);
  await h.tap(T, { text: "পাঠান", minY: 120 }, 3500);
  await h.shot(T, "teach-rev-send", 2, [{ text: "সবগুলো পাঠান", minY: 120 }]);
  await h.tap(T, { text: "সবগুলো পাঠান", minY: 120 }, 4000);
  await dump(T, "after send all");

  // Correct জুনায়েদ's sent entry (no menu row: four screens already).
  await fresh(T);
  await go(h, T, "ট্র্যাকার", "রিভিশন");
  await waitFor(h, T, { text: "গ্রিড খুলুন", minY: 120 });
  await h.shot(T, "revision-correct-sent", 0, [{ text: "গ্রিড খুলুন", minY: 120 }]);
  await h.tap(T, { text: "গ্রিড খুলুন", minY: 120 }, 4000);
  const fix = inCard("জুনায়েদ করিম", "সংশোধন করুন");
  await pinnedShot(h, T, "revision-correct-sent", 1, [fix], { text: "জুনায়েদ করিম", minY: 120 }, "center");
  await h.tap(T, fix, 2000);
  await h.tap(T, inCard("জুনায়েদ করিম", "আংশিক"), 800);
  await pinnedShot(h, T, "revision-correct-sent", 2, [inCard("জুনায়েদ করিম", "আংশিক")], inCard("জুনায়েদ করিম", "আংশিক"), "center");
  await (await h.topmost(T, below("কেন সংশোধন করছেন (আবশ্যক)", "textarea"), { scroll: true }).catch(() => h.topmost(T, below("কেন সংশোধন করছেন (আবশ্যক)"), { scroll: true }))).fill(
    "পড়া পুরো হয়নি — ১৫ আয়াত পর্যন্ত হয়েছিল",
  );
  await T.locator("body").click({ position: { x: 5, y: 300 } });
  await pinnedShot(
    h,
    T,
    "revision-correct-sent",
    3,
    [{ text: "কেন সংশোধন করছেন (আবশ্যক)", minY: 120 }, { text: "সংশোধন পাঠান", minY: 120 }],
    { text: "সংশোধন পাঠান", minY: 120 },
    "end",
  );
  await h.tap(T, { text: "সংশোধন পাঠান", minY: 120 }, 3000);
  await dump(T, "after correction");
  await T.context().close();
}

// ── Vocabulary test ──────────────────────────────────────────────────────────
async function vocab(h) {
  const openVocab = async (page, guide) => {
    await openMenuAt(h, page, "একাডেমিক", "ভোকাবুলারি");
    if (guide) await h.shot(page, guide, 0, [{ text: "একাডেমিক", minY: 60 }, { text: "ভোকাবুলারি", minY: 60 }], { anchor: { text: "একাডেমিক", minY: 60 } });
    await h.tap(page, { text: "ভোকাবুলারি", minY: 60 }, 3500);
  };
  const pick = async (page, placeholder, option) => {
    await h.tap(page, { text: placeholder, minY: 120 }, 1200);
    await h.tap(page, { text: option, minY: 120 }, 1500);
  };

  // Office: this week's tester for ৩য় বালিকা English.
  const O = await loginAt(h, "office@help.test");
  await openVocab(O, "teach-vocab-assign");
  await h.shot(O, "teach-vocab-assign", 1, [{ text: "সাপ্তাহিক দায়িত্ব নির্ধারণ", minY: 120 }]);
  await h.tap(O, { text: "সাপ্তাহিক দায়িত্ব নির্ধারণ", minY: 120 }, 3500);
  await pick(O, "প্রোগ্রাম নির্বাচন করুন", "ইংরেজি");
  await pick(O, "শ্রেণি নির্বাচন করুন", "৩য় শ্রেণি");
  await h.tap(O, { text: "শাখা নির্বাচন করুন", minY: 120 }, 1200);
  await dump(O, "vocab section options");
  await h.tap(O, { re: "বালিকা", minY: 120 }, 1500);
  const week = await h.topmost(O, below("সপ্তাহ (যেকোনো তারিখ)"), { scroll: true });
  await week.fill("2026-11-05").catch(async () => week.type("2026-11-05"));
  await pick(O, "শিক্ষক নির্বাচন করুন…", "উদাহরণ ইংরেজি শিক্ষক");
  await dump(O, "vocab assign form");
  await pinnedShot(
    h,
    O,
    "teach-vocab-assign",
    2,
    [
      { text: "ইংরেজি", minY: 120 },
      { re: "বালিকা", minY: 120 },
      { text: "2026-11-05", minY: 120 },
      { text: "উদাহরণ ইংরেজি শিক্ষক", minY: 120 },
      { text: "টেস্টার নির্ধারণ করুন", minY: 120, last: true },
    ],
    { text: "প্রোগ্রাম", minY: 60 },
    "start",
  );
  await h.tap(O, { text: "টেস্টার নির্ধারণ করুন", minY: 120, last: true }, 3000);
  await dump(O, "after vocab assign");
  await O.context().close();

  // teacher2: add a word, build this week's test, mark it.
  const E = await loginAt(h, "teacher2@help.test");
  await openVocab(E, "teach-vocab-words");
  await h.shot(E, "teach-vocab-words", 1, [{ text: "শব্দভাণ্ডার", minY: 120 }]);
  await h.tap(E, { text: "শব্দভাণ্ডার", minY: 120 }, 3500);
  await pick(E, "প্রোগ্রাম নির্বাচন করুন", "ইংরেজি");
  await pick(E, "শ্রেণি নির্বাচন করুন", "শ্রেণি ৩");
  await h.shot(E, "teach-vocab-words", 2, [{ text: "ইংরেজি", minY: 120 }, { text: "শ্রেণি ৩", minY: 120 }]);
  await (await h.topmost(E, below("শব্দ"), { scroll: true })).fill("garden");
  await (await h.topmost(E, below("বাংলা অর্থ"), { scroll: true })).fill("বাগান");
  await h.shot(E, "teach-vocab-words", 3, [below("শব্দ"), below("বাংলা অর্থ"), { text: "যোগ করুন", minY: 120 }]);
  await h.tap(E, { text: "যোগ করুন", minY: 120 }, 3000);
  await dump(E, "after word");

  await fresh(E);
  await openVocab(E, null);
  await dump(E, "vocab home after assign");
  await h.shot(E, "teach-vocab-build", 0, [{ text: "টেস্টসমূহ", minY: 120 }]);
  await h.tap(E, { text: "টেস্টসমূহ", minY: 120 }, 3500);
  await h.shot(E, "teach-vocab-build", 1, [{ text: "নতুন টেস্ট", minY: 120 }]);
  await h.tap(E, { text: "নতুন টেস্ট", minY: 120 }, 3500);
  await dump(E, "build form");
  await pick(E, "প্রোগ্রাম নির্বাচন করুন", "ইংরেজি");
  await pick(E, "শ্রেণি নির্বাচন করুন", "৩য় শ্রেণি");
  await h.tap(E, { text: "শাখা নির্বাচন করুন", minY: 120 }, 1200);
  await h.tap(E, { re: "বালিকা", minY: 120 }, 1500);
  await (await h.topmost(E, below("শিরোনাম (যেমন Set 1)"), { scroll: true })).fill("Set 1");
  await (await h.topmost(E, below("মোট নম্বর"), { scroll: true })).fill("10");
  await E.locator("body").click({ position: { x: 5, y: 300 } });
  await dump(E, "build form filled");
  await pinnedShot(
    h,
    E,
    "teach-vocab-build",
    2,
    [{ text: "ইংরেজি", minY: 120 }, below("শিরোনাম (যেমন Set 1)"), below("মোট নম্বর"), { text: "টেস্ট তৈরি করুন", minY: 120 }],
    { text: "টেস্ট তৈরি করুন", minY: 120 },
    "end",
  );
  await h.tap(E, { text: "টেস্ট তৈরি করুন", minY: 120 }, 3500);
  await dump(E, "after create test");
  for (const w of ["apple", "book", "river", "mother", "school"]) await h.tap(E, { text: w, minY: 120 }, 400).catch(() => {});
  await dump(E, "words picked");
  await pinnedShot(h, E, "teach-vocab-build", 3, [{ text: "apple", minY: 120 }, { text: "শব্দ নির্বাচন → প্রশ্ন সাজান", minY: 120 }], {
    text: "শব্দ নির্বাচন → প্রশ্ন সাজান",
    minY: 120,
  });
  await h.tap(E, { text: "শব্দ নির্বাচন → প্রশ্ন সাজান", minY: 120 }, 3500);
  await dump(E, "after positions");
  await E.context().close();
}

exports.run = async (hh) => {
  // On a failed picture, keep what the page looked like (local debugging only).
  const h = {
    ...hh,
    shot: async (page, ...a) => {
      try {
        await hh.shot(page, ...a);
      } catch (e) {
        if (process.env.TEACH_FAIL_SHOT) await page.screenshot({ path: process.env.TEACH_FAIL_SHOT });
        throw e;
      }
    },
  };
  if (h.PROD) throw new Error("the teach spec saves while it walks; run it locally (see its header)");
  // Each part runs on its own: a failed part is reported and the others still save their pictures.
  const parts = { hw: homework, fix: markfix, gift, as: assignment, att: attendance, wb: workboard, off: office, trk: trackers, voc: vocab };
  const failed = [];
  for (const [name, part] of Object.entries(parts)) {
    if (!want(name)) continue;
    try {
      await part(h);
    } catch (e) {
      failed.push(name);
      console.error(`PART ${name} FAILED: ${String(e && e.stack ? e.stack : e).slice(0, 1500)}`);
    }
  }
  if (failed.length) console.error(`FAILED PARTS: ${failed.join(", ")}`);
};
