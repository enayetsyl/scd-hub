#!/usr/bin/env node
/**
 * Help-guide screenshot capture (prd-help-centre §5, HC-3, D-#970).
 *
 * Drives the web app with Playwright, takes a phone-size picture per guide row, and
 * writes into server/assets/help/:
 *   - shots/<guide>/<row>.jpg, a clean picture with no boxes drawn in;
 *   - the guide file's rows[].shot / size and steps[].box (the boxes are measured from
 *     the real button each step names). A guide whose rows are all filled stops being a
 *     draft.
 *
 * Two modes:
 *   LOCAL (default): a local stack on example data (scripts/help/fixture.ts). The spec
 *     may save things, because the walk itself sets up the screens.
 *   PROD (--prod, and only then a non-localhost --base): read-only by force. Every
 *     GraphQL mutation except sign-in / View-as and every non-GET REST call is ABORTED
 *     at the network layer, and the run fails on the first one. View-as CAN write, and
 *     the audit row would name the Principal. Person fields in every response (objects whose
 *     __typename looks like a person) are replaced with example values. A picture is
 *     REFUSED if any replaced value is still visible on the page. Credentials come from
 *     HELP_LOGIN / HELP_PASSWORD typed in the shell; they are never written anywhere.
 *
 * Usage (from server/):
 *   node scripts/help/capture.cjs --spec mastery [--base http://localhost:8233] [--only <guide-id>]
 *   HELP_LOGIN=… HELP_PASSWORD=… node scripts/help/capture.cjs --spec mastery --prod --base https://…
 * Needs playwright-core (PLAYWRIGHT_CORE=<path to its folder>, default: resolve normally)
 * and Chrome (CHROME=<exe>, default the Windows install path).
 * The owner looks at every picture before it is committed (D-#970/#971).
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const PROD = args.includes("--prod");
const BASE = opt("base", "http://localhost:8233");
const SPEC = opt("spec");
const ONLY = opt("only", null);
const OUT = path.resolve(__dirname, "../../assets/help");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

if (!SPEC) {
  console.error("usage: node scripts/help/capture.cjs --spec <name> [--base URL] [--prod] [--only guide-id]");
  process.exit(2);
}
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(BASE);
if (!local && !PROD) {
  console.error(`Refusing: ${BASE} is not local. Pass --prod to run read-only against it.`);
  process.exit(2);
}

/** Phone-size viewport: the pictures show the app as most staff and parents see it. */
const VIEWPORT = { width: 412, height: 860 };
const DSF = 2;

// ── Prod guard ───────────────────────────────────────────────────────────────
const ALLOWED_MUTATIONS = new Set(["StaffLogin", "GuardianLogin", "RefreshSession", "StartImpersonation", "EndImpersonation"]);
const PERSON_TYPE = /(User|Staff|Student|Guardian|Teacher|Person|Reviewer|Member|Applicant|Employee)/;
const PERSON_KEYS = new Set([
  "name", "nameBn", "nameEn", "fullName", "displayName", "phone", "email", "schoolId",
  "fatherName", "motherName", "guardianName", "photoUrl", "avatarUrl", "address",
]);
const realValues = new Set();
const fakeFor = new Map();
let blocked = 0;

function fake(key, value) {
  const k = `${key}:${value}`;
  if (!fakeFor.has(k)) {
    const n = fakeFor.size + 1;
    const v = /phone/i.test(key) ? `01XXXXXXX${String(n).padStart(2, "0")}`
      : /email/i.test(key) ? `example${n}@school.test`
      : /schoolId/.test(key) ? `E-${n}`
      : /photo|avatar/i.test(key) ? null
      : `উদাহরণ ${n}`;
    fakeFor.set(k, v);
  }
  return fakeFor.get(k);
}

function scrub(node) {
  if (Array.isArray(node)) return node.map(scrub);
  if (!node || typeof node !== "object") return node;
  const person = typeof node.__typename === "string" && PERSON_TYPE.test(node.__typename);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (person && PERSON_KEYS.has(k) && typeof v === "string" && v.trim()) {
      if (v.trim().length >= 3) realValues.add(v.trim());
      out[k] = fake(k, v);
    } else out[k] = scrub(v);
  }
  return out;
}

async function guard(context) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("/graphql") && req.method() === "POST") {
      let body = {};
      try { body = JSON.parse(req.postData() || "{}"); } catch { /* not JSON */ }
      const q = String(body.query || "").replace(/#[^\n]*/g, "").trim();
      if (/^mutation\b/.test(q) && !ALLOWED_MUTATIONS.has(body.operationName)) {
        blocked += 1;
        console.error(`BLOCKED save: ${body.operationName || "(unnamed mutation)"}`);
        return route.abort("blockedbyclient");
      }
      const res = await route.fetch();
      let json;
      try { json = await res.json(); } catch { return route.fulfill({ response: res }); }
      return route.fulfill({ response: res, json: scrub(json) });
    }
    if (req.method() !== "GET" && req.method() !== "OPTIONS" && !url.startsWith(BASE)) {
      blocked += 1;
      console.error(`BLOCKED ${req.method()} ${url}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

// ── Locating the button a step names ─────────────────────────────────────────
// Bangla ড় ঢ় য় can be one code point or two (ড + ়), and the app's labels use both. An exact
// string match then fails silently, so a { text } with two forms becomes an anchored pattern
// that accepts either.
// (NFC does not help: these three are composition exclusions, so both normal forms decompose.)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUKTA_PAIRS = [["ড়", "ড়"], ["ঢ়", "ঢ়"], ["য়", "য়"]];
const composed = (t) => NUKTA_PAIRS.reduce((s, [one, two]) => s.split(two).join(one), t);
const decomposed = (t) => NUKTA_PAIRS.reduce((s, [one, two]) => s.split(one).join(two), t);
const hasTwoForms = (t) => typeof t === "string" && composed(t) !== decomposed(t);
function textPattern(target) {
  if (target.re) return new RegExp(target.re);
  if (!hasTwoForms(target.text)) return target.text;
  const forms = [...new Set([composed(target.text), decomposed(target.text)])].map(escapeRe).join("|");
  return target.exact === false ? new RegExp(`(${forms})`) : new RegExp(`^\\s*(${forms})\\s*$`);
}

/** The visible match that is really on top (hidden stack screens stay mounted). */
async function topmost(page, target, { scroll }) {
  // A target is { text } (exact), { re } (pattern), { placeholder } or { css }; `last` prefers
  // the last match, `minY` skips matches above that line (e.g. the header title).
  const loc = target.css
    ? page.locator(target.css)
    : target.placeholder
      ? page.getByPlaceholder(target.placeholder, { exact: target.exact ?? false })
      : page.getByText(textPattern(target), { exact: target.re ? undefined : (target.exact ?? true) && !hasTwoForms(target.text) });
  const all = loc.locator("visible=true");
  const n = await all.count();
  const order = target.last ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
  for (const i of order) {
    const el = all.nth(i);
    if (scroll) await el.evaluate((e) => e.scrollIntoView({ block: "center" })).catch(() => {});
    const onTop = await el.evaluate((e, minY) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top < minY) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (e === hit || e.contains(hit) || hit.contains(e));
    }, target.minY ?? -1e9);
    if (onTop) return el;
  }
  // Never echo a prod page: it holds real names.
  const seen = PROD ? "(hidden on prod)" : (await page.locator("body").innerText()).slice(0, 1200).split("\n").join(" | ");
  throw new Error(`step target not found on top: ${JSON.stringify(target)}\n  page text: ${seen}`);
}

const results = {};

async function shot(page, guideId, rowIndex, targets, { anchor } = {}) {
  if (ONLY && ONLY !== guideId) return;
  // A guide removed from the repo (e.g. a duplicate) may still be named by an older spec.
  if (!fs.existsSync(path.join(OUT, "guides", `${guideId}.json`))) {
    console.log(`skip ${guideId} row ${rowIndex + 1}: no guide file`);
    return;
  }
  await page.waitForTimeout(800);
  if (anchor) {
    const a = await topmost(page, anchor, { scroll: false });
    // Anchor near the top, with room above it so its own box and number are not cut off.
    await a.evaluate((e) => {
      e.scrollIntoView({ block: "start" });
      for (let p = e.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
          p.scrollBy(0, -70);
          break;
        }
      }
    });
    await page.waitForTimeout(300);
  }
  const measure = async () => {
    const out = [];
    for (let i = 0; i < targets.length; i++) {
      const el = await topmost(page, targets[i], { scroll: i === 0 && !anchor });
      const b = await el.boundingBox();
      if (!b) throw new Error(`${guideId} row ${rowIndex + 1}: no box for ${JSON.stringify(targets[i])}`);
      out.push({ el, b });
    }
    return out;
  };
  let found = await measure();
  // Near the end of a page the anchor's room-above can push the last button off the bottom:
  // scroll down just enough, if the first target still stays on screen.
  const lowest = Math.max(...found.map(({ b }) => b.y + b.height));
  if (lowest > VIEWPORT.height - 4) {
    const delta = Math.ceil(lowest - VIEWPORT.height + 12);
    if (found[0].b.y - delta >= 0) {
      await found[0].el.evaluate((e, d) => {
        for (let p = e.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return void p.scrollBy(0, d);
        }
        window.scrollBy(0, d);
      }, delta);
      await page.waitForTimeout(300);
      found = await measure();
    }
  }
  const boxes = [];
  for (const [i, { b }] of found.entries()) {
    if (b.y < 0 || b.y + b.height > VIEWPORT.height + 1) {
      throw new Error(`${guideId} row ${rowIndex + 1}: step ${i + 1} is off screen; split the row or set an anchor`);
    }
    const pad = targets[i].pad ?? 4;
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    const w = Math.min(VIEWPORT.width - x, b.width + 2 * pad), h = Math.min(VIEWPORT.height - y, b.height + 2 * pad);
    boxes.push([x / VIEWPORT.width, y / VIEWPORT.height, w / VIEWPORT.width, h / VIEWPORT.height].map((v) => Math.round(v * 10000) / 10000));
  }
  if (PROD) {
    const text = await page.locator("body").innerText();
    const leak = [...realValues].find((v) => text.includes(v));
    if (leak) throw new Error(`${guideId} row ${rowIndex + 1}: a real name/number is still visible; picture refused`);
  }
  const rel = `${guideId}/${rowIndex + 1}.jpg`;
  fs.mkdirSync(path.join(OUT, "shots", guideId), { recursive: true });
  await page.screenshot({ path: path.join(OUT, "shots", rel), type: "jpeg", quality: 82 });
  (results[guideId] ??= [])[rowIndex] = { shot: rel, size: [VIEWPORT.width * DSF, VIEWPORT.height * DSF], boxes };
  console.log(`shot ${rel} (${boxes.length} boxes)`);
}

function writeGuides() {
  for (const [id, rows] of Object.entries(results)) {
    const file = path.join(OUT, "guides", `${id}.json`);
    const g = JSON.parse(fs.readFileSync(file, "utf8"));
    rows.forEach((r, i) => {
      if (!r) return;
      const row = g.rows[i];
      if (!row) throw new Error(`${id}: the spec shot row ${i + 1}, the guide has ${g.rows.length}`);
      if (row.steps.length !== r.boxes.length) throw new Error(`${id} row ${i + 1}: ${row.steps.length} steps but ${r.boxes.length} boxes`);
      row.shot = r.shot;
      row.size = r.size;
      row.steps.forEach((s, k) => (s.box = r.boxes[k]));
    });
    if (g.rows.every((row) => row.shot && row.steps.every((s) => s.box))) delete g.draft;
    fs.writeFileSync(file, JSON.stringify(g, null, 2) + "\n");
    console.log(`guide ${id}: ${g.draft ? "still a draft" : "complete"}`);
  }
}

// ── Session helpers given to a spec ──────────────────────────────────────────
async function login(browser, user, password) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF, locale: "bn-BD" });
  if (PROD) await guard(context);
  await context.addInitScript(() => {
    try { localStorage.removeItem("scd_nav_state_v2"); } catch { /* private mode */ }
    // The web app first asks to switch notifications on; a headless browser cannot answer.
    try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch { /* no Notification */ }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGEERROR", String(e).slice(0, 300)));
  await page.goto(BASE, { waitUntil: "load", timeout: 300000 });
  await page.getByPlaceholder("you@school.edu / 01XXXXXXXXX").fill(user, { timeout: 300000 });
  await page.locator('input[type="password"]').fill(password);
  await page.getByText("লগইন", { exact: true }).last().click();
  await page.waitForTimeout(6000);
  return { context, page };
}

async function tap(page, target, wait = 2000) {
  const el = await topmost(page, typeof target === "string" ? { text: target } : target, { scroll: true });
  await el.click();
  await page.waitForTimeout(wait);
}

async function openMenu(page) {
  await (await topmost(page, { text: "☰" }, { scroll: false })).click();
  await page.waitForTimeout(1200);
}

(async () => {
  const spec = require(path.resolve(__dirname, "specs", `${SPEC}.cjs`));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    await spec.run({
      PROD,
      login: (u, p) => login(browser, u ?? process.env.HELP_LOGIN, p ?? process.env.HELP_PASSWORD),
      shot,
      tap,
      openMenu,
      topmost,
      repoRoot: path.resolve(__dirname, "../../.."),
    });
    writeGuides();
  } finally {
    await browser.close();
  }
  if (blocked) {
    console.error(`${blocked} save(s) were blocked; fix the spec so it never saves on prod.`);
    process.exit(1);
  }
  console.log("CAPTURE DONE");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
