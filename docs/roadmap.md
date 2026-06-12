# Roadmap / deferred pipeline

Architecture-ready, NOT built now. The foundation (envelope, GraphQL+codegen, RBAC/PoLP + resolver
authz, two-plane access + both logs, corpus backbone) is designed so these slot in without a core
rewrite (NFR-3, ADR-002). Authoritative source: docs/requirements.md §9.

## First-priority build (in scope NOW — tracked in STATUS, not here)
Content store/display, question bank + filters, selection → HW/AS/CT sets, built-in trackers;
GraphQL API; RBAC + resolver authz; both logs; thin foundation (accounts/roles incl. Guardian
account + child linkage, classes/sections, subjects, thin student roster). Delivery iOS/Android/Web.

## Pipeline (build later)
### Guardian portal screens
Routine, homework + how-to-guide docs, attendance report, fees report, push notifications, notices,
leave application. (Guardian account + linkage exist in the build; screens land with their modules.
`guardian:read_child` is the pipeline-gated permission.)

### Near-term data analysis (R-AN1–4)
Weak-spot detection, Bloom's-balance audit, item analysis, score/observation trending. Runs on a
separate projection over the `events` backbone; heavy jobs off-peak/post-export to protect M0 uptime.

### LLM / AI layer (long-horizon)
AI-layer activation + training-export tool (the `export_views` JSONL projection behind the PII
firewall; provider-agnostic facade — Claude for design/policy-sensitive, Gemini for high-volume,
parked). Fine-tuning on the proprietary corpus is a multi-year goal; storage shape is designed now.

### Messaging automation
WhatsApp Cloud API + local bulk-SMS gateway (replacing manual `wa.me` deep links). Unofficial
WhatsApp libraries are rejected (ToS risk). **In-app notification pipeline + push PULLED FORWARD** — build contract `docs/prd-notifications.md` (N-1 inbox/seam → N-2 scheduler → N-3 app UI → N-4 Expo push; D-#72–#75); WhatsApp Cloud API + bulk SMS remain deferred and will plug into the same `emit()` seam.

### Trackers & misc
Full vocabulary tracker, complaint tracker; video review vs REF-11 observation rubric.

### HR / staff lifecycle — **PULLED FORWARD into the active build**
Staff records → attendance & leave → payroll → performance/conduct/development → offboarding.
Designed in `docs/hr-design.md`; per-journey PRD with acceptance criteria in `docs/prd-hr.md`;
decisions D-#22–D-#29 in `DECISIONS.md`. No longer deferred — tracked in `STATUS.md`, not here.
Notes carried from the design: HR sits on the operational/identity plane behind the PII firewall
(ADR-005) and adds **no** new corpus→identity path; biometric attendance sync (D-#24) is the app's
**first live external dependency** (device model/SDK on the critical path); leave reuses the existing
proxy/cover system (D-#20/#22).

### Routine / Timetable — **PULLED FORWARD into the active build**
Build contract `docs/prd-routine.md` (slices R-1 rooms+period-defs+slot-model+conflict-engine → R-2
views → R-3 substitution/cover); decisions D-#46/#47. Operational/identity plane behind the PII firewall
(ADR-005), **no** new corpus→identity path; reuses `calendar.ts` (Sun–Thu), `ScopeGrant` (teacher
authority) and the proxy/cover system (D-#20/#22). App-native `routine:read`/`routine:manage` perms — no
wire-contract sync. No longer deferred — tracked in `STATUS.md`, not here.

### Class teacher → section daily-coordinator gate — **active (contract written)**
Build contract `docs/prd-class-teacher.md`; decision D-#45. Generalizes the existing `assertIsClassTeacher`
(D-#42) into the shared gate for attendance / leave-approval / report-card-sign-off / parent-comms — each
duty gate lands **with its module**; only CT-1 (generalize + coordinator views) is buildable now.

### Deferred ops modules (still deferred)
Comms, notices, fees, expenses, exam/results, asset register (the library half pulled forward — build contract docs/prd-library.md, tracked in STATUS).
*(Attendance, leave and payroll moved up — see "HR / staff lifecycle" above; routine moved up — see above.)*

## Distribution
Internal-first (Expo internal dist / TestFlight / direct APK) to defer store fees; publish to public
stores later (Apple ~$99/yr, Google ~$25 one-time).
