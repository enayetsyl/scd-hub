# STATUS

_Updated: 2026-06-09_

## Now / next
- **Done:** Slice 2 — question bank + assembly (J2 + J3 end-to-end).
  - AssessmentSet model (`assessment` module) — basket items, CT/HW/AS metadata, draft→assembled lifecycle.
  - `questions` / `question` / `stimuli` GraphQL queries — thin tag-filter view over ContentArtifact (no new collection); filters: subject/classLevel/topicTag/questionType/bloomLevel/difficulty/paperRole/marksMin/marksMax. Row-scope enforced (J2.4: supervisory grant passes naturally).
  - `createSet` / `addQuestionToSet` / `assembleSet` mutations — write-scope via `assertCanWrite` (J3.5: supervisory-only teachers denied); basket accumulation emits `questions_selected` CorpusEvent; assembleSet emits `set_assembled` CorpusEvent.
  - `assessmentSet` / `assessmentSets` queries — read-scope enforced.
  - PDF route `GET /pdf/set/:id` — structured pdfkit renderer (NotoSansBengali; renders question_text + answer-carrier per type; no rendered_markdown for questions, ADR-006).
  - Tests: 92/92 pass (J2.1–J2.4, J3.1–J3.2, J3.5 + all Slice 0+1 tests). `tsc --noEmit` clean. Vocab verifier PASS.
- **Next:** build **Slice 3** — trackers (J4: class-test / assignment / homework trackers).

## In flight
- (none — Slice 2 shipped)

## Blocked / waiting
- (none blocking)
  - Open follow-ons from the Project-04 contract LOCK (D-#19), non-blocking:
    - Wire the **authoritative REF-19 registry** via `--ref19-registry`.
    - Upgrade **`topic_tag`** from pattern-only to registry validation.

## Foundation in place
- Requirements (DRAFT), Architecture/17 ADRs (DRAFT), **import contract LOCKED v1.0**, conformance
  harness v1.0 (L1→L4, working), 11 fixture instances green.
- `/shared` vocab v1.0 + RBAC (verified).
- **Slice 0 shipped (2026-06-09):**
  - npm workspaces: `/shared` (built, .d.ts emitted), `/server` (Node + Yoga + Pothos + Envelop),
    `/app` (Expo skeleton, boots on web).
  - Foundation models: User, Guardian, Student, GuardianLink, Class (+ auto-Main section), Section,
    Subject, AcademicYear, ScopeGrant.
  - Audit model (append-only, ADR-008) + AuditService.
  - Staff auth (email+password, JWT) + Guardian auth (flexible identifier).
  - Scope-grant model (teaching/supervisory/proxy) + ScopeGrantService + resolver authz middleware.
  - Proxy auto-expiry: window-checked at request time; expiry audit stamped at first denied-after-expiry
    (D-#21). Early-revoke + extend supported.
  - **Fail-closed firewall test GREEN** (J5.6, ADR-005): corpus analytics path cannot resolve
    student/guardian identity — 7 firewall assertions pass.
  - tsc --noEmit: CLEAN. npm test: 31/31 PASS. vocab verifier: PASS.

## Recent decisions
- D-#17/#18: TEACHER scope overlays — supervisory (read-only) + proxy/cover (bounded write).
- D-#19: adopted Project-04 LOCKED question/stimulus contract.
- D-#20: proxy grants duration-bounded in days; auto-expiry + audit.
- **D-#21:** proxy-expiry audit stamped at request time (first denied-after-expiry) — no cron.
- **Slice 1 design:** Python harness invoked via child_process (not re-ported to TS) — canonical gate stays single-source. pdfkit + NotoSansBengali font (not puppeteer) — no system Chromium dep on Oracle Always-Free.

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
  lives in `docs/roadmap.md`.
