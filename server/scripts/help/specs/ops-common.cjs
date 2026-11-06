/**
 * Shared walk helpers for the ops capture specs (ops-*.cjs). Not a spec itself.
 * Logins come from scripts/help/fixtures/ops.ts (example data; password Help@123).
 */
const PASSWORD = "Help@123";

/** Open the drawer and tap a menu item; `group` is tapped first when the item is folded away. */
async function menu(h, page, item, group, wait = 3000) {
  await h.openMenu(page);
  if (group) {
    const onTop = await h.topmost(page, typeof item === "string" ? { text: item } : item, { scroll: true }).then(() => true, () => false);
    if (!onTop) await h.tap(page, group, 1200);
  }
  await h.tap(page, item, wait);
}

/** Open the drawer and shoot it with the boxes on `targets` (the group/item being opened). */
async function menuShot(h, page, guide, row, targets, opts) {
  await h.openMenu(page);
  await h.shot(page, guide, row, targets, opts);
}

/** Tap the header back arrow of the screen on top. */
async function back(h, page, wait = 2000) {
  await h.tap(page, { text: "←" }, wait);
}

/** Close a transparent modal (the 👤 menu) by tapping outside it. */
async function tapOutside(page) {
  await page.mouse.click(40, 800);
  await page.waitForTimeout(800);
}

/** Start again from the landing screen (the capture login clears the saved navigation). */
async function home(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
}

/** Fill the first visible, on-top element matching `target` (a capture target). */
async function fill(h, page, target, value, wait = 1200) {
  const el = await h.topmost(page, target, { scroll: true });
  await el.fill(value);
  await page.waitForTimeout(wait);
}

/** Close any pop-up notice on screen (✕ or its close button), if one is showing. */
async function closePopups(h, page) {
  for (let i = 0; i < 3; i++) {
    const x = await h.topmost(page, { re: "^(✕|বন্ধ করুন)$" }, { scroll: false }).catch(() => null);
    if (!x) return;
    await x.click();
    await page.waitForTimeout(1500);
  }
}

/** Scroll the last visible match of `target` into view (an anchor must already be on screen). */
async function reveal(page, target) {
  const loc = target.css ? page.locator(target.css) : target.re ? page.getByText(new RegExp(target.re)) : page.getByText(target.text, { exact: true });
  await loc.locator("visible=true").last().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);
}

module.exports = { PASSWORD, reveal, menu, menuShot, back, tapOutside, home, fill, closePopups };
