# PRD — Message Templates (MT-… channel)

**Status:** Planned · build contract (slices MT-1..MT-3)
**Owner:** Principal (sponsor); build agent (executor)
**Plane:** Identity / operational (ADR-005 — no corpus path)
**Contract impact:** App-native `/shared/vocab.ts` additions only — **no import-envelope / harness three-place sync**
**Source decisions:** D-#128, D-#129, D-#130, D-#131 _(renumbered at commit from the handoff's proposed D-#117–#120 — those were already taken on main by HR-5 [#117/#118] + Class-Test [#119/#120]; CT-self gaps #114/#115/#123/#124 went to the Comments/Meetings PRD, so MT slots into the next free run #128–#131, clear of in-flight VC #132+ and HR-app #135+ — pre-flight wins)_
**Supersedes:** message wording hard-coded across each feature (no single source; a copy change needs a code edit + deploy)

## At a glance
One admin-editable registry for **every generated message body** the app sends — guardian wa.me text, in-app notification title + body (per `NOTIFICATION_KIND`), and staff-facing notification bodies. Each message ships a **code default** (today's wording, lifted verbatim); an admin edit is an **override row** that wins at read-time; **reset** drops the override back to the default (the D-#97/#103 "default-in-code, admin-row-wins, no seed write" posture). Editing is **Principal-only** (`template:manage`), **audited**, and **placeholder-validated** so a typo can't reach a recipient. Per-template language mode **BN / EN / both**. Free-form *authored* messages (staff chat M-1..M-7, the M-6 guardian-notice composer) are **out of scope** — only generated bodies.

---

## 1. Goal
Move every generated message body out of code and into one editable registry so the Principal can change wording without a developer, while guaranteeing (a) zero behaviour change on adoption (defaults are the current strings verbatim), (b) Principal-only, audited edits, (c) placeholder safety (an edit can only use the blanks a message actually provides), and (d) per-message Bangla/English/both control — across all currently-live generated-message sites in one migration, with future features (e.g. Class Test) built directly on the registry.

## 2. Gap table

| Capability today | How it works now | App replacement | Slice |
|---|---|---|---|
| Wording lives in code at each site | Bangla strings inline in the vocab/assignment/library/attendance/credential emitters (and staff notification bodies) | One `MessageTemplate` registry; code default + admin override resolved at read-time | MT-1 |
| Changing a word | Code edit + review + deploy | Principal edits in-app; takes effect immediately | MT-1/MT-3 |
| No edit safety | A bad string ships silently | Edit-time placeholder validation + Principal-only permission + audit of prior body | MT-1/MT-3 |
| No language control | Whatever is hard-coded (Bangla) | Per-template BN / EN / both (default BN) | MT-1/MT-2 |
| Each new feature re-bakes its own strings | e.g. Class Test would ship inline templates | New features call `renderTemplate(key, params)` directly | MT-2 |

## 3. Data model

### 3.1 Vocab additions (app-native — D-#128/#129/#130)
- `MESSAGE_TEMPLATE_KEYS` — a controlled enum, **one key per message variant** (e.g. `vocab.result.regular`, `vocab.result.perfect`, `vocab.result.absent`, `assignment.chase.tier1`, `attendance.reminder.tier1`, `library.overdue`, `credential.share`, …). Each key declares **in code, as data**: its allowed placeholder set, its default Bangla body, an optional default English body, and its default language mode. The verifier asserts every key has a code default and every `renderTemplate` call references a known key.
- `TEMPLATE_LANGUAGE_MODES = [BN, EN, BOTH]` (+ `*_LABELS_BN`). Default `BN`.
- New permission `template:manage` (PRINCIPAL only) — verifier-proven exact-holder set (the `payroll:approve` / `performance:signoff` posture).
- One new audit kind `MESSAGE_TEMPLATE_EDITED` in `platform/models/Audit.ts` (NOT vocab) — records the prior body (the D-#101 `MESSAGE_EDITED` pattern).

### 3.2 Code default registry (MT-1)
A static, code-shipped map: `key → { placeholders: string[], bnDefault: string, enDefault?: string, defaultLangMode }`. This is the "printed page" — never written to the DB. The **defaults are the current inline strings lifted verbatim** during MT-2 (so adoption is behaviour-neutral).

### 3.3 `MessageTemplate` — the admin override (MT-1)
`{ schoolId, key ∈ MESSAGE_TEMPLATE_KEYS (unique per school), bnBody?, enBody?, langMode ∈ TEMPLATE_LANGUAGE_MODES, updatedBy, updatedAt }`. Exists **only when the Principal has edited** that key (the "sticky note"). Absent ⇒ the code default is used (`isDefault: true` surfaced to the UI). No startup/seed write ever runs (D-#97/#103).

### 3.4 Resolver & renderer (MT-1)
- `getEffectiveTemplate(key)` → the admin row if present, else the code default; flags `isDefault`.
- `renderTemplate(key, params, recipientCtx?)` → resolves the effective template, **validates that `params` covers the placeholders**, interpolates, and emits per `langMode`: `BN` → Bangla; `EN` → English; `BOTH` → Bangla then English in one body. A declared placeholder missing at render → rendered blank (defensive, never throws).

## 4. Edit safety rules
- **Principal-only.** Edit + reset gated by `template:manage` (PRINCIPAL only) — a distinct permission the verifier proves (not a resolver role-check).
- **Placeholder validation at edit time.** A submitted body may use **only** the placeholders that key declares; an unknown placeholder ⇒ Bangla `422` naming the allowed set. This is the safety net that stops a typo reaching a recipient.
- **Language guard.** A template cannot be set to `EN` or `BOTH` while its English body is empty (blocks an empty-English send).
- **Audited.** Every edit writes `MESSAGE_TEMPLATE_EDITED` with the prior body first, then stamps `updatedAt` (append-only, ADR-008).
- **Reset-to-default.** Deleting the admin row (`template:manage`) restores the code default instantly; audited as an edit.

## 5. RBAC
One **new permission** `template:manage` (PRINCIPAL only). This is a deliberate addition — the trackers composed existing permissions (D-#94), but a registry that edits live message wording is a genuine new admin surface, and Principal-only is a hard requirement best expressed as a verifier-proven permission (the `payroll:approve` precedent). No other role gains it; no other permission changes.

## 6. Slices (build order — **Next = build MT-1 per §6, slice order**)
- **MT-1 (server):** vocab additions (`MESSAGE_TEMPLATE_KEYS` + per-key placeholder/default/lang declarations as data, `TEMPLATE_LANGUAGE_MODES`, `template:manage`, `*_LABELS_BN`) + verifier section (every key has a default; OFFICE/PRINCIPAL exact-holder set for `template:manage`); the code default registry; `MessageTemplate` override model; `getEffectiveTemplate` + `renderTemplate` (interpolate + langMode + placeholder validation); edit/reset resolvers (`template:manage`) + `MESSAGE_TEMPLATE_EDITED` audit; firewall test extended (corpus ↛ message-template).
- **MT-2 (server):** the **big-bang migration**. **Inventory every in-scope generated-message call site** against live code — the guardian/mixed sites (vocab result, assignment chase, library overdue, attendance reminder, credential-share) **and** staff notification bodies (cover-assigned, leave-decided, etc.) **and** in-app notification titles+bodies per `NOTIFICATION_KIND`. For each: register its current inline string as that key's **verbatim code default**, then swap the site to call `renderTemplate(key, params)`. Acceptance = byte-identical output for every default (no admin override) — adoption changes nothing visible. Out of scope for the swap: free-form chat (M-1..M-7) and the M-6 guardian-notice composer.
- **MT-3 (app):** MessageTemplateList (all keys, grouped by feature, default/overridden badge) · MessageTemplateEdit (BN body, EN body, `langMode` BN/EN/both toggle, allowed-placeholder chips, **live preview rendered with sample values** e.g. "Karim"/"Math", Bangla validation errors, edit history, **Reset-to-default**). Principal-only (`template:manage`). UI per D-#61.

## 7. Journeys (Given/When/Then)
- **J1 — Edit a message.** Given the Principal (`template:manage`), when they edit a template's Bangla body using only its allowed placeholders, then the override is saved, audited, and that wording sends from then on.
- **J2 — Blocked typo.** Given an edit using a placeholder the message doesn't provide, when submitted, then it's rejected with a Bangla error naming the allowed placeholders; nothing is saved.
- **J3 — Reset.** Given an edited template, when the Principal taps Reset, then the override row is deleted, the code default returns instantly, and the reset is audited.
- **J4 — Language.** Given a template, when the Principal sets it to English or both (and the English body is filled), then sends use that language; an empty English body blocks the switch.
- **J5 — Adoption is silent.** Given the migration with no admin overrides, when any migrated site sends, then the output is byte-identical to before.
- **J6 — New feature.** Given a future feature (e.g. Class Test), when it sends a message, then it calls `renderTemplate(key, …)` against a registered default — no inline string, no later migration.

## 8. Out of scope
Free-form **authored** messages — the M-1..M-7 staff chat and the M-6 guardian-notice composer (typed by a human, nothing to templatise); SMS (no SMS transport exists); per-*recipient* language preference (the toggle is per-*template*, not per-guardian); machine translation (the English body is hand-written); importing/migrating historical sent messages; templating of curriculum/REF content (corpus plane, ADR-005).

## 9. Reused / unchanged
Default-in-code / admin-row-wins / read-time / no-seed-write (D-#97/#103); the prior-body audit pattern (D-#101 `MESSAGE_EDITED`); emit() seam + Notification kinds (D-#72); wa.me (ADR-003); append-only audit (ADR-008); verifier exact-permission-holder posture (`payroll:approve` / `performance:signoff`); own-row/no-new-permission pattern is *not* used here (this surface justifies a permission, D-#42 contrast); UI guidelines (D-#61); ADR-005 firewall.

## 10. Contract-sync note
**App-native vocab only** — `/shared/vocab.ts` additions (`MESSAGE_TEMPLATE_KEYS`, `TEMPLATE_LANGUAGE_MODES`, `template:manage`, labels) + the verifier section; **no import-envelope / harness wire sync**. Per AGENTS.md rule 5, `shared/vocab.ts` is **serialized**: other vocab-touching branches (VC-*, HR, Class-Test) may be mid-flight, so MT-1 **waits for the in-flight vocab owner to land, then rebases** before adding its enums/permission; the vocab verifier must print green in the build session before commit.

## 11. Traceability
**New:** D-#128 (adopt registry; scope = generated bodies; default-in-code/override/no-seed; controlled keys + per-key placeholders) · D-#129 (new `template:manage` permission, PRINCIPAL-only verifier-proven; audited; edit-time placeholder validation) · D-#130 (per-template BN/EN/BOTH language mode + the empty-EN guard + `renderTemplate`) · D-#131 (big-bang migration of all in-scope live sites; future features build on the registry directly).
**Referenced:** D-#31, D-#42, D-#61, D-#72, D-#94, D-#96, D-#97, D-#99, D-#101, D-#103, D-#107 (the migrated sites + the patterns reused) · ADR-003, ADR-005, ADR-008.
**Vocab refs (app-native):** `MESSAGE_TEMPLATE_KEYS`, `TEMPLATE_LANGUAGE_MODES`, `*_LABELS_BN`, permission `template:manage`.

## 12. Acceptance checklist (per slice — executed-verification gate)
- [ ] **MT-1:** vocab + verifier section green (every key has a default; `template:manage` exact-holder set); `MessageTemplate` override; `getEffectiveTemplate`/`renderTemplate`; edit-time placeholder validation; empty-EN guard; `MESSAGE_TEMPLATE_EDITED` audit; firewall green (corpus ↛ template).
- [ ] **MT-2:** every in-scope site inventoried + swapped to `renderTemplate`; each current string registered as a **verbatim** default; **byte-identical output** for all defaults (regression-proven); chat + guardian-notice composer untouched.
- [ ] **MT-3:** list/edit/preview-with-sample-values/langMode toggle/placeholder validation/edit history/reset render; Principal-only; UI per D-#61.
- [ ] Gate per slice: shared build + tsc, vocab verifier PASS, jest green, app tsc + expo web export green.
- [ ] No corpus/identity firewall regression.
