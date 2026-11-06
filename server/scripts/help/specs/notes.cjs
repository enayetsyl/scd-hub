/**
 * Capture spec — class notes, lesson-plan progress, routine, covers, classes & শাখা,
 * teaching assignments (the `notes-*` guides).
 *
 * LOCAL ONLY. It writes notes, covers, holidays and routine changes while it walks, so it
 * needs a fresh example school each run:
 *
 *   cd server
 *   node scripts/help/mem.cjs 27915                                   (PowerShell)
 *   $env:MONGODB_URI='mongodb://127.0.0.1:27915/hc'; $env:TZ='Asia/Dhaka'
 *   $env:HELP_NOW='2026-11-05T10:20:00+06:00'
 *   npx tsx --require ./scripts/help/fixtures/notes-clock.cjs scripts/help/fixtures/notes.ts --reset
 *   (server: the same three env vars + PORT + the dummy GOOGLE_OAUTH_* values, and
 *    npx tsx --require ./scripts/help/fixtures/notes-clock.cjs src/index.ts)
 *   node scripts/help/serve-web.cjs --dir C:/w/hc-web --port 8315 --api 4315
 *   node scripts/help/capture.cjs --spec notes --base http://localhost:8315
 *
 * "Today" is Thursday 2026-11-05 during period 6: the server's clock is shifted by
 * fixtures/notes-clock.cjs and the browser's is pinned here (Playwright clock), because the
 * routine screens are empty on a Friday or after school.
 * Logins come from scripts/help/fixture.ts (example data; password Help@123).
 */
const PASSWORD = "Help@123";
const NOW = new Date(process.env.HELP_BROWSER_NOW || "2026-11-05T10:22:00+06:00");
const DEBUG_DIR = process.env.NOTES_DEBUG_DIR || null;

/** Sign in, then pin the page clock to the example "today" and reload. */
async function loginAt(h, user) {
  const { context, page } = await h.login(user, PASSWORD);
  await context.clock.setFixedTime(NOW);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
  return { context, page };
}

let dbg = 0;
/** Debug picture + page text (only when NOTES_DEBUG_DIR is set). */
async function peek(page, name) {
  if (!DEBUG_DIR) return;
  dbg += 1;
  require("node:fs").mkdirSync(DEBUG_DIR, { recursive: true });
  await page.screenshot({ path: `${DEBUG_DIR}/${String(dbg).padStart(2, "0")}-${name}.png` });
  const t = (await page.locator("body").innerText()).split("\n").filter(Boolean).join(" | ");
  console.log(`== ${name}: ${t.slice(0, 900)}`);
}

/**
 * Tag the idx-th visible on-screen match of `text` (top to bottom, below minY) with
 * data-help=tag, so a step can target ONE of several identical buttons ({ css }).
 */
async function mark(page, text, idx, tag, { minY = 110, exact = true, re = false } = {}) {
  const loc = page.getByText(re ? new RegExp(text) : text, { exact: re ? undefined : exact }).locator("visible=true");
  const n = await loc.count();
  const found = [];
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const b = await el.boundingBox();
    if (!b || b.width === 0) continue;
    const onTop = await el.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      if (cx < 0 || cx > window.innerWidth) return false; // e.g. the closed drawer
      if (r.top + r.height / 2 > window.innerHeight) return true; // below the fold: scrolled to later
      const hit = document.elementFromPoint(cx, r.top + r.height / 2);
      return !!hit && (e === hit || e.contains(hit) || hit.contains(e));
    });
    if (onTop && b.y >= minY) found.push({ el, y: b.y });
  }
  found.sort((a, b) => a.y - b.y);
  if (!found[idx]) throw new Error(`mark: no match #${idx} for ${text} (${found.length} found)`);
  await found[idx].el.evaluate((e, t) => e.setAttribute("data-help", t), tag);
  return { css: `[data-help="${tag}"]` };
}

/** Scroll the nearest scrolling parent of a target so it sits near the top. */
async function scrollTo(h, page, target, offset = 90) {
  const el = await h.topmost(page, target, { scroll: false }).catch(async () => {
    // Off-screen: scroll it into view first, then test again.
    const loc = target.css
      ? page.locator(target.css)
      : page.getByText(target.re ? new RegExp(target.re) : target.text, { exact: !target.re });
    await loc.first().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    return h.topmost(page, target, { scroll: false });
  });
  await el.evaluate((e, off) => {
    e.scrollIntoView({ block: "start" });
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        p.scrollBy(0, -off);
        break;
      }
    }
  }, offset);
  await page.waitForTimeout(500);
}

/** Drawer: open ☰, expand `group` if `item` is not showing yet. */
async function drawer(h, page, group, item) {
  await h.openMenu(page);
  const shown = await h.topmost(page, { text: item }, { scroll: true }).then(() => true, () => false);
  if (!shown && group) await h.tap(page, group, 1200);
}

/** Drawer row picture (group + item), then open the item. */
async function drawerShot(h, page, guide, row, group, item) {
  await drawer(h, page, group, item);
  const targets = group ? [{ text: group }, { text: item }] : [{ text: item }];
  await h.shot(page, guide, row, targets, group ? { anchor: { text: group } } : {});
  await h.tap(page, item, 3500);
}

/** The header ← (React Navigation's back button). */
async function back(h, page) {
  await h.tap(page, { css: '[aria-label="Go back"]' }, 2500);
}

/** Pick an option in an open Select menu by its label. */
async function pick(h, page, label) {
  await h.tap(page, { text: label, last: true }, 1200);
}

exports.helpers = { loginAt, peek, mark, scrollTo, drawer, drawerShot, pick, back };

exports.run = async (h) => {
  if (h.PROD) throw new Error("the notes spec saves while it walks; run it locally (see its header)");
  const part = process.env.NOTES_PART || "all";
  const want = (p) => part === "all" || part.split(",").includes(p);
  if (want("switch")) await require("./notes-lesson.cjs").switchOn(h, exports.helpers);
  if (want("teacher")) await require("./notes-teacher.cjs").run(h, exports.helpers);
  if (want("office")) await require("./notes-office.cjs").run(h, exports.helpers);
  if (want("admin")) await require("./notes-admin.cjs").run(h, exports.helpers);
};
