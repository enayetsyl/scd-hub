---
name: log-issue
description: Use when the user pastes a testing issue (text + optional screenshot + platform) and wants it captured — e.g. "log this", "add to the backlog". Appends a structured BUG-NNN entry to docs/issues/BACKLOG.md.
---
# Log a testing issue

Full schema, allowed values, and fix workflow live in `docs/issues/README.md` — read it if unsure.

1. Read `docs/issues/BACKLOG.md`. Next ID = highest existing `BUG-NNN` + 1 (zero-padded, never reused).
2. **Screenshot — transcription-first.** If a screenshot was pasted, read it and fold its salient
   content (error text, on-screen state, which screen) into Repro/Actual so the entry is
   self-contained; set `Screenshot: —`. Only when the *visual itself* matters (layout/CSS) ask the
   user to drop the file into `docs/issues/assets/` as `BUG-NNN-1.png` and reference it.
3. Append a new section at the **top of the issue list** (newest first), using the template:
   ```markdown
   ## BUG-NNN — short title
   - **Status:** open
   - **Severity:** blocker|high|medium|low
   - **Platform:** web|mobile-web|android-app|ios-app   (one or more)
   - **Area:** homework|assignment|class-test|finance|routine|revision|comments|auth|nav|roster|content|observability|other
   - **Reported:** <today, YYYY-MM-DD>
   - **Screenshot:** —

   **Repro:**
   **Expected:**
   **Actual:**
   **Notes:**
   **Fix ref:** —
   ```
4. Fill what's known; leave unknowns as `—`. Default `Severity: medium` if genuinely unclear
   (ask only if it could be a blocker). Keep it terse — a tracker line, not a postmortem.
5. Confirm back with the assigned `BUG-NNN`.

This is docs-only (path-ignored by deploy) — the commit never redeploys and may go straight to `main`.
