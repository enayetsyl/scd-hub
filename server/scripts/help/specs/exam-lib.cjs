/**
 * Shared helpers for the exam-area capture specs (specs/exam*.cjs). Not a spec itself.
 * Data: scripts/help/fixtures/exam.ts (example data; password Help@123).
 */
const PASSWORD = "Help@123";

/** Open the drawer and make `item` visible, expanding `group` when it is collapsed. */
async function openItem(h, page, group, item) {
  await h.openMenu(page);
  if (!group) return;
  const onTop = await h.topmost(page, { text: item }, { scroll: true }).then(() => true, () => false);
  if (!onTop) await h.tap(page, group, 1200);
}

/** The drawer picture (group + item boxes) for every guide in `guides` (row `row`), then open the item. */
async function menuShots(h, page, guides, group, item, row = 0) {
  await openItem(h, page, group, item);
  for (const g of guides) {
    await h.shot(page, g, row, group ? [{ text: group }, { text: item }] : [{ text: item }], group ? { anchor: { text: group } } : {});
  }
  await h.tap(page, item, 3500);
}

/** Open a drawer item without taking a picture. */
async function go(h, page, group, item, wait = 3500) {
  await openItem(h, page, group, item);
  await h.tap(page, item, wait);
}

/** Fill the visible input that follows a label (RN-web Field: label text, then its TextInput). */
async function fillAfter(page, label, value, { exact = true, last = false } = {}) {
  const lab = page.getByText(label instanceof RegExp ? label : label, { exact: label instanceof RegExp ? undefined : exact }).locator("visible=true");
  const n = await lab.count();
  if (!n) throw new Error(`label not found: ${label}`);
  const el = last ? lab.nth(n - 1) : lab.first();
  const input = el.locator("xpath=following::input[1] | following::textarea[1]").first();
  await input.fill(String(value));
  await page.waitForTimeout(300);
}

/** Fill a DateField (web: an <input type="date">) that follows a label. */
async function fillDateAfter(page, label, value, { last = false } = {}) {
  const lab = page.getByText(label, { exact: true }).locator("visible=true");
  const n = await lab.count();
  const el = last ? lab.nth(n - 1) : lab.first();
  const input = el.locator('xpath=following::input[1]').first();
  await input.fill(value);
  await page.waitForTimeout(300);
}

/** Pick an option in an inline Select: tap its shown value/placeholder, then the option. */
async function pick(h, page, shown, option) {
  await h.tap(page, shown, 900);
  await h.tap(page, option, 1200);
}

/** Go back one screen: tap the header's ← (top-left; the topmost screen's header wins the hit). */
async function back(page, wait = 2500) {
  await page.mouse.click(26, 32);
  await page.waitForTimeout(wait);
}

/**
 * Uploads go to Google Drive, which a local run does not have. Answer `POST /files/<kind>`
 * with the fixture's pre-made StoredFile ids instead (fixtures/exam.ts FAKE_*), in order.
 */
async function fakeUploads(page, kind, ids, mime = "image/jpeg") {
  let i = 0;
  await page.context().route(new RegExp(`/files/${kind}(\\?|$)`), async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const fileId = ids[Math.min(i, ids.length - 1)];
    i += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fileId, originalName: `scan-${i}.jpg`, mime, sizeBytes: 120000 }),
    });
  });
}

/** A tiny JPEG on disk for the file pickers (the faked upload never reads it). */
function sampleFiles(n) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const jpg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "help-exam-"));
  return Array.from({ length: n }, (_, i) => {
    const f = path.join(dir, `scan-${i + 1}.jpg`);
    fs.writeFileSync(f, jpg);
    return f;
  });
}

/** Tap a button that opens the file picker and hand it `files`. */
async function chooseFiles(h, page, target, files, wait = 3000) {
  const el = await h.topmost(page, typeof target === "string" ? { text: target } : target, { scroll: true });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15000 }), el.click()]);
  await chooser.setFiles(files);
  await page.waitForTimeout(wait);
}

async function login(h, user) {
  return (await h.login(user, PASSWORD)).page;
}

module.exports = { PASSWORD, openItem, menuShots, go, fillAfter, fillDateAfter, pick, back, login, fakeUploads, sampleFiles, chooseFiles };
