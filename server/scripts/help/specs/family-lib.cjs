/**
 * Shared helpers for the family capture specs (family-*.cjs, child.cjs). Not a spec itself.
 *
 * The family fixture (scripts/help/fixtures/family.ts) is dated Thursday 2026-11-05 and the
 * local server runs with fixtures/family-clock.cjs, so `session()` moves the browser clock
 * to the same day (real time of day) after signing in.
 *
 * Each spec starts with `h = wrap(h)`: Bangla nukta letters have two spellings
 * (ড় = ড + ় or one code point) and the app's labels mix them, so every text target is
 * turned into a pattern that accepts both. (A generic fix could live in capture.cjs.)
 */
const NUKTA = [
  ["ড়", "ড়"],
  ["ঢ়", "ঢ়"],
  ["য়", "য়"],
];

/** A regex source that accepts both spellings of every nukta letter in `src`. */
function loose(src) {
  let s = src;
  for (const [a, b] of NUKTA) s = s.split(a).join(b);
  for (const [a, b] of NUKTA) s = s.split(b).join(`(?:${a}|${b})`);
  return s;
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A capture target with its text turned into a nukta-tolerant exact pattern. */
function norm(target) {
  const t = typeof target === "string" ? { text: target } : { ...target };
  if (t.text !== undefined) {
    t.re = `^\\s*${loose(esc(t.text))}\\s*$`;
    delete t.text;
  } else if (t.re !== undefined) t.re = loose(t.re);
  return t;
}

/** The capture helpers with nukta-tolerant targets. */
function wrap(h) {
  return {
    ...h,
    shot: (p, g, r, ts, o = {}) => h.shot(p, g, r, ts.map((t) => (t.placeholder || t.css ? t : norm(t))), o.anchor ? { ...o, anchor: norm(o.anchor) } : o),
    tap: (p, t, w) => h.tap(p, norm(t), w),
    topmost: (p, t, o) => h.topmost(p, t.placeholder || t.css ? t : norm(t), o),
  };
}

// Same rule as fixtures/family-clock.cjs: HELP_DAY (Dhaka) at the real time of day.
const DAY = 86400000;
const DHAKA = 6 * 3600000;
function shiftedNow() {
  const realToday = Math.floor((Date.now() + DHAKA) / DAY) * DAY - DHAKA;
  return Date.now() + Date.parse(`${process.env.HELP_DAY || "2026-11-05"}T00:00:00+06:00`) - realToday;
}
const PASSWORD = "Help@123";

/** Sign in, move the browser clock to the fixture's day, and close any start-up pop-up. */
async function session(h, login) {
  const { context, page } = await h.login(login, PASSWORD);
  await context.clock.install({ time: new Date(shiftedNow()) });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
  // A slow first sign-in can leave the login page up; sign in again on the moved clock.
  const field = page.getByPlaceholder("you@school.edu / 01XXXXXXXXX");
  if (await field.isVisible().catch(() => false)) {
    await field.fill(login);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByText("লগইন", { exact: true }).last().click();
    await page.waitForTimeout(7000);
  }
  await dismiss(h, page);
  return { context, page };
}

/** Is this target visible and on top right now? */
async function onTop(h, page, target) {
  return h.topmost(page, typeof target === "string" ? { text: target } : target, { scroll: false }).then(
    () => true,
    () => false,
  );
}

/** The staff "meeting notes due" reminder (পরে) pops up once a day; close it. */
async function dismiss(h, page) {
  for (const t of ["পরে"]) {
    if (await onTop(h, page, t)) await h.tap(page, t, 1500);
  }
}

/** Open the drawer and make `item` visible (expanding `group` if it is collapsed). */
async function openDrawer(h, page, item, group) {
  await h.openMenu(page);
  if (group && !(await onTop(h, page, { text: item, last: true }))) await h.tap(page, group, 1200);
}

/** Drawer picture as row `row` of `guide`, then go to the item. */
async function menuShot(h, page, guide, row, item, group) {
  await openDrawer(h, page, item, group);
  const targets = group ? [{ text: group }, { text: item, last: true }] : [{ text: item, last: true }];
  await h.shot(page, guide, row, targets, group ? { anchor: { text: group } } : {});
  await h.tap(page, { text: item, last: true }, 3500);
}

/** Go somewhere through the drawer without a picture. */
async function go(h, page, item, group) {
  await openDrawer(h, page, item, group);
  await h.tap(page, { text: item, last: true }, 3500);
}

/** Back to the start page (the nav state is cleared on every load). */
async function fresh(h, page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
  await dismiss(h, page);
}

/** Scroll the first (or `last`) visible match of `target` into view; an anchor must be on screen. */
async function reveal(page, target) {
  const t = norm(target);
  const all = page.getByText(new RegExp(t.re)).locator("visible=true");
  const n = await all.count();
  if (n === 0) throw new Error(`reveal: nothing matches ${JSON.stringify(target)}`);
  await all.nth(t.last ? n - 1 : 0).evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
}

/** shot() with its anchor scrolled into view first. */
async function shotAt(h, page, guide, row, targets, anchor) {
  await reveal(page, anchor);
  await h.shot(page, guide, row, targets, { anchor });
}

/** Type into the first input or text box that follows the label `label` on the page. */
async function fillAfter(page, label, value) {
  const t = norm(typeof label === "string" ? { text: label } : label);
  const el = page.getByText(new RegExp(t.re)).locator("visible=true").first();
  await el.locator("xpath=following::*[self::input or self::textarea][1]").fill(value);
  await page.waitForTimeout(300);
}

module.exports = { fillAfter, wrap, norm, session, fresh, reveal, shotAt, onTop, dismiss, openDrawer, menuShot, go, PASSWORD };
