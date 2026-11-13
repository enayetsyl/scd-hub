# Overnight handoff — শিক্ষার্থী সহায়তা প্রোফাইল (student support profile)

Brief 15, cloud session, branch `claude/new-session-amfdao` (from `dev`; fast-forwarded to origin/dev
`4905bf82` before the first commit). Contract: `docs/prd-child-support-profile.md` **Revision 3**
(checked: §0.1 has the R3 table, §12 has CSP-7). No PR opened, nothing merged, no production access.
**The feature ships OFF** (`setSupportProfileSwitch`, LOCKED `support_profile:manage`).

How to read this file: one section per slice — first/last commit, what was built, verified (commands +
output tails), not done, decisions, questions. Live-code differences from the PRD are listed under
"Decisions" with the D-# row that records them.

General notes for every slice
- `npm run typecheck --workspace=server` needs `NODE_OPTIONS=--max-old-space-size=6144` in this
  container (it ran out of heap at the default; CI sets 4096). Not a code change.
- The owner's 13 Nov answers are built in: Q-18 batch day Thursday (reminder rule), Q-19 instant check
  OFF, Q-20 Mode B on the Principal's own chat with training off (said on the pack and the guide),
  Q-21 Mode A (CSP-7) after switch-on — so CSP-7 is not built in this session.
- Open owner items, NOT built: retention after a child leaves (Q-2 — nothing is auto-deleted), budget
  Q-15, the second safeguarding contact Q-16, who checks the Qur'an/hadith references and the Bangla
  wording Q-17.

---

## CSP-1 — model, permissions, scope, continuous intake (no AI), safeguarding route

**Commits:** first and last = the single `[CSP-1] feat(support-profile): …` commit (see `git log`).

**What was built**
- `shared/supportProfile.ts`: sections, statuses, sources, chips (antecedents, functions, skills,
  starter strategies), the 17-category rubric with families and severities, the two word lists, the
  safeguarding term list + signs + the five steps, `SUPPORT_THRESHOLDS`, `evidenceLevel()` (E-1…E-10),
  freshness / dormancy helpers, `goodThingCounts()`, the import reason codes.
- Models (`server/src/modules/support-profile/models/`): SupportProfile, SupportReport,
  SupportProfileVersion, SupportStrategy, SupportReview, SupportSeedPrompt, SupportSetting; and
  `platform/safeguarding/SafeguardingReferral` (outside the module, as §5.8 says).
- `currentSupportReaders` (pure core + loader), `supportCaller` / `accessToChild` (hard OFFICE/GUARDIAN
  refusal, "view as" rule, feature switch, refusal audit).
- Continuous intake: draft (≤ 3 per child), submit → `TO_PROCESS` with no AI; required fields incl. the
  good thing; block list refuses, ask list notes; another child's roster name refuses; date window;
  edit replaces text; withdraw; the author's list; the balance nudge (computed, not stored).
- Safeguarding: sign list → the question first; YES → referral + report routed with text emptied +
  immediate notice; NO → hold OPEN, pinned, same-day notice; always-present button (MANUAL referral);
  receiver screen query + mark seen / handled outside; hourly re-notice 07:00–17:00 Dhaka.
- The Principal's direct decision (approve / edit / return / not used) with `DECIDED_DIRECTLY`; hold
  resolution; NOT_USED text sweep after 30 days; profile open/close/reopen; card / full read with one
  audit row per open; the existence chip (not audited); the Principal's profile list (class + name).
- Catalogue: `support_profile` (view, report, view_all, approve, process, manage) + `safeguarding`
  (receive) with BN/EN labels in `shared/permissionCatalogue.ts`, `docs/permission-catalogue/README.md`
  and the new area file `students-support.md`; 19 audit kinds + labels; 2 notification kinds;
  `SupportProfileRefusal` / `SafeguardingRefusal` registered; scheduler family; firewall extended.

**Verified** (this session; logs in the scratchpad, tails pasted)
```
npm run build --workspace=shared                          → exit 0
npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json
                                                          → RESULT: PASS — all checks green
node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/lo-codes      → RESULT: PASS — all 22 lo-codes cases gate as intended
node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/subjects-2027 → RESULT: PASS — all 20 subjects-2027 cases gate as intended
node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/descriptive   → RESULT: PASS — all 11 descriptive cases gate as intended
node skills/_tools/verify_help_guides.mjs                 → ALL CHECKS PASSED (coverage report-only: 314 of 474 actions have a guide)
npx tsx skills/_tools/mastery_catalogue_to_json.mjs --check docs/mastery/lo-catalogue → RESULT: PASS — 11 catalogue files valid
npm run typecheck --workspace=shared                      → exit 0
npm run typecheck --workspace=server                      → exit 0
(app) npx tsc --noEmit                                    → exit 0
npx jest --runInBand supportProfileScope supportProfileAccess supportProfileAutoOpen supportReportForm
  supportIntake supportDirectDecision supportSafeguarding supportAudit permissionCatalogueGates firewall
  expectedErrorRegistry notificationsScheduler notificationNavCoverage activity.test dataAssistantSupportExcluded
                                                          → Test Suites: 15 passed, 15 total · Tests: 253 passed, 253 total
npx jest --maxWorkers=2 (full server suite)               → Test Suites: 470 passed, 470 total · Tests: 7551 passed, 7551 total · exit 0
(app) npx expo export --platform web --output-dir …       → "App exported to: …/web-dist" · expo export exit 0 (0 lines matching error/warn)
```
Note: during the full-suite run the working tree already held the (unimported, append-only) CSP-2
schema block of `shared/supportProfile.ts`; the CSP-1 commit stages the file without it.

**Not done in CSP-1**
- No app screens yet (report form, "আমার রিপোর্ট", card, queue, safeguarding screen) — the PRD puts
  the teacher surfaces in CSP-5 and the queue/batch screens in CSP-2/3. Notices open the staff home.
- The role editor does not hide the two Office switches (it has no per-role hide); the server refusal
  is the guard (D-#1548).
- The "synthesis fed a routed id → dropped" and "never taken into a batch or a pack" parts of
  `supportSafeguarding` are asserted in CSP-2/CSP-4 suites (`supportBatch`, `supportPackExport`,
  `supportSynthesis`), where batches and synthesis exist.

**Decisions:** D-#1546, D-#1547, D-#1548, D-#1549, D-#1550, D-#1564, D-#1582, D-#1583 (appended to
DECISIONS.md, each with its build defaults). Live code vs PRD: no "cover" grant kind (proxy grant /
RoutineSubstitution), teaching grants have no effectiveFrom (routine slot dates used), Quran/Arabic
come from RoutineSlots, `Enrolment` statuses are ACTIVE/CLOSED (an enrolment covering today is used).

**Questions for the owner**
1. The feature switch: OK that teachers see nothing at all until the Principal switches it on, while he
   can already prepare (open profiles, write, run the evaluation)?
2. নষ্ট is not on the block list by itself (it is an ordinary word for things); only "নষ্ট ছেলে/মেয়ে".
   OK?
3. The re-notice hours for an unseen safeguarding referral are 07:00–17:00 Dhaka, every day. Change?
