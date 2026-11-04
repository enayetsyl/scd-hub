# Learning-objective trees (mastery catalogue v2)

Contract: `docs/prd-objective-tree.md` (D-#921–#928). Supersedes the flat files in `../lo-catalogue/` for
structure; those stay as the history and as a source Claude reuses (question types, marks, home tips).

## Files
| File | What it is | Edited by |
|---|---|---|
| `domains/<SUBJ>.json` | School-wide domain ladder for one subject (`DOM-<SUBJ>-<SLUG>`), shared by every class | Claude drafts; confirmed with the subject's first lock |
| `<CLASS>_<SUBJ>.tree.json` | The draft tree — the **only source**; this is what the Principal imports | Claude; after import, changes happen in the app |
| `<CLASS>_<SUBJ>.md` | Review sheet rendered from the JSON (read on GitHub) | Regenerated, never hand-edited |
| `feedback/<CLASS>_<SUBJ>.round<N>.json` | Export of the reviewer's decisions (OT-2) | App export; Claude reads before the next draft |

## Status of a tree
1. **DRAFT** — Claude read the final print + teacher notes + marks appendix, inventoried every numbered exercise
   and passed the structural verifier.
2. **In review** — imported; Mahzabin reviews in the app (শিখনফল পর্যালোচনা) and consults subject teachers.
3. **LOCKED** — the Principal locks behind the gate (no open comment, no unresolved exercise). Codes are permanent:
   retire, never delete or re-code.

## `scd-objective-tree/1`
```jsonc
{
  "format": "scd-objective-tree/1",
  "classToken": "C1", "subject": "MATH", "status": "DRAFT",
  "source": { "book": "C1_MATH_Student_Print_v1_5", "files": ["…"], "readOn": "2026-11-04" },
  "chapters": [{ "number": 7, "titleBn": "যোগ" }],
  "questionTypes": [{ "code": "QT-MCQ", "labelBn": "…", "marksBn": "১", "examUse": "অর্ধবার্ষিক প্র. ১ (১০×১) …" }],   // the book's mark distribution, carried to the importer as-is
  "nodes": [{
    "code": "LO-C1-MATH-07-03.2",        // objective LO-<C>-<S>-<CC>-<NN>; sub = objective + ".N"; strand LO-<C>-<S>-SK-<X>-<NN>
    "level": "SUB",                       // OBJECTIVE | SUB
    "parentCode": "LO-C1-MATH-07-03",     // null for an OBJECTIVE
    "domainCode": "DOM-MATH-ADD",
    "chapterNumber": 7,                   // null for a skill strand
    "strand": null,                       // e.g. "COL" for a strand
    "labelBn": "খাড়ায় হাতে রেখে যোগ (৯৯ পর্যন্ত)",
    "sourceText": "…verbatim book words…",
    "bookRef": { "chapter": 7, "lesson": "হাতে রাখি", "exercises": ["7/হাতে রাখি/2"] },
    "assess": "QUESTION",                 // QUESTION | RUBRIC
    "questionTypeCodes": ["QT-…"],
    "homeTipBn": null,                    // objectives only (guardians see objective grain)
    "prereqCodes": ["LO-C1-MATH-07-02.1"],
    "tagged": true,                       // true = questions/evidence name it; false = grouping parent
    "legacyCodes": ["LO-C1-MATH-07-02"],  // flat draft codes it replaces
    "claudeNote": "why the line is drawn here / which test it barely passed"
  }],
  "coverage": { "exercisesTotal": 164, "mapped": 164, "unmapped": [{ "ref": "…", "text": "…", "reason": "…" }] },
  "flags": [{ "code": null, "kind": "VERSION_DIFF", "text": "…" }],  // WORDING_RULE_CONFLICT | TOO_BROAD | DUPLICATE | VERSION_DIFF | OTHER
  "reviewerNotes": "## পর্যালোচকের নোট …"   // optional (C2 onward): the review sheet's "read first" block; the importer ignores it
}
```

## Rules (owner, 2026-11-04)
- **Split only when it can fail apart.** An objective gets children only if a child can pass one part and fail
  another; otherwise it is itself tagged. Never exactly one child; never a child repeating its parent.
- **Five tests per tagged row:** ≤ 2-minute question can test it · the book practises it (≥ 1 exercise) · it can be
  retaught alone in one extra class · once per class · split only when it can fail apart.
- **One code per question.** A two-skill exercise becomes ক/খ parts in the bank; never double-tag.
- **Labels:** plain Bangla in the owner's vocabulary; objective labels must read well to a guardian; never
  "গাণিতিক বাক্য" (use "হিসাবটি").
- **Prerequisites** point to the earlier step — inside the class first; cross-class when the class below is drafted.
- **Coverage:** every numbered exercise maps to ≥ 1 tagged row; every tagged row cites ≥ 1 exercise.

## Coverage
| Class | BAN | ENG | MATH | BGS | SCI | ISLAM | ARABIC |
|---|---|---|---|---|---|---|---|
| C1 | — | — | draft (pilot) | | | book pending | book pending |
| C2 | — | — | draft | | | book pending | book pending |
| C3 | — | — | pilot next | — | — | book pending | book pending |

Cross-class prerequisites (C2 → C1 codes, …) resolve at import against the earlier class's live rows, so a class
is imported after the class below it. The repo CLI `skills/_tools/verify_objective_tree.mjs` has no flag for
earlier-class codes yet, so it reports those prerequisites as "not found"; every other rule must be green.
