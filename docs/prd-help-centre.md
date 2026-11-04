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
- **R3 — content is code.** Guides live in the repo (`server/help/guides/<id>.json`) and are reviewed in a PR.
  Bangla for everything the person reads (glossary + the owner's BN vocabulary). English only for codes.
- **R4 — screenshots are real prod screens with personal data replaced (D-#970).** See §5.
- **R5 — owner approves every batch** before it merges (D-#971). Claude drafts.

## 4. Data shape

```jsonc
// server/help/guides/leave-approve.json
{
  "id": "leave-approve",
  "category": "attendance_leave",          // fixed list in server/help/categories.json (bn titles)
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

Images are served by the server from `server/help/shots/` (not bundled, so the OTA stays small) under
an existing `/api/...` prefix. A new top-level prefix would need the VM Caddyfile `@api` matcher.

## 5. Capture script (HC-3) — prod screens, nobody's data

`server/scripts/help/capture.ts` (Playwright, run on the owner's machine, never in CI):

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
   `server/help/shots/` and committed. No prod image is committed without that look.

## 6. Slices

| Slice | What | Notes |
|---|---|---|
| **HC-1** | Server: guide registry loaded at boot + `myHelpGuides` (filtered per R2) + `helpGuideFeedback(id, helpful)` + image route; verifier `skills/_tools/verify_help_guides.mjs` (every `perms` key exists in the catalogue, every shot exists, steps ≤ 8, every step has a box, ids unique). Report-only list of catalogue actions with no guide yet. | If the catalogue CI scan needs a gate, register `help_centre:view` as SELF. |
| **HC-2** | App: drawer item, help home (search, categories, count, নতুন), guide page (box overlay + tap-to-highlight, এই পাতায় যান, হ্যাঁ/না), header ? on screens listed in `screens`. | OTA after promotion. "নতুন" = unlocked by a permission granted after the person's last Help open (stored per user, SELF). |
| **HC-3** | Capture script per §5. | Verify the mutation block on the dev site first. |
| **HC-4** | **Batch 1 — শিখনফল (objective tree / mastery).** | Owner ruling: first. See §7. |
| **HC-5** | Batch 2: ~10 teacher, ~8 office, ~5 guardian tasks (most-used first). | |

## 7. Batch 1 — শিখনফল guides (HC-4)

Draft list (one guide each; permission in brackets):

1. শিখনফল তালিকা ইমপোর্ট করা (`mastery:settings`)
2. পর্যালোচনার জন্য তালিকা বরাদ্দ করা (`mastery:settings`)
3. তালিকা পর্যালোচনা — একটি শিখনফল গ্রহণ / সংশোধন / বাদ দেওয়া (`mastery:review`)
4. একটি শিখনফল ভাগ করা বা দুটি মেলানো (`mastery:review`)
5. মন্তব্য লেখা ও উত্তর দেওয়া (`mastery:review`)
6. পর্যালোচনা জমা দেওয়া (`mastery:review`)
7. তালিকা লক করা (`mastery:settings`)
8. শিখনফল তালিকা ও পলিসি দেখা (`mastery:view`)
9. প্রশ্নভিত্তিক নম্বর তোলা (`mastery:enter_results`)

**Blocker for real screenshots:** on prod the mastery add-on is off and no tree is imported yet
(STATUS 2026-11-04). Guides 1–2 can be shot during the C1 Math pilot import itself. Guides 3–7 need
an assigned round, so they wait until Mahzabin's round is assigned. Guides 8–9 need the add-on
switched on for one pair.

## 8. Out of scope (v1)

Video, guides written by staff in the app, per-section guide variants, English-language guides.
