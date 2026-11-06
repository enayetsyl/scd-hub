/**
 * Shared walk helpers for the content capture specs (content-*.cjs). Not a spec itself.
 * Logins come from scripts/help/fixtures/content.ts (example data; password Help@123).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PASSWORD = "Help@123";

async function login(h, user) {
  return (await h.login(user, PASSWORD)).page;
}

/** Open the drawer and make `item` visible, tapping `group` first when it is folded away. */
async function openItem(h, page, group, item) {
  await h.openMenu(page);
  if (!group) return;
  const onTop = await h.topmost(page, { text: item }, { scroll: true }).then(() => true, () => false);
  if (!onTop) await h.tap(page, group, 1200);
}

/** Drawer row: box the group and the item, then open the item. `guide` null = just navigate. */
async function menuShot(h, page, guide, row, group, item, wait = 3500) {
  await openItem(h, page, group, item);
  if (guide) {
    const targets = group ? [{ text: group }, { text: item }] : [{ text: item }];
    await h.shot(page, guide, row, targets, { anchor: { text: group ?? item } });
  }
  await h.tap(page, item, wait);
}

/** Start again from the landing screen (the capture login clears the saved navigation). */
async function home(page) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
}

/** Tap the header back arrow of the screen on top. */
async function back(page, wait = 2500) {
  await page.mouse.click(26, 32);
  await page.waitForTimeout(wait);
}

/** Fill the on-top element matching `target`. */
async function fill(h, page, target, value, wait = 1000) {
  const el = await h.topmost(page, target, { scroll: true });
  await el.fill(value);
  await page.waitForTimeout(wait);
}

/** Scroll the first on-top match of `target` to the top of its scroller (room for the box above). */
async function scrollTo(h, page, target, gap = 80) {
  const el = await h.topmost(page, target, { scroll: true });
  await el.evaluate((e, g) => {
    e.scrollIntoView({ block: "start" });
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        p.scrollBy(0, -g);
        break;
      }
    }
  }, gap);
  await page.waitForTimeout(500);
}

/** Pick `option` in the app's Select whose closed box shows `placeholder` (or its current value). */
async function select(h, page, placeholder, option, wait = 1200) {
  await h.tap(page, placeholder, 1200);
  await h.tap(page, { text: option, last: true }, wait);
}

/** A scratch file for a file picker; returns its path. */
function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "help-content-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return f;
}

/** Tap the element that opens the file picker and hand it `files`. */
async function chooseFiles(h, page, target, files, wait = 2500) {
  const el = await h.topmost(page, typeof target === "string" ? { text: target } : target, { scroll: true });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15000 }), el.click()]);
  await chooser.setFiles(files);
  await page.waitForTimeout(wait);
}

module.exports = { PASSWORD, login, openItem, menuShot, home, back, fill, scrollTo, select, tmpFile, chooseFiles };
