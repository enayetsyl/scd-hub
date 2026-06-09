# School Software — Architecture

**Doc ID:** SCHOOLSW-ARCH · **Version:** v0.3 (DRAFT) · **Owner:** Principal
**Companion to:** SCHOOLSW-REQ v0.4. Requirements say *what/why*; this says *how*. Where they conflict, requirements win and this doc is corrected.
**Scope note:** Standalone initiative. Not a curriculum Project REF.

---

## Summary — decision index (read first)

| ADR | Decision | One-line rationale |
|---|---|---|
| ADR-001 | **Modular monolith** (not microservices) | One free-tier process; hard internal boundaries; refactor to services only if ever needed. |
| ADR-002 | **Module shape:** routes/resolvers → services → models; **services-only** cross-module calls | Modules stay swappable; deferred modules plug in. |
| ADR-003 | **GraphQL + codegen** primary API; **thin HTTP** for PDF/files/health | Typed contract across 3 clients; field-selection on low bandwidth. |
| ADR-004 | **Authorization in resolvers** (RBAC + PoLP + row-scope + plane) | GraphQL exposes the whole graph; authz must be field/edge-aware. |
| ADR-005 | **Two data planes** — operational vs corpus/analytics; identity isolated | Enforces the PII firewall structurally, not by policy. |
| ADR-006 | **Unified typed envelope** stored as **JSON + co-generated Markdown**; app never re-renders | Layout authority stays in Project 03 (Option B). |
| ADR-007 | **Event-sourced-lite:** append-only `events` + materialized read-models | One backbone serves ops + analytics + training signal. |
| ADR-008 | **`audit` log separate from `events`**, inside the firewall, append-only | Access accountability without polluting the corpus. |
| ADR-009 | **Server-side Markdown→PDF**, one implementation | One Bangla-typography surface for all 3 clients. |
| ADR-010 | **Expo (RN + RN-for-Web)** monorepo `/server` `/app` `/shared` | iOS + Android + Web from one codebase. |
| ADR-011 | **Files in Drive, pointers in Mongo**; **scheduled Atlas→Drive backup + restore drill** | Cost-minimal storage; tested recoverability. |
| ADR-012 | **CI gate** with depth on dense logic + **fail-closed firewall test** | Confident refactoring of a long-lived monolith. |
| ADR-013 | **Guardian = own collection; guardian↔student many-to-many; child-switcher** | One guardian, many children; one child, many guardians. |
| ADR-014 | **GraphQL stack:** Yoga + Pothos + Envelop (server); graphql-codegen client-preset; **urql** client | Lightweight + free-tier-friendly vs Apollo platform gravity; Envelop/Pothos = home for resolver authz; codegen client-agnostic. |
| ADR-015 | **Testing:** Jest repo-wide — `jest-expo` + RNTL (`/app`), Jest + Supertest (`/server`); **Maestro** e2e | One runner for solo-maintainability; depth on dense logic + fail-closed firewall test. |
| ADR-016 | **Open-decision resolutions (REQ §10):** per-section keying; events export-then-prune; uniform guardian access (drop `access_level`); guardian flexible-identifier auth; daily backup | Folds resolved decisions into the model/ops. |

**Decisions resolved (REQ §10).** All of REQ's open decisions #1–#10 are now resolved (see REQ v0.6 register). Model/ops-affecting ones recorded here: **#1** per-section keying (§4), **#2** events export-then-prune (§6), **#7a** daily backup + rotation (§11), **#8** uniform guardian access — drop `access_level` (§4), **#9** guardian flexible-identifier auth (§7). Captured as **ADR-016**.

---

## 1. Architectural style — modular monolith (ADR-001, ADR-002)

One deployable Node/Express + GraphQL process. Internally split into **modules** with hard boundaries:

```
foundation   — auth, roles/permissions, org (year/class/section/subject), student roster, guardian + linkage
content      — content tree, envelope import, plan storage (JSON + Markdown), versioning
questions    — question store, tagging, filter
assessment   — selection basket, HW/AS/CT assembly engine, set export
trackers     — class-test / assignment / homework + generic tracker pattern
delivery     — server-side Markdown→PDF, file-ref/Drive, wa.me link builder
platform     — events log, audit log, read-model projections, import-batch records
```

**Rule (ADR-002):** a module never reaches into another module's models. Cross-module work goes through the owning module's **service**. This is the seam that lets deferred modules (guardian portal, attendance, fees, …) attach without touching the core. Microservices were rejected: they multiply cost and ops burden against NFR-1/NFR-8 for no benefit at this scale.

---

## 2. Tech stack (concrete)

- **Runtime/server:** Node + Express; GraphQL layer on top (vendor open — ADR-003 / REQ §10 #10).
- **Client:** Expo — React Native for iOS/Android, React Native for Web (ADR-010).
- **DB:** MongoDB Atlas, M0 to start.
- **Shared:** `/shared` holds the envelope schema, controlled-vocabulary enums, the role→permission map, and **codegen output** (TS types + typed GraphQL hooks).
- **Files:** Google Drive (pointers in Mongo); **YouTube unlisted** for video (pipeline).
- **Messaging:** `wa.me` deep links now; WhatsApp Cloud API + local bulk-SMS later.
- **Hosting:** Oracle Always Free, else low-cost VPS (Bangalore/Mumbai).

---

## 3. API layer — GraphQL + codegen + thin HTTP (ADR-003, ADR-014)

- **GraphQL** is the primary contract: one endpoint, clients select exactly the fields a screen needs (helps NFR-6 over intermittent connectivity), schema evolves additively (helps NFR-3).
- **codegen** turns the schema into TS types and typed hooks in `/shared`; a schema change is a **compile-time break across all three clients**, not a runtime crash on a teacher's phone.
- **Thin HTTP surface** for what GraphQL is wrong for:
  - `GET /pdf/:docType/:id` → server-rendered PDF (binary).
  - `GET /file/:ref` → Drive redirect/stream for file refs.
  - `GET /healthz` `GET /readyz` → uptime probes.
- `wa.me` links are **built client-side** from a guardian phone + message; no server endpoint, no data in URLs beyond the deep link the staff member sends manually.

**Concrete stack (ADR-014).** Server = **GraphQL Yoga** on Express, schema via **Pothos** (code-first, type-safe), auth via **Envelop** plugins / Pothos auth-scopes — the centralized home for resolver authz (ADR-004). **graphql-codegen client-preset** emits client-agnostic `TypedDocumentNode`s into `/shared`. Client = **urql** (+ graphcache + offline exchange for the NFR-6 offline cache). Rationale: Yoga is lighter and free-tier-friendly where Apollo Server pulls toward a paid managed platform; the codegen client-preset keeps the client swappable, so **Apollo Client is the reserved fallback** if normalized-cache complexity (optimistic updates, paginated-list coordination) ever demands it.

---

## 4. Data architecture & the two planes (ADR-005)

**Document-per-aggregate** in Mongo; cross-aggregate links by id. Two **structurally separated** planes:

**Operational plane (identity lives here):**
```
users            (staff + guardians; role, credential ref)
guardians        (own collection; profile, auth)        ── many-to-many ──┐
students         (thin profile; NO login)  ◄──── guardian_links ──────────┘
classes / sections / subjects / academicYears
content_artifacts (envelope JSON + rendered_markdown + version + curation_tag + pinned_to)
questions
assessment_sets   (HW/AS/CT)
tracker_records   (classtest / assignment / homework / generic)
audit             (who-accessed-what; append-only; inside firewall)
import_batches
```

**Corpus/analytics plane (NO identity):**
```
events            (de-identified behavioral stream)
read_models       (materialized projections for analytics)
export_views      (reserved; JSONL projection for LLM training)
```

**The firewall (ADR-005):** the corpus/analytics plane has **no reference path** to `students`/`guardians`/`users`. Anything written to `events` is de-identified at write time (pseudonymous ids, no names/contacts). The export/analytics code physically cannot join back to identity. R-X8/R-AC4 become a property of the schema, not a promise.

**Guardian↔Student (ADR-013, ADR-016).** `guardian_links` is the join (guardian_id, student_id, relation). One guardian sees all linked children via a **child-switcher**; every guardian query is scoped through this join. **Access is uniform across linked guardians** (D-#8) — no per-guardian `access_level` column.

**Sections & keying (ADR-016, D-#1).** Every class auto-creates a default **"Main"** section. `assessment_sets`, `tracker_records`, and the events they emit are keyed to a **section**, not a bare class; teacher row-scope resolves through class→section. The UI hides the section picker until a class has more than one section, so single-section classes feel class-level. When 5B opens, no schema or scope change is needed.

---

## 5. The content artifact — envelope storage (ADR-006, Option B)

Each imported plan/question is stored as the **unified envelope**: stable outer fields (doc_type, subject, class_level, address, provenance, pinned_to, curation_tag, controlled-vocab tags, review_status) + `payload` (the Project-03 structured schema) + `rendered_markdown` (co-generated by Project 03's renderer).

- **The app never runs `render_plan.py`.** Display and PDF use `rendered_markdown`. Structure, filter, and analytics use `payload`. This keeps Project 03 the single layout authority and keeps the author/publisher seam clean.
- **Versioning:** new version = new document; prior retained; `current` flag flips. No in-place edits (mirrors curriculum supersede-and-archive, and satisfies R-X3).
- **Import (platform module):** validate envelope (schema + custom checks, executed not self-graded) → on pass, write artifact + an `import_batches` audit row + an `events` row (`content_imported`, de-identified). On fail, reject with the failing checks. REF-21 lexicon hook sits here, parked.

---

## 6. Event-sourced-lite backbone (ADR-007, ADR-008)

- **`events`** — append-only, write-once domain facts: `content_imported`, `questions_selected`, `set_assembled`, `tracker_recorded`, … with actor-as-pseudonym, timestamp, and enough context to reconstruct the decision. This is the analytics source **and** the future training signal.
- **read-models** — materialized projections rebuilt from `events` for analytics (weak-spot, Bloom balance, item analysis, trending). Heavy jobs run off-peak / post-export to protect M0 uptime.
- **Events lifecycle — export-then-prune (ADR-016, D-#2):** because `events` are immutable, a scheduled job exports aged rows to Drive as **JSONL** (the same artifact `export_views` consumes — capacity management and the R-X9 training export are one pipeline), then deletes them from M0. A rolling window (current + prior academic year) stays hot; older data lives in Drive. Corpus stays complete; M0 stays lean and uptime-safe.
- **`audit`** (separate, ADR-008) — security/access facts that *do* reference identity (logins, PII reads, permission-checked actions, exports). Lives in the operational plane **inside the firewall**; append-only; Principal-readable; never edited; never exported to training. Lean rows + retention/rotation to bound growth.

The two logs answer different questions — `events` = "what pedagogy happened," `audit` = "who touched what" — and must not be merged, or the corpus inherits PII.

---

## 7. Access control architecture (ADR-004)

- **Action-level RBAC**, default-deny, role→permission map in `/shared`, hardcoded now / data-drivable later.
- **Resolver-level enforcement (ADR-004):** every GraphQL resolver checks permission **and** row-scope **and** the plane boundary before resolving. Returning an entity must not let a client walk a relation it isn't entitled to (e.g., a guardian resolving from their child to another family). Authz is centralized in resolver middleware/directives, not scattered ad hoc.
- **Row-scope:** teacher → own classes/sections; guardian → linked children via `guardian_links`.
- **Plane boundary in code:** analytics/export resolvers are wired to the corpus plane only; they have no resolver path to identity types. The **fail-closed firewall test** (ADR-012) asserts this by trying to resolve identity from the export path and requiring it to fail.
- **Authentication (ADR-016):** staff = email/password + email reset link (D-#5); guardian = flexible identifier (email / school unique-ID / phone) + password, with manual office reset for non-email guardians until SMS lands (D-#9). Passwords hashed; credentials live in the operational plane only, never the corpus plane.

---

## 8. Content rendering & PDF (ADR-009)

- **One** server-side **Markdown→PDF** generator (the only place Bangla typography is solved). Inputs: `rendered_markdown` + a print stylesheet (bundled Bangla font). Output: classroom-clean PDF for plans and assembled sets.
- All three clients fetch the same PDF via the thin HTTP surface (§3) — no per-platform print code, no RN CSS-print gap.
- **Prove Bangla PDF in Phase 0** (known failure point); it gates the print-fidelity NFR.

---

## 9. Cross-platform delivery (ADR-010)

- **Expo monorepo:** `/app` (RN screens, shared across iOS/Android/Web), `/server`, `/shared`.
- **Offline cache** (NFR-6): GraphQL client cache + persisted queries for plans and assembled sets so classroom use survives a dropped connection.
- **Bangla fonts bundled** in `/app` (no reliance on device fonts).
- **Distribution:** internal (Expo internal dist / TestFlight / direct APK) first to defer store fees; public stores when ready (REQ §10 #6).

---

## 10. External integrations

- **Drive:** app stores `FileRef` (id, name, mime, link); binaries never in Mongo; Drive also the backup target.
- **YouTube unlisted:** link in Mongo (video review, pipeline).
- **WhatsApp:** client-side `wa.me` builder now; Cloud API later. **No unofficial libraries.**
- **SMS:** local Bangladeshi gateway, later.

---

## 11. Reliability & backup (ADR-011)

- **Daily Atlas→Drive export** of structured records (ADR-016, D-#7a), with snapshot rotation (e.g. 7 daily / 4 weekly / a few monthly) against the 100 GB Drive.
- **Restore drill** is part of the requirement — an untested backup is not a backup. Document the restore procedure and run it before relying on it.
- **Graceful degradation:** if a free tier throttles, reads (cached content/plans) keep working; writes queue or surface a clear retry.
- Define a **capacity upgrade trigger** (M0 / Always-Free limits) and the migration path before the limit bites.

---

## 12. Testing & CI architecture (ADR-012, ADR-015)

**Packages (ADR-015).** `/app` — **Jest + `jest-expo` preset + React Native Testing Library** (`jest-expo` is Expo's official preset; it mocks the native SDK and runs iOS/Android/web/node). `/server` — **Jest + Supertest** exercising the executable GraphQL schema through resolvers. **Maestro** for the thin mobile e2e layer. One runner (Jest) repo-wide for solo-maintainability; **Vitest reserved as a server-only option** if suites get slow. Config note: keep the test runner in **CommonJS** even if app code is ESM — the RN native pipeline expects CJS under test.

- **Unit:** assembly engine (HW/AS/CT), envelope validator, permission map, de-identification at the `events` write.
- **Integration:** import pipeline end-to-end (envelope → artifact + audit + event), resolver authz with row-scope, tracker → `wa.me` non-submitter flow.
- **e2e (thin):** 3–4 critical journeys — import a plan and view it; filter questions → assemble a CT → export PDF; record a tracker; guardian (when present) sees only their child.
- **Fail-closed firewall test:** the export/analytics path attempts to resolve student/guardian identity and **must fail**. This test passing-by-failing is the enforcement of R-X8.
- **Bangla PDF smoke test:** render a known plan, assert Bangla glyphs present and layout intact.
- **CI gate:** all of the above green before deploy.

---

## 13. Extensibility — how a new module attaches (ADR-002)

A deferred module (e.g., guardian portal screen, attendance, fees) ships by: adding its **models** in its own module, exposing a **service**, extending the **GraphQL schema** additively (codegen regenerates types), wiring **resolvers with authz**, and — if it produces domain facts — emitting **`events`** and writing **`audit`** on identity access. No core rewrite; the boundaries in §1 hold.

---

## 14. Future, reserved not built

- **Data-analysis projections** (read-models) — schema-ready via `events`; build dashboards later.
- **LLM export** — `export_views` JSONL projection behind the firewall; provider-agnostic AI layer (Claude for design/policy-sensitive, Gemini for high-volume) parked.
- **Deferred ops modules** per REQ §9.

---

## 15. Decision log (ADR-style; append-only)

ADR-001 … ADR-016 above are the locked architectural decisions for this doc (**ADR-016** appended in v0.3, folding REQ §10's resolved open decisions into the model/ops). Future changes append new ADRs (out-of-order numbering acceptable) and never rewrite a locked one; supersede with a new ADR that references the old. Mirrors the curriculum DECISIONS.md discipline, kept in this repo, separate from curriculum governance.
