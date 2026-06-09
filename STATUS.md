# STATUS

_Updated: 2026-06-09_

## Now / next
- **Done:** Slice 1 — content import + view + PDF (J1 end-to-end).
  - CorpusEvent model (corpus plane — de-identified, no identity refs, ADR-005)
  - ImportBatch model (platform — audit row per import run)
  - ContentArtifact model (content — JSON + rendered_markdown + version chain, ADR-006)
  - ContentService: calls Python harness via child_process, persists artifact + batch + event, handles version supersede (J1.9)
  - `importEnvelope` mutation (requires `content:import`; TEACHER denied — J1.4); `contentTree`, `contentArtifacts`, `artifact` queries (row-scope enforced — J1.5/J1.6)
  - PDF route `GET /pdf/artifact/:id` — pdfkit + NotoSansBengali-Regular.ttf (ADR-009)
  - Tests: 62/62 pass (J1.1–J1.4, J1.5/J1.6, J1.9, Bangla PDF smoke). `tsc --noEmit` clean. Vocab verifier PASS.
- **Next:** build **Slice 2** — question bank + assembly (J2 + J3; question payload LOCKED D-#19).

## In flight
- (none — Slice 1 shipped)

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
