# Issue backlog — testing triage

Central, git-tracked record of issues found while testing the app, so each one is
**captured once, tracked, and later fixed** by a Claude session or a human — singly or
in batches.

This is docs-only and **path-ignored by deploy**, so logging an issue never redeploys;
issue commits may go straight to `main` (AGENTS.md branch workflow).

## Layout
```
docs/issues/
  README.md    ← this SOP
  BACKLOG.md   ← every issue, newest first, each a "## BUG-NNN" section
  assets/      ← screenshots, named <ID>-<n>.png (only when a picture matters)
```

## Issue schema
Each issue is one `## BUG-NNN — <short title>` section in `BACKLOG.md`:

```markdown
## BUG-NNN — short title
- **Status:** open
- **Severity:** medium
- **Platform:** android-app, web
- **Area:** homework
- **Reported:** YYYY-MM-DD
- **Screenshot:** assets/BUG-NNN-1.png   <!-- or "—" -->

**Repro:** steps to reproduce
**Expected:** what should happen
**Actual:** what happens instead
**Notes:** anything else (suspected file/cause, related D-#, etc.)
**Fix ref:** —   <!-- commit hash / PR # when fixed -->
```

### Allowed field values
- **Status:** `open` · `in-progress` · `fixed` · `wontfix` · `cant-repro` · `duplicate`
- **Severity:** `blocker` (can't use the app / data loss) · `high` (feature broken, no workaround)
  · `medium` (broken with a workaround, or wrong-but-usable) · `low` (cosmetic / polish)
- **Platform:** one or more of `web` · `mobile-web` · `android-app` · `ios-app`
- **Area:** the module — e.g. `homework` · `assignment` · `class-test` · `finance` · `routine`
  · `revision` · `comments` · `auth` · `nav` · `roster` · `content` · `observability` · `other`

## ID scheme
`BUG-NNN`, zero-padded, sequential, **never reused** (a `wontfix`/`duplicate` keeps its number).
The next ID = highest existing `BUG-NNN` + 1.

## Intake — when the user pastes an issue
Trigger: the user pastes an issue (text + optional screenshot + platform) and says e.g.
*"log this"* / *"add to the backlog"*.

1. Assign the next `BUG-NNN`.
2. **Screenshot — transcription-first:** read the screenshot and write its salient content
   (error text, on-screen state, which screen) into **Repro/Actual** so the record is
   self-contained. Set `Screenshot: —`. Only when the *visual* itself matters (layout/CSS)
   ask the user to drop the file into `assets/` as `BUG-NNN-1.png` and reference it.
3. Append the section at the **top** of the issue list in `BACKLOG.md` (newest first).
4. Fill what's known; leave unknowns as `—`. Don't guess severity wildly — ask if unclear,
   else default `medium`.
5. Confirm back with the assigned ID.

Keep entries terse; this is a tracker, not a postmortem.

## Fixing — when the user wants issues addressed
Trigger: *"fix BUG-014"*, *"fix all open blockers"*, *"clear the homework bugs"*, etc.

1. Read `BACKLOG.md`; filter by `Status: open` + the requested `Severity`/`Area`/`Platform`.
2. Fix following the normal AGENTS.md feature/fix workflow (branch from `dev`, verifiers green).
3. Flip `Status:` → `in-progress` while working, then `fixed` when verified.
4. Set `Fix ref:` to the commit hash / PR #. Reference `BUG-NNN` in the commit message.
5. Leave the section in place (don't delete) — `fixed` is the audit trail.

## Notes
- This complements, not replaces, `STATUS.md`/`DECISIONS.md`. Real decisions still go to
  `DECISIONS.md`; this is just the running bug list.
- Avoid committing many large PNGs — prefer transcription. `assets/` is for the few visual bugs.
