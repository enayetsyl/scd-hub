---
name: term-correlation-study
description: Use when the owner asks what drives class-test results, or to re-run / refresh the attendance × homework × assignment correlation study and its published pages — e.g. "run the term study", "does attendance affect results", "update the marks report with this term's data". Pulls prod read-only, computes the statistics, and re-renders the English + Bangla report pages.
---
# Term correlation study — attendance × homework × assignment → class-test results

Answers one question from real data: of the things the school records, which actually
go with how a child scores? First run 2026-09-23 (2026-06-21 → 2026-09-23).

**Nothing here is regenerated from scratch.** The statistics, the definitions and the
two report pages already exist. Re-running means: pull fresh data, run two scripts,
**re-read the conclusions**, publish.

## 0. Before you start

- **Ask the owner before SSHing to the VM** — the permission classifier needs their
  explicit go-ahead, and in auto mode prod reads are refused outright. If a read comes
  back `[Production Reads]`, ask them to `shift+tab` out of auto mode; if it comes back
  `[PII Data Handling]`, you are reading a name — see step 2.
- Pick the window with the owner. A term is the natural unit. Both scripts take it as
  `CORR_FROM` / `CORR_TO`.
- `mkdir out/` under this skill. Everything generated lands there and is gitignored —
  it holds real student data and must never be committed.

## 1. Two read-only pulls from prod

VM access, key path and the stdin recipe: see the `scdhub-vm-access` /
`prod-env-sourcing-trap` notes. Both scripts are piped in on **stdin** so nothing is
written into `/opt/scdhub/prod`.

```bash
ssh -i ~/.ssh/scdhub-deploy-2026 deploy@<vm> \
  'cd /opt/scdhub/prod && node' < scripts/export.cjs > out/data.json

ssh -i ~/.ssh/scdhub-deploy-2026 deploy@<vm> \
  'cd /opt/scdhub/prod && CORR_FROM=2026-06-21 CORR_TO=2026-09-23 node' \
  < scripts/attendance.cjs > out/att.json
```

SSH to this box drops connections intermittently — wrap the call in an `until` loop
rather than giving up after one timeout.

## 2. Two things that will bite you

**Attendance is NOT keyed to the section.** For Class 1–5 it is captured on the
cross-section **Quran SubjectGroup** (first period of the day, D-#278). Reading
`studentattendancedays` by `sectionId` finds only pre-cutover leftovers and makes a
complete dataset look ~15% captured — that error reached a published conclusion once.
`attendance.cjs` calls the app's own `studentAttendanceHistory` instead. Do not
"simplify" it into a raw query. The full explanation is in that file's header.

**Everything is pseudonymised on the VM, before it crosses the wire.** Student ids are
salted hashes; no name, phone or guardian field is exported. This is not optional
politeness — a read that returns names is refused by the classifier, so an un-hashed
export fails halfway. If you need to know *who* (which teacher, which child), pull it
as `Teacher-1` / `Teacher-2` aliases and let the owner map them.

## 3. Analyse

```bash
node scripts/analyze.cjs      # -> out/report.txt and out/figures.json
```

**Check the sanity line first.** `attendance × hw ABSENT_REDELIVER` should be about
**−0.95**. Much weaker means the wrong attendance unit was read and every attendance
number below it is wrong.

Definitions are fixed in the script header so runs stay comparable: submitted =
SUBMITTED/CHECKED/RESUBMIT/RETURNED; not submitted = CHASE/DUE; ABSENT_REDELIVER and
GIVEN excluded; quality = CORRECT 1 / PARTIAL 0.5 / WRONG 0. Every headline is
reported twice — raw % and within-test z (difficulty and section removed). **If the
two disagree, trust z.**

## 4. Read the report — this is the judgment step, not a formality

`out/report.txt` is for you, not the owner. Before rendering anything, answer:

- Did any correlation **change direction or cross significance**? The published pages
  assert directions in prose ("attendance does not predict", "only below 85%",
  "homework quality is the best predictor"). A token swap cannot fix a sentence whose
  finding has flipped.
- Is the **attendance threshold** still around 85%? The band chart greys everything
  below 0.85 and draws the marker there. If the cliff moved, change it in both
  templates.
- Does **Class 4+5** still stand out? If the pattern now sits in different classes,
  that paragraph needs rewriting.
- Did the **n** collapse anywhere? Under ~10 students a correlation is noise; say so
  rather than charting it.

Where a conclusion changed, edit `templates/` — never `out/`, which is overwritten.

## 5. Render

```bash
node scripts/render.cjs       # -> out/page-en.html, out/page-bn.html
```

Templates hold the language; `figures.json` holds the numbers. The renderer fails
loudly on an unfilled token. Bangla scalars are converted to Bengali digits
automatically — that matches the app, which uses them throughout.

Bangla vocabulary is fixed by the owner and must not drift: বাড়ির কাজ (never
হোমওয়ার্ক), উপস্থিতি (not হাজিরা), শিক্ষার্থী (not ছাত্র), শাখা, রিমাইন্ডার,
শ্রেণি শিক্ষক. Class names come from `ROSTER_CLASS_LABELS_BN`.

## 6. Publish

Update the **existing** artifacts rather than creating new ones — find them with the
Artifact tool's `list` action; they are titled **"What Moves the Marks"** and
**"নম্বর কীসে বাড়ে"**. Read each one first, then publish with its `url`. Publishing
without the URL makes a duplicate and orphans the link the owner has already shared.

The pages are private; sharing is the owner's action, from the page's Share menu.

## 7. Close out

Append a `CHANGELOG.md` line. Add a `DECISIONS.md` row only if a finding changed
something the school will act on. If the study turns up a data-quality problem (a
roster that is out of date, a tracker state nobody clears), log it via `log-issue`
rather than burying it in the report.
