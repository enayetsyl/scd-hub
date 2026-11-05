# PRD — Help centre (সাহায্য ও নির্দেশিকা)

Status: **PLANNED 2026-11-04** (D-#968–#972). Owner approved the mockup:
https://claude.ai/artifact/Nu1bwoyPWsxDaWke1hJAwJ

## 1. Problem

The app is now large. Existing and new staff, and guardians, cannot find every
feature or remember how to do each small task. The owner wants something like a
vendor knowledge base: search, categories, and **one short guide per small task**
with real screens, red boxes numbered ১, ২, ৩, and Bangla steps using the same
numbers. Each person sees **only the guides for what they may do**, and the list
follows their permissions as they change.

## 2. What the person sees

1. **Drawer → ❓ সাহায্য ও নির্দেশিকা** (bottom of the drawer, for every login).
2. **Help home:** search box ("আপনাকে কীভাবে সাহায্য করতে পারি?"), the line
   "আপনার জন্য Nটি নির্দেশিকা", then category cards. Each card shows its guide count and its guide
   titles. Search matches title, keywords and step text, but only across the person's own guides.
   No hits → "এই শব্দে আপনার জন্য কোনো নির্দেশিকা নেই".
3. **Guide page:** category, title, why you see it ("আপনার 'ছুটি মঞ্জুর বা নামঞ্জুর করা'
   অনুমতি আছে বলে দেখছেন"), one italic intro line, then one row per screen: the steps on the left
   and the screenshot with numbered red boxes on the right. On a phone the screenshot sits under the steps.
   Tapping a step highlights its box. Footer: keywords, **কাজে লেগেছে? হ্যাঁ / না**, **এই পাতায় যান →**
   (deep-links to the real screen).
4. **"নতুন" badge** on a guide that a newly granted permission unlocked (D-#972).
5. **? in a screen's header** (screens that have guides) opens that screen's guides.

## 3. Rules

- **R1 — one guide = one small task.** A guide has 1–4 screen rows and at most 8 steps in total.
  One red box per step, numbered in order across the whole guide.
- **R2 — who sees a guide (D-#969).** Each guide declares exactly one audience:
  - `perms: ["feature:action", …]`: shown when the person holds **any** of them (effective
    permissions, the same set `myPermissions` returns). Every key must exist in
    `shared/permissionCatalogue.ts`.
  - `audience: "ALL_STAFF"`: SELF actions every staff member has (own leave, own attendance).
  - `audience: "GUARDIAN"`: every guardian login.
  The **server** filters. The app never receives a guide the person may not see. Grant → the guide
  appears on the next Help open. Revoke → it is gone. View-as sees the borrowed person's guides.
- **R3 — content is code.** Guides live in the repo (`server/assets/help/guides/<id>.json`) and are reviewed in a PR.
  Bangla for everything the person reads (glossary + the owner's BN vocabulary). English only for codes.
- **R4 — screenshots are real prod screens with personal data replaced (D-#970).** See §5.
- **R5 — owner approves every batch** before it merges (D-#971). Claude drafts.

## 4. Data shape

```jsonc
// server/assets/help/guides/leave-approve.json
{
  "id": "leave-approve",
  "category": "attendance_leave",          // fixed list in server/assets/help/categories.json (bn titles)
  "title": "ছুটি মঞ্জুর বা নামঞ্জুর করা",
  "intro": "শিক্ষক ও কর্মীদের ছুটির আবেদনের সিদ্ধান্ত দিতে এই ধাপগুলো অনুসরণ করুন।",
  "keywords": ["ছুটি", "মঞ্জুর", "নামঞ্জুর"],
  "perms": ["leave:approve"],               // or "audience": "ALL_STAFF" | "GUARDIAN"
  "screens": ["HrTab/LeaveApprovals"],      // which screens' ? opens this guide
  "goTo": { "route": "HrTab", "screen": "LeaveApprovals" },
  "rows": [
    { "heading": "সিদ্ধান্ত দেওয়া",
      "shot": "leave-approve/1.png",           // raw screenshot, no marks drawn in
      "steps": [
        { "text": "<b>অপেক্ষমাণ</b> তালিকা খুলুন।",   "box": [x, y, w, h] },
        { "text": "আবেদন ঠিক থাকলে <b>মঞ্জুর</b> চাপুন।", "box": [x, y, w, h] }
      ] }
  ]
}
```

Boxes are stored as coordinates and the **app draws the red boxes**. The screenshot stays clean, the
numbers stay sharp at any size, and a tapped step can light up its own box. Step text is a tiny
markup subset (`<b>` only). The app appends the step number to the first bold word: "মঞ্জুর (২)".

Images are served by the server from `server/assets/help/shots/` (not bundled, so the OTA stays small) at
`GET /files/help/<guide>/<file>`. That sits under the existing `/files` prefix, so the VM Caddyfile `@api`
matcher needs no change. Login is required, and a picture is served only when it belongs to a guide the caller may see.

## 5. Capture script (HC-3) — prod screens, nobody's data

`server/scripts/help/capture.cjs --spec <name>` (Playwright, run on a laptop, never in CI). A spec in
`server/scripts/help/specs/` walks the screens and names the element behind each step.

**Two modes (D-#992).** LOCAL (default) drives a local stack on example data from
`server/scripts/help/fixture.ts`. That script refuses any database that is not a local in-memory
one, and every name in it is "উদাহরণ …". A local spec may save, because a walk like the
শিখনফল review has to import, assign and submit before the later screens exist. PROD (`--prod`) is
required for any non-localhost address and applies rules 1–7 below:

1. **Login:** the Principal's credentials come from env vars typed by the owner at run time. Never
   in `.env`, never committed, never logged.
2. **Per guide:** start **view-as** for a chosen account (teacher / office / guardian), go to the
   screen, and fill fields with example text where a step needs it.
3. **Never write (hard guard).** View-as can save, and the audit row would name the Principal. So
   Playwright blocks, at the network layer, every GraphQL operation that is a `mutation` (except
   login and start/end view-as) and every non-GET REST call. Any blocked call fails the guide
   loudly; it does not retry.
4. **Replace personal data before the picture:** intercept GraphQL responses and swap
   names (bn/en), phone numbers, school ids, photos/avatars, addresses and guardian names for fixed
   example values ("উদাহরণ শিক্ষক", "আরিফ হোসেন", 01XXXXXXXXX, …). Use a deterministic map, so the
   same real person gets the same fake name on every screen of one guide.
5. **Fail closed:** before each shot, scan the page's visible text for every real name, phone number
   and id seen in this run's responses. Any hit means no picture for that guide, and it is reported.
6. **Boxes:** each step names a selector (`testID` / text). The script records that element's box
   into the guide JSON.
7. **Output** goes to a local folder. The owner looks at each batch (D-#971) before it is copied into
   `server/assets/help/shots/` and committed. No prod image is committed without that look.

## 6. Slices

| Slice | What | Notes |
|---|---|---|
| **HC-1** | Server: guide registry loaded at boot + `myHelpGuides` (filtered per R2) + `helpGuideFeedback(id, helpful)` + image route; verifier `skills/_tools/verify_help_guides.mjs` (every `perms` key exists in the catalogue, every shot exists, steps ≤ 8, every step has a box, ids unique). Report-only list of catalogue actions with no guide yet. | If the catalogue CI scan needs a gate, register `help_centre:view` as SELF. |
| **HC-2** | App: drawer item, help home (search, categories, count, নতুন), guide page (box overlay + tap-to-highlight, এই পাতায় যান, হ্যাঁ/না), header ? on screens listed in `screens`. | OTA after promotion. "নতুন" = unlocked by a permission granted after the person's last Help open (stored per user, SELF). |
| **HC-3** | Capture script per §5. | Verify the mutation block on the dev site first. |
| **HC-4** | **Batch 1 — শিখনফল (objective tree / mastery).** | Owner ruling: first. See §7. |
| **HC-5** | Batch 2: ~10 teacher, ~8 office, ~5 guardian tasks (most-used first). | |

## 7. Batch 1 — শিখনফল guides (HC-4)

Built 2026-11-05: 8 guides in `server/assets/help/guides/mastery-*.json`, shown in this order
(`order`), with permissions in brackets:

1. শিখনফল তালিকা ইমপোর্ট করা (`mastery:settings`)
2. পর্যালোচক বরাদ্দ করা (`mastery:settings`)
3. শিখনফল গ্রহণ বা বাদ দেওয়া (`mastery:review`)
4. শিখনফল সম্পাদনা, ভাগ বা মেলানো (`mastery:review`)
5. পর্যালোচনায় মন্তব্য লেখা ও মীমাংসা (`mastery:review` | `mastery:settings`)
6. পর্যালোচনা জমা দেওয়া (`mastery:review`)
7. শিখনফল তালিকা চূড়ান্ত করা (`mastery:settings`)
8. শিখনফল তালিকা দেখা (`mastery:view`)

The pictures come from a LOCAL run (spec `mastery`) that imports the real C1 Math tree
(`docs/mastery/objective-tree/C1_MATH.tree.json`) and walks import → assign → review → comment →
submit → lock as `principal@help.test` / `reviewer@help.test`. On prod there was no tree or round
yet, and the Principal's password is the owner's (D-#992). `mastery-catalogue.cjs` is read-only and
can be re-run with `--prod` once the pilot list is locked there.

Moved to the next batch: প্রশ্নভিত্তিক নম্বর তোলা (`mastery:enter_results`). It needs a paper,
a শাখা and students; the fixture would have to grow for it.

## 8. Out of scope (v1)

Video, guides written by staff in the app, per-section guide variants, English-language guides.
