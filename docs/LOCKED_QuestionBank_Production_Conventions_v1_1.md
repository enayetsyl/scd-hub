# LOCKED — Question Bank Production Conventions · v1.0 (Project 04)

**Status:** **LOCKED v1.1 — locked 2026-06-09** (`LOCKED_QuestionBank_Production_Conventions_v1_1.md`). Logged as **D-PROJ04-002** (the seven rulings) + **D-PROJ04-006** (this supersede). **Supersedes LOCKED v1.0** (→ `/archive/`; recorded in `PROJECT04_MANIFEST_archived_files.md` — this is the first archive cutover). Never edit in place — supersede if revised (master §5.3). **What changed v1.0 → v1.1:** the **canonical source-of-record is now the validated JSON payload** (`LOCKED_QuestionPayload_Schema_v1.json`; shared passages `LOCKED_StimulusPayload_Schema_v1.json`), per **D-PROJ04-004**; the production file, master read-file, and register are **rendered views** of it. Amends §0 ruling 5 and §6. Everything else is unchanged from v1.0.
**Project:** 04 — Question Bank Production
**Owner:** Principal
**Author:** Claude (drafted); Principal (approved + locked 2026-05-31)
**This is TODO 4-A** (= Project 00 TODO step 7.1).

**Governs:** how a Project 04 chat *produces, tags, stores, and delivers* question banks.
**Does NOT govern (defers to Project 00):** the question-setting *standard* — difficulty calibration, paper structures / mark splits, key & rubric bar, weak-student volume, the review gate → **REF-09** (Tier 1) and **REF-10** (Tier 2). Bloom mechanics → **REF-17 / REF-18**. This document makes banks that *comply* with those; it never restates or overrides them.

---

## §0 — Summary (read first)

A Project 04 chat builds, for one **(class × subject)**, a tagged pool of questions organised **chapter → topic**, every question Bloom-tagged, difficulty-tagged, and carrying a key or rubric. The **topic is the atomic unit**; a chapter is the roll-up of its topics. Each build hands you three things: a **chapter production file** (canonical, versioned), the **master-ready section** to splice into that subject's read-file, and a **paste-ready register block** for your Google Sheet. **No questions are ever copied into a lesson/session plan** — the plan and its questions are linked only by the shared topic tag.

**Locked rulings (D-PROJ04-002):**
1. **Topic is the atomic unit.** Ask by topic → that topic's Pool; ask by chapter → the union of its topics' Pools, each question keeping its `TOP-…` tag. (§2)
2. **Default 30 questions per topic; the ≥20 floor (D-028) is preserved.** Override up (no ceiling) or down, never below 20. (§4)
3. **Three selectable, tagged streams: homework (`HW-…`), weekly assignment (`AS-…`), per-chapter class test.** No classwork stream. (§8)
4. **Every question carries a stable QID.** (§3)
5. **The validated JSON payload is canonical (D-PROJ04-004 / D-PROJ04-006); the production file → master read-file → register index are rendered views of it — all local / in Google Drive, upload-on-trigger.** (§6/§7)
6. **Each build emits paste-ready register data (TSV) for Google Sheets.** (§7)
7. **The lesson/session plan holds no Pool** — no inline copy, no reference. The link is the shared **topic tag** (`TOP-…`). **(Master D-051, supersedes D-029.)** (§6.1)

**Before-lock checklist** is at §10. **Build procedure** is §9.

---

## §1 — What a bank is (and is not)

A bank is a **tagged, keyed pool of questions** for one (class × subject), grouped by chapter and topic. It is **not** a finished exam paper. Papers, homework, and assignments are *assembled by selection* from the bank under REF-09 / REF-10 — the bank supplies the raw, already-compliant questions; it does not set mark totals or paper structure.

## §2 — The unit model: topic is atomic, chapter is the roll-up

- The **topic** (`TOP-{SUBJECT}-C{class}-{nn}`, the mandatory code from REF-07 §3.5 / REF-19) is the smallest addressable unit. Each topic owns one Pool.
- A **chapter** has no Pool of its own. A chapter request returns the **union of the Pools of every topic in that chapter**, each question still showing its `TOP-…` tag.
- The `TOP-…` tag is the single join key — it answers a topic request, a chapter request, **and** the plan↔questions link (§6.1) — so questions are never stored twice.

## §3 — IDs and tags

| Element | Format | Source |
|---|---|---|
| Topic tag | `TOP-{SUBJECT}-C{class}-{nn}` | REF-07 §3.5 / REF-19 |
| Pool (per topic; chapter-scope per D-050) | `QP-{SUBJECT}-C{class}-U{unit}[-L{lesson}]` | REF-08 §2.8 / REF-02 §2.8 |
| **Question (stable QID)** | `QP-…-Q{nn}` (e.g. `QP-BAN-C1-U2-L4-Q03`) | this doc |
| Homework item (selected, not authored) | `HW-{class}-{SUBJECT}-{nnnn}` | REF-08 §5.1 |
| Weekly assignment | `AS-…` | REF-07 |
| Chapter production file | `C{class}_{SUBJECT}_U{nn}_QuestionBank_v{ver}.md` | D-037 |
| Master read-file (per class × subject) | `C{class}_{SUBJECT}_QuestionBank_MASTER_v{ver}.md` | this doc |

The **QID is permanent** — once `…-Q03` exists it is never reused, even if retired; new questions take the next free number. A homework/assignment row, a master section, and a register row all point back to the exact same question for life.

## §4 — Pool size

- **Default production target: 30 per topic.** Build to 30 unless a request says otherwise.
- **Hard floor: 20 (D-028, unchanged).** Never deliver below 20.
- **Per-request override:** more than 30 (no ceiling) or, narrowly, fewer — never below 20.

## §5 — Per-question requirements (the compliance bar)

1. A **Bloom tag**. Topic Bloom mix follows the **REF-17 §5.2 chapter-scope band** for the class, weighted toward the topic's REF-03 / REF-19 emphasis tier. Application / free-thinking is the default skew within the band.
2. A **difficulty tag** per **REF-09's** calibration (REF-09 owns the scale; the bank tags to it, never invents levels).
3. A **question type** (MCQ / short / structured / creative) per REF-09's paper-structure vocabulary.
4. A **mandatory answer key**, or a **rubric** for open-ended items (D-028 / REF-09).
5. **Curation clearance:** stem, every option, every name, every scenario passes **REF-01** + a **REF-21** self-scan; names from **REF-20** (matching class pool); English operative vocabulary = Core + Working + already-taught (**REF-22**), Receptive only inside a glossed passage.

**Language:** question content in Bangla (English subject excepted); IDs, tags, and register column codes in English.

## §6 — The storage model and how it reaches you (canonical = validated JSON; D-PROJ04-006)

One question is **authored once as a validated JSON payload** (`LOCKED_QuestionPayload_Schema_v1.json`; a shared passage as `LOCKED_StimulusPayload_Schema_v1.json`) — the **single source of record** (D-PROJ04-004 / D-PROJ04-006). Everything teacher-facing is **rendered** from that JSON; editing only ever happens in the JSON source.

| Artifact | Granularity | Role | Where it lives |
|---|---|---|---|
| **Chapter production file** | per chapter | **Rendered teacher/author view** (was the canonical source in v1.0; the JSON payload is canonical from v1.1 — D-PROJ04-006). Rendered from the JSON; where the chat reviews and **versions** one chapter (carries the version log + review record). Superseded one chapter at a time (old → `/archive/`). | Local, MANIFEST-tracked, **upload-on-trigger** |
| **Master read-file** | per (class × subject) | **Teacher read copy** — "open one file, see the whole subject." A **concatenation of current chapter bodies.** **Never hand-edited.** | Google Drive |
| **Register** (Google Sheet) | per (class × subject) | **Index / retrieval engine** (§7). | Google Drive |

**Lineage:** author the **JSON payload** (canonical) → **render** the production file (with its `MASTER-BODY` block), splice the master concatenation, and emit the register TSV — all from the one JSON via the renderer/harness. The production file, master, and register are **regenerated rendered views**, never hand-edited.

**Single-source generation (D-PROJ04-006).** Because the production file/master and the register TSV are generated from the one validated JSON, there is **zero drift** between artifacts. The school software imports the JSON through the envelope (`LOCKED_SCHOOLSW_ImportEnvelope_Schema_v1.json`, `doc_type:"question"` / `"stimulus"`) and **renders its own display/PDF** from the payload — it does **not** consume the Markdown (unlike plan imports, which carry co-rendered Markdown). The closed contract + the import gate are `LOCKED_QuestionPayload_Schema_v1.json` / `LOCKED_StimulusPayload_Schema_v1.json` + `validate_import.py`.

**"Canonical" ≠ "kept in Project knowledge."** The canonical JSON payload is authoritative; it does not sit permanently in Project 04. Banks are plain text (small on disk), but to keep every chat lean (§5.13) they follow the **upload-on-trigger** pattern (REF-03 spines, REF-06 V1A, textbooks/TGs under D-006): upload a bank into a chat only while that (class × subject) is worked, remove after. Teachers read the **master + register in Drive**; Project 04 holds nothing between builds.

**Production file structure (so the master splices mechanically):** a thin **production header** (status, version log, review record) then the **question body** between markers:

```
<!-- MASTER-BODY:START  C3_BAN_U2 -->
## Chapter U2 — <title>
### TOP-BAN-C3-05 — <topic>
> Pool QP-BAN-C3-U2-L1 …
>   QP-BAN-C3-U2-L1-Q01  … (Bloom / difficulty / type) … Answer/Rubric: …
…
<!-- MASTER-BODY:END  C3_BAN_U2 -->
```

The master = the concatenation of every current chapter's `MASTER-BODY` block under a thin master header — a mechanical splice, never a re-author.

### §6.1 — The lesson/session plan carries no questions (master D-051)

The lesson/session plan holds **no Pool — neither an inline copy nor a reference block.** A plan and its questions are connected solely by the **topic tag** they share:

- the plan's **Spine** already declares the topic(s) it teaches as `TOP-…` codes;
- every register row carries the same `TOP-…` tag.

So at planning or teaching time the teacher reads the plan's topic tag → filters the register (or opens the master) on that tag → selects questions. **A bank change never touches a plan.** This is **master D-051** (supersedes D-029, "Pool is inline"); it removed the inline-Pool field from the lesson-plan template (REF-02 v1.6), the homework rule (REF-08 v1.3), the Production Core (v3), and the Session/Chapter layout instructions (v9 / v3.2). D-030 is unchanged (the teacher still selects `Y`, now from the register/master).

## §7 — The register (retrieval engine) + paste-ready output

**One Google Sheet per (class × subject)**, one row per question. Columns (English codes):

`QID · TOP-tag · Chapter/Unit · Bloom · Difficulty · Type · Key/Rubric · Stream-suitability · Stem(preview) · Source file + ver · Curation-clean`

- Filter on `TOP-…` → every question on a topic across chapters; filter on Chapter/Unit → the chapter roll-up. This is also the plan↔questions lookup (§6.1).
- **Stem(preview)** is a truncated, non-authoritative recogniser (full text in the master).
- **Source file + ver** is the **drift-catcher**: a row whose version ≠ the live production file is stale.

**Each build emits paste-ready register data** — a **tab-separated (TSV) block in a code box**, copy-paste straight into the Drive sheet (Sheets splits tabs into columns). First build of a class × subject → include the header row; later chapters → data rows only (append); on a supersede → the refreshed rows for that chapter **plus a one-line list of retired QIDs to delete**. Example:

```
QID	TOP-tag	Chapter/Unit	Bloom	Difficulty	Type	Key/Rubric	Stream	Stem(preview)	Source	Curation
QP-BAN-C3-U2-L1-Q01	TOP-BAN-C3-05	U2/L1	Understand	Easy	Short	Key	HW	"… <first words> …"	C3_BAN_U2_v1	Y
```

**Project 06 boundary:** the register is the **authoring + retrieval** index. The **live usage count** and the **delivery→return lifecycle** of any selected `HW-…`/`AS-…` belong to **Project 06's** trackers (REF-08 §5). The register may carry a last-used / rotation hint, but Project 06 owns the authoritative count.

## §8 — Retrieval and selection into streams

Selection is always *picking from the Pool via the register/master*, never authoring at point of use (D-030 — time is the cap, count is the lever):
- **Homework** → teacher reads the plan's `TOP-…` → filters the register → selects → items become `HW-…`, tagged `TOP-…`, logged in the Homework Tracker.
- **Weekly assignment** → `AS-…` (REF-07-scheduled), same path.
- **Per-chapter class test** → the chapter roll-up (filter on Chapter/Unit).
- **Classwork** → **not a bank stream**: lesson plan's Independent Practice / Flex Zone, untagged here.

## §9 — Build procedure (stepwise)

1. **Confirm the (class × subject)** and load inputs: REF-05 · REF-03 · REF-19 (topic list) · REF-09/REF-10 · REF-18/REF-17 · REF-01/REF-21/REF-20/REF-22.
2. **List the chapter's topics** from REF-19 → the `TOP-…` codes.
3. **For each topic, draft to 30** (≥20 floor): Bloom mix from REF-17 §5.2; difficulty per REF-09; skew to application/free-thinking.
4. **Stamp each question:** QID · Bloom · difficulty · type · key-or-rubric.
5. **Curation pass:** REF-01 + REF-21; names REF-20; English vocab REF-22.
6. **Assemble the chapter production file** (header + `MASTER-BODY` block) under the D-037 filename.
7. **Emit the master-ready section** (the `MASTER-BODY` block) for splicing.
8. **Emit the register TSV block** (§7) — header on first build, else data rows; list retired QIDs on a supersede.
9. **Run the §10 checklist + the REF-09 §9 Review Gate** (REF-10 §6 for stretch items).
10. **Deliver** the production file; note any topic that fell back to the 20 floor and why.

## §10 — Before-lock checklist (per chapter build)

- [ ] Every topic has a Pool; each ≥ 20, default-targeted at 30.
- [ ] Every question has a QID, Bloom tag, difficulty tag, type, key or rubric.
- [ ] Topic Bloom mix inside the REF-17 §5.2 band; skew to application/free-thinking.
- [ ] Difficulty tags map to REF-09's scale.
- [ ] Curation clean: REF-01 + REF-21; names REF-20; English vocab REF-22.
- [ ] Language correct (Bangla content / English subject excepted; English IDs + codes).
- [ ] `MASTER-BODY` markers present and labelled.
- [ ] Register TSV emitted; rows 1:1 with the bank; `Source file + ver` correct.
- [ ] Review Gate passed (REF-09 §9; REF-10 §6 for stretch).
- [ ] Filename per D-037; production file marked canonical source; MANIFEST row noted.

## §11 — Decisions, propagation, version log

Logged as **D-PROJ04-002** (§0 rulings 1–7). Notes:
- **README** — conventions are not folded into the README; it carries a pointer line ("Production conventions → `LOCKED_QuestionBank_Production_Conventions`"); the rulings' canonical home is `PROJECT04_DECISIONS.md` (D-PROJ04-002).
- **Master D-051** (Pool placement) executes across REF-02 v1.6, REF-08 v1.3, Production Core v3, Session-Plan Layout v9, Chapter-Plan Layout v3.2 (Project 00 / Project 03).
- **Project 06** — register + QID exist (usage/rotation hint reads off the QID); no tracker redesign owed.
- **MANIFEST** — `PROJECT04_MANIFEST_archived_files.md` is created at the first archive cutover (first chapter supersede), per master §5.12.

| Version | Date | Change | By |
|---|---|---|---|
| DRAFT v1 | 2026-05-31 | First draft (topic-atomic / chapter-roll-up, default-30 / floor-20, three streams no-classwork, QID, register). | Claude |
| DRAFT v1.1 | 2026-05-31 | Three-artifact storage model; `MASTER-BODY` markers; paste-ready TSV register output; README-pointer. | Claude |
| DRAFT v1.2 | 2026-05-31 | Lesson-plan inline Pool removed — plan↔questions link is the topic tag (§6.1); the D-029 supersede; artifact set is exactly three. | Claude |
| **LOCKED v1.0** | 2026-05-31 | **Locked as D-PROJ04-002.** Body unchanged from DRAFT v1.2; §6.1 / §11 reworded to cite the now-adopted **master D-051** (supersedes D-029) and its execution across REF-02 v1.6 / REF-08 v1.3 / Core v3 / Layout v9 / v3.2. Supersedes DRAFT v1.2 (→ `/archive/`). | Claude (drafted); Principal (approved + locked) |
| **LOCKED v1.1** | 2026-06-09 | **Canonical source = validated JSON payload (D-PROJ04-004 / D-PROJ04-006).** §0 ruling 5 + §6 amended: the JSON payload (`LOCKED_QuestionPayload_Schema_v1.json`; stimulus `LOCKED_StimulusPayload_Schema_v1.json`) is the single source of record; the production file / master read-file / register are rendered views, regenerated never hand-edited; single-source generation = zero drift; the app imports the JSON via `LOCKED_SCHOOLSW_ImportEnvelope_Schema_v1.json` and renders its own display/PDF. Everything else unchanged from v1.0. Supersedes LOCKED v1.0 (→ `/archive/`; first archive cutover → `PROJECT04_MANIFEST_archived_files.md` created). | Claude (drafted); Principal (approved + locked) |
