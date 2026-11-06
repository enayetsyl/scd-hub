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
  try {
    const el = await h.topmost(page, target, { scroll: true });
    await el.fill(value);
  } catch (e) {
    if (!h.missed) throw e;
    console.error(`FILL MISS ${JSON.stringify(target)}: ${String(e.message).split("\n")[0]}`);
  }
  await page.waitForTimeout(wait);
}

/** Scroll the first on-top match of `target` to the top of its scroller (room for the box above). */
async function scrollTo(h, page, target, gap = 80) {
  const el = await h.topmost(page, target, { scroll: true }).catch((e) => {
    // A missing scroll anchor costs at most the next picture (soft mode), not the whole walk.
    console.error(`SCROLL MISS ${JSON.stringify(target)}: ${String(e.message).split("\n")[0]}`);
    return null;
  });
  if (!el) return;
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

/** Open the app's Select whose field label matches `label` (it opens below the label) and pick `option`. */
async function pick(h, page, label, option, wait = 1500) {
  const el = await h.topmost(page, label, { scroll: true });
  const b = await el.boundingBox();
  await page.mouse.click(b.x + 60, b.y + b.height + 24);
  await page.waitForTimeout(1000);
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

/** Wait until `text` (exact) is on the page. */
async function waitText(page, text, timeout = 60000) {
  await page.getByText(text, { exact: true }).locator("visible=true").first().waitFor({ timeout });
  await page.waitForTimeout(800);
}

/**
 * Make a failed picture non-fatal: the guide stays a draft (reported at the end) and the rest of
 * the walk still writes its guides. capture.cjs writes guide files only when the whole run ends.
 */
function soft(h) {
  const shot = h.shot;
  h.missed = [];
  h.shot = async (page, guide, row, targets, opts) => {
    try {
      await shot(page, guide, row, targets, opts);
    } catch (e) {
      h.missed.push(`${guide} row ${row + 1}`);
      console.error(`MISSED ${guide} row ${row + 1}: ${String(e.message).split("\n")[0]}`);
    }
  };
  const tap = h.tap;
  h.tap = async (page, target, wait) => {
    try {
      await tap(page, target, wait);
    } catch (e) {
      console.error(`TAP MISS ${JSON.stringify(target)}: ${String(e.message).split("\n")[0]}`);
    }
  };
}

module.exports = { PASSWORD, soft, waitText, pick, login, openItem, menuShot, home, back, fill, scrollTo, select, tmpFile, chooseFiles };
