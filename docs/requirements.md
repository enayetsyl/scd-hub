# School Software — Raw Requirements

**Doc ID:** SCHOOLSW-REQ · **Version:** v0.6 (baseline) · **Status:** DRAFT · **Owner:** Principal
**Scope note:** This is a standalone initiative. It is NOT a curriculum Project REF and must not be folded into curriculum governance. The curriculum Projects remain the *author*; this software is the *publisher + system of record + delivery + tracking* layer.

**Revision note (v0.5 → v0.6):**
- **All open decisions #1–#9 resolved (#10 closed earlier).** §10 is now a resolved register. Firm choices folded into the body:
  - **#1 Per-section keying** — sets/trackers scoped to a section; default "Main" section auto-created per class; UI hides the picker for single-section classes (§3 R-A5/R-T, §5 R-AC3).
  - **#2 Events export-then-prune** — immutable events → Drive as JSONL on schedule (doubles as R-X9 export), aged rows pruned from M0; recent window kept hot (§6).
  - **#3 `review_status` adopted** (§4, §6).
  - **#4 REF-21 scan advisory-only** — logs flags, never blocks; curation authority stays upstream (§4 R-IMP4).
  - **#5 Staff email/password + reset link; #9 Guardian flexible identifier (email/unique-ID/phone) + password** (§5 R-AC9).
  - **#6 Internal-first distribution** (NFR-1). **#7 daily backup + rotation; audit log ~2 yr** (NFR-2, R-AC7).
  - **#8 Uniform guardian access** per linked child; per-guardian `access_level` dropped (§5 R-AC5).

**Revision note (v0.4 → v0.5):**
- **GraphQL stack chosen — closes open #10:** **Yoga + Pothos + Envelop** (server), **graphql-codegen client-preset**, **urql** client (Apollo Client reserved fallback) — R-API4, §8. See ARCHITECTURE ADR-014.
- **Testing packages recorded:** Jest repo-wide — `jest-expo` + RNTL (`/app`), Jest + Supertest (`/server`), Maestro (e2e) — NFR-11. See ARCHITECTURE ADR-015.

**Revision note (v0.3 → v0.4):**
- **API layer settled:** **GraphQL + codegen** as the primary client↔server contract, with a **thin non-GraphQL HTTP surface** for PDF download, file refs, and health checks — §4A, §8.
- **Resolver-level authorization** named as the carrier of RBAC/PoLP and the firewall — R-AC8, NFR-11.
- (v0.2→v0.3 changes retained: unified typed envelope; Option B Project-03 ingestion; Guardian authenticated role + many-to-many + child-switcher; two-plane access; events vs audit logs; data-analysis/LLM split; code-level testing.)

---

## 0. Summary checklist (read first)

- [ ] **First-priority build:** content store/display + question filter/selection → HW/AS/CT + built-in trackers.
- [ ] **Delivery:** iOS, Android, Web from ONE React Native (Expo) codebase.
- [ ] **API:** **GraphQL + codegen** (typed contract across all three clients) + a thin HTTP surface for PDF/files.
- [ ] **Single ingestion seam:** one **unified typed JSON envelope**; `doc_type` selects the payload. Manual import only.
- [ ] **Project-03 content imported as JSON + co-generated Markdown; app never re-renders.**
- [ ] **Roles:** Principal, Teacher, Office, **Guardian** (authenticated). Student is **data only**.
- [ ] **RBAC + PoLP + row-scope**, enforced at the **resolver** layer; **two access planes**; **PII firewall** on the corpus side.
- [ ] **Two logs:** `events` (behavioral, corpus) and `audit` (access, inside firewall).
- [ ] **Design for data analysis (near-term) and LLM training (long-horizon)** from the start.
- [ ] **Automated testing + CI** baked in. **Cost-minimal, uptime non-negotiable.** Bilingual.

---

## 1. Goal

A single, modular application — native Android, native iOS, and a web app from one codebase — that stores and serves authored curriculum content, lets teachers assemble assessment sets, runs the day-to-day trackers, and (later) gives guardians a portal into their children's school life. Built so that (a) deferred modules slot in without re-architecting, (b) the accumulated data supports near-term analytics and a long-horizon school-specific LLM, and (c) sensitive identity data is structurally walled off from the training corpus.

---

## 2. Actors & roles

| Actor | Authenticated? | In first-priority build? | Notes |
|---|---|---|---|
| Principal | Yes — super-admin | Yes | Full visibility; user/role management; reads (never edits) the audit log. |
| Teacher | Yes — staff | Yes | Row-scoped to **own classes** only. Consumes content, assembles sets, fills trackers. Authors nothing in-app. |
| Office/Admin | Yes — staff | Yes | Roster, guardian linkage, complaint intake, messaging dispatch. |
| **Guardian** | **Yes — portal** | **Account + linkage in build; portal screens land with their modules** | Reads only **their linked children's** data. Broad surface (mostly deferred): routine, homework + how-to-guide docs, attendance report, fees report, push notifications, notices, leave application. |
| Student | **No — data only** | Yes (as a profile) | Has a profile; **no login**. Keeps the minor-safety posture (no unsupervised student-facing access). |

**Guardian–Student is many-to-many:** one guardian → many children; one child → many guardians (father, mother — **uniform access** per linked child, D-#8). Guardian is **its own collection**, not embedded in Student; every guardian screen is scoped through a **child-switcher**.

---

## 3. First-priority functional requirements (build now)

### REQ-CONTENT — Chapter & session-plan repository
- **R-C1** Store the content tree: Subject × Class → Chapter → Lesson (session) → Session/Lesson plan.
- **R-C2** Ingest via the unified envelope (§4). Project-03 content carries **both** the structured payload **and** the **co-generated Markdown** (`rendered_markdown`).
- **R-C3** The app **never re-renders** plans from JSON. Markdown is the display/print source; JSON is for structure, filtering, analytics, corpus (Option B — preserves Project 03's single layout authority).
- **R-C4** Display: browse the tree, open a chapter, open a session plan — all three clients.
- **R-C5** Filter/search by subject, class, chapter, lesson, curation tag.
- **R-C6** Download/view/print/share a session plan as a **server-generated PDF**, produced **Markdown→PDF** (Bangla correct). One PDF implementation serves all clients.
- **R-C7** Versioned content: supersede, never overwrite; carry `pinned_to` and `curation_tag`.
- **R-C8** Retain source form (envelope JSON + Markdown) distinct from any derived render.

### REQ-QBANK — Question bank with filters
- **R-Q1** Store questions tagged: subject, class, chapter/lesson, type, Bloom level, difficulty, marks.
- **R-Q2** Ingest via the **same** envelope (`doc_type = question`).
- **R-Q3** Filter/search by any combination of tags.
- **R-Q4** Question list with tag chips; preview.

### REQ-ASSEMBLE — Teacher question selection → sets
- **R-A1** Select questions from filtered results into a working basket.
- **R-A2** Assemble into a **set**: HW / AS / CT.
- **R-A3** One shared assembly engine; per-type metadata/output (CT: marks/duration; HW/AS: due date).
- **R-A4** Export/print a set as a server-generated PDF (R-C6).
- **R-A5** Sets scoped to a **section** and a date. Every class has a default "Main" section; the section picker is hidden in the UI until a class has more than one section (D-#1).
- **R-A6** Every selection/assembly logged to `events`.

### REQ-TRACK — Built-in trackers
- **R-T1** Class-test tracker: scores per student per CT set.
- **R-T2** Assignment tracker: status per student; **non-submitters** → guardian `wa.me` message (manual send).
- **R-T3** Homework tracker: completion per student.
- **R-T4** Generic tracker pattern so later trackers plug in without a new subsystem.
- **R-T5** Each tracker: list, filter, export.
- **R-T6** Outcomes logged to `events`.

---

## 4. Import contract — Unified typed envelope (RATIFIED)

**R-IMP1** All authored content enters through **one** envelope: a **minimal, stable outer contract** + a **free-form `payload` selected by `doc_type`**. Manual import only this phase.

**Outer contract (stable across all doc types):** `schema_version`; `doc_type` ∈ {`chapter_plan`,`session_plan`,`question`,`question_set`, … extensible}; `subject`, `class_level`, address block (`division`/anchor as Project 03 uses); **provenance** (source Project, import batch id, author, content version, timestamps); `pinned_to`; `curation_tag` ∈ {`KEEP_AS_IS`,`NEEDS_REPLACEMENT`,`FLEXIBLE`}; controlled-vocab tags; `review_status` (gold/reviewed vs draft — **adopted**, D-#3); `payload`; `rendered_markdown` (required for plan doc types).

**R-IMP2** The plan payload schema is **one evolving schema across C1–C5** (not per-class variants); the app tracks its `schema_version`.

**R-IMP3** Import is **validated at the boundary** (schema layer + custom-check layer, mirroring the Project-03 validator philosophy — executed checks, not self-graded). Invalid → rejected; valid → an `ImportBatch` audit record is created.

**R-IMP4** REF-21 lexicon-scan hook lives at this seam, **advisory-only** (D-#4): on import it records flags to the `ImportBatch` + audit and surfaces them to the importer (and may inform `review_status`), but **never blocks**. Curation authority stays upstream in the curriculum Projects; the app is a publisher, not a curation gate.

**R-IMP5** Project 04/05 emitting JSON in this envelope is a **cross-Project alignment item** (coordination, not governance-folding).

## 4A. API layer — GraphQL + codegen (SETTLED)

**R-API1** The primary client↔server contract is **GraphQL**, with **codegen** generating TypeScript types + typed client hooks from the schema, shared via `/shared`. A schema change becomes a compile-time break across all three clients, not a runtime failure.

**R-API2** A **thin non-GraphQL HTTP surface** carries what GraphQL is wrong for: **PDF download** (binary), **file-ref/Drive** redirects, and **health/readiness** checks. (`wa.me` deep links are client-side, not a server endpoint.)

**R-API3** **Authorization is enforced in resolvers** (see R-AC8), field- and edge-aware — because a GraphQL client can request any field/relation in the graph. Resolver authz is a first-class design item, not an afterthought.

**R-API4** GraphQL stack **chosen** (closes §10 #10): **GraphQL Yoga** + **Pothos** + **Envelop** (server), **graphql-codegen client-preset**, **urql** client (+ graphcache/offline exchange); **Apollo Client** reserved as fallback. The pattern (schema-first + codegen + resolver authz) is preserved; see ARCHITECTURE ADR-014.

---

## 5. Access control, roles & data planes

**R-AC1 RBAC, action-level.** Permissions are actions (`content:read`, `question:select`, `set:assemble`, `tracker:write`, `roster:manage`, `guardian:link`, `user:manage`, `audit:read`, …), mapped to roles. **Default-deny.** Map lives in `/shared`. **Hardcoded now; data-drivable later** (no permission-admin UI in the build).

**R-AC2 PoLP.** Each role gets the minimum needed; no blanket access "for convenience."

**R-AC3 Row/scope-level access (not just role-level).** Teacher → only own **classes/sections**; Guardian → only linked children, permitted slices. Enforced in the data layer, not just the UI.

**R-AC4 Two access planes (structural).**
- **Operational plane** — staff + guardians; row-scoped; sees identity as permitted.
- **Corpus/analytics plane** — artifacts + **de-identified** events only; **structurally denied** the student/guardian identity collections. This is how the PII firewall (R-X8) is *enforced*.

**R-AC5 Guardian portal boundary.** Guardians read their children's operational data; nothing identity-side ever flows into the corpus/training export; guardians never see staff-internal views or the audit log. **Access is uniform across all guardians linked to a child** (no per-guardian level; the `access_level` field on the link is dropped — D-#8).

**R-AC6 Two distinct logs.** `events` (behavioral/domain — corpus signal, de-identified on the corpus side) vs `audit` (security/access — who accessed/changed what; references identities; **inside the firewall**; never in a training export).

**R-AC7 Audit log append-only + read-restricted.** No role edits it; Principal may read; guardians never see it. Logged lean (actor, action, target-ref, timestamp); **retained ~2 years, then rotated** (D-#7b).

**R-AC8 Resolver-level authorization.** Every GraphQL resolver enforces RBAC + PoLP + row-scope + the plane boundary. A resolver returning an entity must not let a client traverse a relation it isn't entitled to. The **fail-closed firewall test** (NFR-11) runs against resolvers: the corpus/analytics path must be *unable* to resolve identity.

**R-AC9 Authentication & recovery.** **Staff** (Principal/Teacher/Office): email + password, recovery via email reset link (D-#5). **Guardian:** a flexible identifier — **email *or* school-issued unique ID *or* phone number** — plus password (D-#9). Automated recovery (reset link) works for guardians registered with an email; unique-ID/phone-only guardians use **office/Principal-issued manual reset** until the SMS gateway lands (deferred). Passwords hashed; no plaintext; credentials never in the corpus plane.

---

## 6. Cross-cutting — Data analysis (near-term) + LLM training corpus (long-horizon)

One **event-sourced-lite backbone** (append-only `events` + materialized read-models) serves operational features, near-term analytics, and long-horizon export. Capture the shape now; build consumers later.

**Near-term data analysis** (pipeline-built): **R-AN1** weak-spot detection; **R-AN2** Bloom's-balance audit; **R-AN3** item analysis; **R-AN4** score/observation trending. Runs on a **separate projection**; heavy jobs off-peak/post-export to protect uptime on M0.

**LLM training corpus** (design now, export later): **R-X1** lossless source retention (envelope JSON + Markdown); **R-X2** provenance; **R-X3** versioning, no in-place edits, tombstone-not-delete; **R-X4** structured task pairs (context↔content separable); **R-X5** behavioral signal via `events`; **R-X6** controlled vocabulary; **R-X7** quality flags (`review_status`, **adopted** — D-#3, lets export filter to reviewed content); **R-X8** PII firewall (hard rule, enforced by R-AC4/R-AC8); **R-X9** reserved JSONL export projection behind the firewall.

**R-X10 Events lifecycle — export-then-prune (D-#2).** `events` are append-only and immutable, so they are periodically exported to Drive as JSONL (the same artifact R-X9 consumes) and the aged rows pruned from M0. A rolling recent window (current + prior academic year) stays hot in M0 for analytics; everything older lives in Drive. Nothing is lost — the corpus is complete in Drive while M0 stays lean and uptime-safe.

---

## 7. Non-functional requirements

- **NFR-1 Cost** — prefer free/always-free tiers; cost-minimal, never at the expense of uptime. **Distribution is internal-first** (Expo internal dist / TestFlight / direct APK) to defer store fees (Apple ~$99/yr; Google ~$25 one-time); publish to stores later (D-#6).
- **NFR-2 Uptime/reliability** — high availability; graceful degradation; **daily Atlas→Drive backup** with snapshot rotation (e.g. 7 daily / 4 weekly / a few monthly) and a **tested restore drill** (D-#7a). A backup that hasn't been restore-tested is not a backup.
- **NFR-3 Modularity/extensibility** — modules add without core rewrites; stable internal contracts; feature flags; services-only cross-module calls.
- **NFR-4 Security/privacy** — RBAC + PoLP (§5); least privilege; secrets server-side; transport encryption; the two logs.
- **NFR-5 Localization** — Bangla labels + English codes; correct Bangla typography on screen/print/PDF; **Bangla fonts bundled in the mobile app**.
- **NFR-6 Low-bandwidth tolerance** — light pages; **mobile offline caching** of plans + assembled sets; GraphQL field-selection minimizes over-fetch; download/print survives intermittent connectivity.
- **NFR-7 Print fidelity** — single server-side **Markdown→PDF** generator shared by all clients.
- **NFR-8 Maintainability** — solo/small-team friendly; conventional patterns; documented envelope + decision log. (GraphQL+codegen adds moving parts — accepted for the typed-contract payoff.)
- **NFR-9 Islamic alignment of the product surface** — UI, icons, sample data, imagery conform to Islamic values.
- **NFR-10 Cross-platform delivery** — iOS, Android, Web from one React Native codebase; consistent behavior/data.
- **NFR-11 Automated testing + CI** — **code-level**: unit, integration, thin e2e over critical flows; CI gate before deploy. Depth where logic is dense/costly: **import validator, assembly engine, RBAC/PoLP + resolver authz, a fail-closed firewall test (export/analytics path must be unable to resolve identity), Bangla PDF smoke test.** Exhaustive UI tests deprioritized early. **Packages:** Jest repo-wide — `jest-expo` + React Native Testing Library (`/app`), Jest + Supertest over the executable schema (`/server`); **Maestro** for thin mobile e2e. (Vitest reserved as a server-only option if suites slow.)

---

## 8. Constraints & assumptions

- Stack: **MERN**, where "R" = **React Native (Expo + RN for Web)** → iOS + Android + Web from one codebase; **MongoDB Atlas (M0 start)**; Express/Node backend; **GraphQL (Yoga + Pothos + Envelop) + graphql-codegen client-preset; urql client** as the API layer with a thin HTTP surface (PDF/files/health); Google Drive (files); YouTube unlisted (video, pipeline); Oracle Always Free / low-cost VPS (Bangalore/Mumbai).
- Monorepo: `/server` (Express/Node + GraphQL), `/app` (Expo RN), `/shared` (envelope schema, controlled-vocab enums, role→permission map, codegen output).
- Build from scratch; existing PHP/MySQL SIS mined for domain models only, not code.
- **No AI API in-app** this phase; content authored in Claude desktop, entered by manual import.
- Author and publisher systems run in parallel up to ~2 years.
- Solo/small dev capacity assumed.

---

## 9. Scope boundary

**In (now):** REQ-CONTENT, REQ-QBANK, REQ-ASSEMBLE, REQ-TRACK; unified envelope (§4); GraphQL+codegen API (§4A); RBAC/PoLP + resolver authz + two-plane access + both logs (§5); corpus backbone; thin foundation (accounts/roles incl. **Guardian account + child linkage**, classes/sections, subjects, thin student roster). Delivery: iOS, Android, Web.

**Pipeline (architecture-ready, not built now):** Guardian portal screens (routine, homework + how-to-guide docs, attendance report, fees report, push, notices, leave application); near-term data analysis (R-AN1–4); AI layer activation + training-export tool; video review vs REF-11; vocabulary & complaint trackers (full); WhatsApp Cloud API + SMS automation; deferred ops modules (attendance, comms, notices, fees, expenses, payroll, routine, leave, exam/results, loanable-resource = library + asset register).

---

## 10. Decision register (all resolved)

*Append-only. Each row is a settled decision; the body sections above are the authoritative expression.*

| D | Decision | Resolution |
|---|---|---|
| #1 | Sets/trackers keying | **Per-section.** Default "Main" section auto-created per class; UI hides picker for single-section classes. (§3 R-A5, §5 R-AC3) |
| #2 | `events` retention on M0 | **Export-then-prune** to Drive as JSONL; recent window (current + prior year) hot. (§6 R-X10) |
| #3 | `review_status` on envelope | **Adopted** (gold/reviewed vs draft). (§4, §6 R-X7) |
| #4 | REF-21 scan at import | **Advisory-only** — flags, never blocks; curation stays upstream. (§4 R-IMP4) |
| #5 | Staff auth + recovery | **Email/password + reset link.** (§5 R-AC9) |
| #6 | App distribution | **Internal-first**; defer store fees. (NFR-1) |
| #7a | Backup cadence | **Daily** + rotation + restore drill. (NFR-2) |
| #7b | Audit log retention | **~2 years**, then rotate. (§5 R-AC7) |
| #8 | Guardians per child | **Uniform access**; per-guardian `access_level` dropped. (§2, §5 R-AC5) |
| #9 | Guardian auth | **Flexible identifier (email / unique-ID / phone) + password**; manual reset fallback. (§5 R-AC9) |
| #10 | GraphQL stack | **CLOSED:** Yoga + Pothos + Envelop + graphql-codegen client-preset + urql (Apollo Client fallback). (ARCHITECTURE ADR-014) |

*No open decisions remain. New decisions append below as D-#11+.*
