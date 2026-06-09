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
WhatsApp libraries are rejected (ToS risk).

### Trackers & misc
Full vocabulary tracker, complaint tracker; video review vs REF-11 observation rubric.

### Deferred ops modules
Attendance, comms, notices, fees, expenses, payroll, routine, leave, exam/results, loanable-resource
(library + asset register).

## Distribution
Internal-first (Expo internal dist / TestFlight / direct APK) to defer store fees; publish to public
stores later (Apple ~$99/yr, Google ~$25 one-time).
