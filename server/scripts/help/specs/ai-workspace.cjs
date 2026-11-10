/**
 * Capture spec — the AI Workspace (এআই কর্মক্ষেত্র, docs/prd-ai-workspace.md, D-#1240–#1257).
 *
 * LOCAL ONLY. The data comes from fixtures/ai-workspace.ts (no AI key, no AI call); the walk
 * only opens screens, fills forms it never submits, and asks for a cost estimate and a send
 * preview (both read-only).
 *
 * One run (from server/, PowerShell; ports from the README, pick free ones):
 *   node scripts/help/mem.cjs 27940
 *   $env:MONGODB_URI='mongodb://127.0.0.1:27940/hc'; npx tsx scripts/help/fixtures/ai-workspace.ts --reset
 *   $env:PORT='4340'; $env:TZ='Asia/Dhaka'; npx tsx scripts/help/fake-drive-server.ts
 *   node scripts/help/serve-web.cjs --dir C:/w/aiws-web --port 8340 --api 4340
 *   node scripts/help/capture.cjs --spec ai-workspace --base http://localhost:8340
 */
const PASSWORD = "Help@123";
const PROJECT = "গল্পের বই — বর্ষার দিন";

async function back(h, page) {
  await h.tap(page, { css: '[aria-label="Go back"]' }, 2000);
}

/** Type into the input that follows a field's label (the app's Field shows the label above it). */
async function fill(h, page, label, value) {
  const l = await h.topmost(page, { text: label }, { scroll: true });
  await l.locator("xpath=following::*[self::input or self::textarea][1]").fill(value);
  await page.waitForTimeout(400);
}

/** Drawer → এআই কর্মক্ষেত্র, then back to the home list (the drawer keeps the tab's stack). */
async function openHome(h, page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await h.openMenu(page);
  await h.tap(page, "এআই কর্মক্ষেত্র", 3000);
  for (let i = 0; i < 5; i++) {
    const home = await h.topmost(page, { text: "নতুন প্রকল্প" }, { scroll: false }).then(() => true, () => false);
    if (home) return;
    await back(h, page);
  }
}

async function openProject(h, page, tab) {
  await openHome(h, page);
  await h.tap(page, PROJECT, 3500);
  if (tab) await h.tap(page, { text: tab, minY: 60 }, 2500);
}

exports.run = async (h) => {
  const shot = h.shot;
  h = { ...h, shot: async (page, id, row, targets, opts) => {
    if (opts && opts.anchor) {
      await h.topmost(page, opts.anchor, { scroll: true });
      await page.waitForTimeout(400);
    }
    return shot(page, id, row, targets, opts);
  } };
  const { context, page } = await h.login("principal@help.test", PASSWORD);

  // ── Projects ──
  await openHome(h, page);
  await h.tap(page, "নতুন প্রকল্প", 2500);
  await fill(h, page, "প্রকল্পের নাম", "গল্পের বই — শীতের ছুটি");
  await h.shot(page, "ai-workspace-projects", 0, [{ text: "নাম সুরক্ষা" }, { text: "প্রকল্প তৈরি করুন" }]);
  await back(h, page);

  await openProject(h, page, "নির্দেশনা");
  await h.shot(page, "ai-workspace-projects", 1, [{ text: "নতুন সংস্করণ সংরক্ষণ করুন" }]);
  await h.tap(page, { text: "ফাইল", minY: 60 }, 2500);
  await h.shot(page, "ai-workspace-projects", 2, [{ text: "প্রতি বার্তার প্রসঙ্গ" }, { text: "ফাইল যোগ করুন" }, { text: "লেখা দেখুন" }]);
  await h.tap(page, { text: "সেটিং", minY: 60 }, 2500);
  await h.shot(page, "ai-workspace-projects", 3, [{ text: "সদস্য", minY: 60 }, { text: "সেটিং", minY: 60 }]);

  // ── Chat ──
  await h.tap(page, { text: "আলাপ", minY: 60 }, 2500);
  await h.shot(page, "ai-workspace-chat", 0, [{ text: "নতুন আলাপ" }]);
  await h.tap(page, "অধ্যায় ১-এর খসড়া", 3500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await h.shot(page, "ai-workspace-chat", 1, [{ re: "^এখন (পিক সময়|কম দামের সময়)" }, { re: "^প্রসঙ্গ:" }]);
  await h.shot(page, "ai-workspace-drafts", 0, [{ text: "খসড়া হিসেবে রাখুন" }], { anchor: { text: "খসড়া হিসেবে রাখুন" } });
  await h.shot(page, "ai-workspace-chat", 2, [{ text: "মডেল" }, { text: "কখন চলবে" }, { text: "পাঠান" }, { text: "এই আলাপে ফাইল যোগ করুন" }], { anchor: { text: "মডেল" } });
  await back(h, page);

  // ── Drafts ──
  await h.tap(page, { text: "খসড়া", minY: 60 }, 2500);
  await h.shot(page, "ai-workspace-claude", 2, [{ text: "Claude থেকে" }]);
  await h.tap(page, "অধ্যায় ১ — মেঘের ছাতা", 3500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await h.shot(page, "ai-workspace-drafts", 1, [{ text: "সম্পাদনা করুন" }, { text: "অনুমোদন দিন" }, { text: "Word ফাইল" }, { text: "এআই দিয়ে সংশোধন" }]);
  await h.shot(page, "ai-workspace-drafts", 2, [{ text: "পাইলট মূল্যায়ন" }], { anchor: { text: "পাইলট মূল্যায়ন" } });
  await back(h, page);
  await h.tap(page, "বাংলা বই — পাঠ ৩ সহজ করা", 3500);
  await h.tap(page, "যাচাই করে দেখুন", 3000);
  await h.shot(page, "ai-workspace-drafts", 3, [{ text: "যাচাই করে দেখুন" }, { text: "নিশ্চিত — পাঠান" }], { anchor: { text: "আসল জায়গায় পাঠানো" } });
  await back(h, page);

  // ── Batch jobs ──
  await h.tap(page, { text: "ব্যাচ কাজ", minY: 60 }, 2500);
  await h.tap(page, "নতুন ব্যাচ কাজ", 2500);
  await fill(h, page, "কাজের নাম", "বাকি অধ্যায়গুলো");
  await fill(h, page, "নির্দেশ ({{item}} যেখানে প্রতিটি বিষয় বসবে)", "গল্পের একটি অধ্যায় লেখো: {{item}}");
  await fill(h, page, "বিষয়গুলো (প্রতি লাইনে একটি)", "অধ্যায় ২ — নৌকার দৌড়\nঅধ্যায় ৩ — ঝড়ের রাত\nঅধ্যায় ৪ — বটগাছের গল্প");
  await h.shot(page, "ai-workspace-jobs", 0, [{ text: "বিষয়গুলো (প্রতি লাইনে একটি)" }, { text: "খরচের হিসাব দেখুন" }], { anchor: { text: "বিষয়গুলো (প্রতি লাইনে একটি)" } });
  await h.tap(page, "খরচের হিসাব দেখুন", 5000);
  await h.shot(page, "ai-workspace-jobs", 1, [{ text: "কখন চলবে", last: true }, { text: "কাজ শুরু করুন" }], { anchor: { text: "খরচের হিসাব দেখুন" } });
  await back(h, page);
  await h.tap(page, "বাকি পাঁচ অধ্যায়", 3500);
  await h.shot(page, "ai-workspace-jobs", 2, [{ text: "খসড়া খুলুন" }, { text: "বাকিগুলো বাতিল করুন" }]);

  // ── Claude connection (home) ──
  await openHome(h, page);
  // The card shows this page's own origin; the picture shows the school's address instead.
  await page.evaluate((origin) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue.includes(origin)) n.nodeValue = n.nodeValue.split(origin).join("https://scdhub.shafayet.me");
    }
  }, new URL(page.url()).origin);
  await h.shot(page, "ai-workspace-claude", 0, [{ re: "^সংযোগের ঠিকানা" }, { re: "^Claude Code:" }], { anchor: { text: "Claude সংযোগ" } });
  await h.shot(page, "ai-workspace-claude", 3, [{ text: "সংযোগ বন্ধ করুন" }], { anchor: { text: "Claude সংযোগ" } });

  // ── AI usage report ──
  await page.evaluate(() => window.scrollTo(0, 0));
  await h.openMenu(page);
  await h.tap(page, "রিপোর্ট", 1500);
  await h.tap(page, "এআই ব্যবহার ও মন্তব্যের মান", 4000);
  await h.shot(page, "ai-workspace-jobs", 3, [{ text: "এআই কর্মক্ষেত্র — প্রকল্প অনুযায়ী" }], { anchor: { text: "এআই কর্মক্ষেত্র — প্রকল্প অনুযায়ী" } });

  // ── The sign-in page Claude opens (served by the API, outside the app) ──
  const auth = await context.newPage();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "claude-ai-example",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "help",
    scope: "mcp",
  });
  await auth.goto(`${page.url().split("/").slice(0, 3).join("/")}/oauth/authorize?${q}`, { waitUntil: "load" });
  await h.shot(auth, "ai-workspace-claude", 1, [{ text: "অনুমতি দিন / Allow" }]);
  await auth.close();
};
