# Glossary

Canonical terminology — read before naming anything. This is a **stub** seeded from terms already in
use; grow it as the build proceeds. Authoritative definitions live in `docs/requirements.md` and
`docs/architecture.md`; this file is the single place to look them up. Where a definition here and the
source docs disagree, the docs win — fix this file.

| Term | Meaning |
|---|---|
| **Envelope** | The single unified import unit: a stable outer contract + a `payload` chosen by `doc_type`. The only way content enters the app. See `docs/import-contract.md`. |
| **Payload** | The `doc_type`-specific body inside the envelope. For plan types it is the whole Project-03 plan artifact, unchanged; for questions it is envelope-native (provisional, R-IMP5). |
| **doc_type** | Discriminator selecting the payload shape: `chapter_plan`, `session_plan`, `question`, `question_set`. |
| **Plan doc-types** | `chapter_plan` and `session_plan` — payloads validated against the Project-03 plan schema (L2). |
| **Question doc-types** | `question` / `question_set` — payload provisional pending Project 04. |
| **rendered_markdown** | The co-generated Markdown carried beside a plan payload. The app displays/PDFs this; it NEVER re-renders from JSON (ADR-006, Option B). |
| **curation_tag** | Upstream-authored curation signal (`KEEP_AS_IS`, `NEEDS_REPLACEMENT`, `FLEXIBLE`). Advisory at import; curation authority stays upstream (D-#4). |
| **review_status** | Quality gate on content: `draft` → `reviewed` → `gold` (Principal-locked). Export/analytics filter on it (D-#3). |
| **address** | The envelope's locator: `anchor_word` + `number` + `title` (e.g. Unit 9). Must match the payload's `division`. |
| **anchor_word** | Subject-appropriate unit word (পাঠ / অধ্যায় / Unit / Lesson). Mirrored enum. |
| **pinned_to** | Layout/core versions the artifact was authored against (chapter/session layout, production core). Mismatch warns; re-conformance may be owed. |
| **provenance** | Origin metadata: `source_project`, `author`, `content_version`, etc. |
| **Operational plane** | The identity-bearing data plane (students/guardians/users, trackers, rosters). |
| **Corpus / analytics plane** | The de-identified content+analytics plane. Has NO resolver path back to identity. |
| **PII firewall** | The structural isolation (ADR-005) keeping the corpus/analytics plane from reaching identity. Enforced by a fail-closed test (NFR-11), not a permission. |
| **Events** | The de-identified event backbone (event-sourced-lite, ADR-007); exported then pruned to Drive as JSONL (D-#2). |
| **Audit log** | Separate, identity-bearing, system-appended, never user-written; retained ~2yr (ADR-008, D-#7b). |
| **Set types** | Assembled assessment sets: `HW` (homework), `AS` (assignment), `CT` (class-test). App-native vocab. |
| **Tracker kinds** | `classtest`, `assignment`, `homework`, `generic`. A CT set feeds the class-test tracker, AS→assignment, HW→homework. |
| **Section** | Subdivision of a class; default `"Main"` (D-#1). Code stays English; UI shows the Bangla label. |
| **Provenance / pinned_to** | (see above) — carried on every imported artifact for traceability and re-conformance. |
| **import_batches** | The audit row written on a successful import (R-IMP3). |
| **RBAC / PoLP / row-scope** | Default-deny action grants (`shared/vocab.ts`), least-privilege, and row-level scoping — enforced in resolvers (ADR-004). |
