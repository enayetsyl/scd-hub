# PRD — English Drive materials: import, teacher library, print

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** a **separate import section** for the English Drive curriculum documents authored in
Claude Desktop (block file + its six derivatives), a **teacher-facing library** scoped to the
English teachers of each class, **in-app viewing + PDF export**, and **send-to-print** through the
existing print queue. **English only. Markdown in. Principal/Office upload. Guardians never see it.
No tracker linking** (explicitly dropped by the owner). Operational plane; no corpus path; the
firewall test is unaffected.

This is the build contract; the decision is authoritative in `DECISIONS.md` (D-#344). If they
disagree, the decision row wins — fix this file.

---

## 1. Goal
The English Drive produces, per class and block, a family of markdown documents in Claude Desktop
(the owner's `English Drive` folder): the full **block file** and shorter derivatives — **TN**
(teacher note, the short version of the block), **CW** (classwork), **HW** (homework), **PT**
(practice test), **AS** (assignment), and **clue cards**. Today they live on the laptop; teachers
get them ad hoc. This module makes the app the delivery layer: Principal/Office upload the `.md`
files, the right teachers see the right class's set, read them in-app, export the existing-style
PDF, and file print requests — all without leaving the app.

## 2. Decisions locked by the owner (2026-07-21)
| # | Decision |
|---|---|
| 1 | Document kinds are exactly: **BLOCK, TN, CW, HW, PT, AS, CLUE** — nothing else (vocab xlsx etc. out of scope). |
| 2 | **English only.** Built as the English Drive module — no subject axis in v1. |
| 3 | Input format is **markdown** (`.md`) only. |
| 4 | Upload metadata is **auto-parsed from the filename with a manual override** always shown. |
| 5 | **Newer version replaces older** — teachers only ever see the latest of a (class, block, kind). |
| 6 | Visibility: the class's **English subject teachers**; **Principal/Office see all classes; guardians never.** |
| 7 | Print rides the **existing print queue** (colour/sides/copies, PRINTED/DELIVERED logging). |
| 8 | PDF uses the **existing app PDF style** (clean A4 from the rendered markdown; no Word pixel-matching). |
| 9 | Entry point is a **new drawer item** (Academics group): "ইংরেজি ড্রাইভ / English Drive"; upload lives inside it, gated to Principal/Office. |
| 10 | **No CW/HW/PT→tracker linking** in any slice (owner: "forget about link"). |

## 3. Data model (app-native, NO wire twin)
`EnglishDriveDoc` (server, trackers-adjacent module `englishDrive`):
`{ classLevel (1..5, C-prefix), blockNumber (null for AS — week-scoped, D-#346; null for PT —
uses blockNumbers instead), blockNumbers (int[], D-#347 — the blocks a PT covers; [] for every
other kind), kind ∈ {BLOCK,TN,CW,HW,PT,AS,CLUE}, seq (int ≥ 1, D-#345), title, version (int),
contentMd (string, ≤ 1 MB), uploadedBy, uploadedAt, replacedAt? }`
- The markdown is stored **in the document** (class-note precedent) — no file-storage round trip;
  render + PDF + print all derive from `contentMd`.
- **`seq` (D-#345, testing finding 2026-07-21):** a block holds SEVERAL documents of one kind —
  `C1B03_HW1..HW4` are four different homework sheets, not versions. The identity is therefore
  (classLevel, blockNumber, kind, **seq**); single-doc kinds default to seq 1.
- **Replace semantics:** upload of an existing (classLevel, blockNumber, kind, seq) stamps the old
  row `replacedAt` and inserts the new one; reads always take the unreplaced rows. History stays in
  the collection (audit), but no UI lists it in v1.
- **`blockNumbers` (D-#347):** a **PT covers one or more blocks** — it is stored block-less
  (`blockNumber = null`) and carries `blockNumbers = [3,4,5]`. Its replace identity stays
  (classLevel, kind=PT, seq) — two practice tests differ by `seq`, so `blockNumbers` is purely
  where the PT SURFACES, never part of the key. Every other kind keeps `blockNumbers = []`.
- Kinds are a **module-local enum** (HW_NIL_REASONS / VideoReview precedent): labels live in the
  app + module, **no shared-vocab twin, no verifier change**.

## 4. Filename convention + parser
Recommended generator convention (Claude Desktop side):
`C{class}_ENG_B{block}_{KIND}_v{version}.md` → e.g. `C3_ENG_B01_TN_v2.md`.
The parser is **lenient** — separators are NOT required (the real corpus mixes `C1B03CW1.md`,
`C1B03_HW4.md`, `GrammarBlock3…` — D-#345): `C[1-5]` (not followed by a digit) → class; `B(\d+)` or
`Block(\d+)` → block; a kind keyword (`BLOCK|TN|CW|HW|PT|AS|CLUE`, case-insensitive, with digits
glued to the kind → **seq**, e.g. `HW4` → HW seq 4; also maps `GrammarBlock…` → BLOCK, `Clue` →
CLUE); full-word kinds (`Assignment`/`Homework`/`Classwork`/`PracticeTest`/`TeacherNote`,
D-#346); a standalone `W(\d+)` → seq when no digits are glued to the kind (Assignment_W3 → AS
seq 3); a separated `v(\d+)` → version. For a **PT**, block RANGES/LISTS map to `blockNumbers`
(`B03-05` → [3,4,5]; `B3,4,5` or repeated `_B` tokens → the list; a single `B03` → [3]) (D-#347).
Whatever fails to parse leaves its form field empty; the upload form always shows the parsed values
**prefilled and editable** (override rule, owner #4) — for a PT the single block field becomes a
multi-block "covers blocks" input. Title defaults to the first `# heading` of the md, editable. The
upload batch refuses two staged files claiming the same (class, block, kind, seq) — the second would
silently replace the first.

## 5. Permissions & visibility (compose existing — no new permission)
- **Upload / replace:** `roster:manage` (the house Principal/Office gate).
- **Teacher read:** an active TEACHER sees class N's set when they have an **ENG involvement in any
  section of class N** — resolved server-side from the same routine/scope machinery the trackers use
  (`allowedSubjectCodesForSection` pattern). Principal/Office read all. GUARDIAN: no resolver path.
- Uploads and replaces write **audit rows** (ADR-008): `ENGLISH_DRIVE_UPLOADED` / `…_REPLACED`.

## 6. Slices
### ED-1 — model + import + library + viewer/PDF (build first)
- Server: model, `englishDriveDocs(classLevel?)` (scoped read), `uploadEnglishDriveDoc` (create/replace,
  roster:manage), audit rows, Jest coverage (scope matrix: ENG teacher of C3 sees C3 not C4; guardian
  denied; replace hides old).
- App: drawer item "ইংরেজি ড্রাইভ" (teachers with access + P/O); library screen — class picker (P/O)
  or the teacher's classes, blocks as collapsible groups, kind-labelled rows (BN labels: ব্লক ফাইল,
  শিক্ষক নোট, ক্লাসওয়ার্ক, বাড়ির কাজ, প্র্যাকটিস টেস্ট, অ্যাসাইনমেন্ট, ক্লু কার্ড); doc screen renders
  the markdown (existing md renderer) + **PDF তৈরি করুন** (existing PDF style).
- Import UI (inside the drawer section, P/O only): multi-file `.md` picker + **drag-and-drop**
  (UploadDropZone), per-file parsed-metadata form (prefilled, editable), conflict notice when it will
  replace ("v5 → v7 প্রতিস্থাপন হবে"), upload summary.
### ED-2 — send to print
- Doc screen gains "প্রিন্টে পাঠান" (teacher + P/O): renders the PDF and files it through the existing
  `createRequest` path (colour/sides/copies form) so the office queue, PRINTED/DELIVERED logging and
  read-gates stay untouched.
### ED-3a — PT multi-block linking (D-#347)
- Server: `blockNumbers: number[]` on the model (default []); `uploadEnglishDriveDoc` accepts it; PT
  stores its covered blocks with `blockNumber = null`; PDF/print stamp lists the blocks
  (`C1_PT_B03-05_v2`). Jest: PT surfaces under each covered block + the section; range/list parse;
  PT replace keyed on seq not blocks.
- App: parser reads PT block ranges/lists; the PT upload row shows a multi-block "covers blocks"
  field (prefilled, editable); the library lists a PT **under every block it covers** (labelled
  "প্র্যাকটিস টেস্ট · ব্লক ৩–৫") **and** in a dedicated bottom **"প্র্যাকটিস টেস্ট"** section.
### ED-3b — related-docs strip (D-#347)
- Doc screen shows tappable chips for the same block's other materials (a block doc → that block's
  BLOCK/TN/CW/HW/CLUE + any PT covering it; a PT → the union of its blocks' docs) → one tap navigates
  to the sibling. Computed **client-side** from the already-scoped `englishDriveDocs(classLevel)` read
  — no new resolver, no new permission.

## 7. Acceptance criteria
1. Principal drops `C3_ENG_B01_TN_v2.md` + 6 siblings on the import screen → form shows class ৩,
   block ১, kind, v২ prefilled → upload → all appear under Class 3 · Block 1.
2. Re-uploading `…TN_v3.md` replaces v2 — the library shows exactly one TN for (C3, B1), version 3.
3. An English teacher of a Class-3 section sees the Class-3 library (and not Class 4's); a
   non-English teacher of Class 3 sees nothing; a guardian has no path to any of it.
4. Opening the TN renders the markdown; "PDF তৈরি করুন" downloads the existing-style A4 PDF.
5. "প্রিন্টে পাঠান" files a print request that behaves exactly like today's print queue rows.
6. Every upload/replace appears in the audit log with actor + (class, block, kind, version).
7. Firewall + full server Jest stay green; no shared-vocab or import-envelope change is needed.
8. (ED-3a) A PT uploaded as covering blocks 3–5 appears inside Block 3, 4 and 5's groups (labelled
   with its range) AND once in the "প্র্যাকটিস টেস্ট" section; re-uploading it replaces by (class, PT,
   seq) regardless of its block set.
9. (ED-3b) Opening any block doc shows tap-through chips to the block's other materials; opening a PT
   shows chips for every block it covers.

## 9. Out of scope (v1)
Non-English subjects; xlsx vocab pools; version history UI; guardian/student access; CW/HW/PT→**tracker**
linking (owner-dropped, D-#344 #10 — note the D-#347 intra-LIBRARY linking is a different thing and IS
in scope); editing md in-app (re-upload is the edit path); Word/PDF ingestion.
