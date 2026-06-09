# SCD Hub

The **publisher + system of record + delivery + tracking** platform for **SCD — School for Community Development**.

SCD Hub stores and displays chapter & session plans, manages a tagged question bank with filters,
lets teachers select questions into assembled HW / AS / CT sets, and provides built-in trackers.
The curriculum itself is **authored elsewhere**; SCD Hub is the *publisher and system of record* —
it delivers and tracks that content, it does not author it.

## Stack
- **MERN** — MongoDB, Express, React (via **React Native / Expo** → iOS + Android + Web from one codebase), Node.
- **GraphQL** API (Yoga + Pothos + Envelop + graphql-codegen; urql client).
- **Python** import-conformance harness for the curriculum import contract.

## Conventions
- English for code, docs, and decisions; **Bangla** for student/teacher-facing content (with English codes on trackers/forms).
- Versioning via git tags + `CHANGELOG.md` — never in filenames.
- **Never commit secrets** (Atlas URI, tokens) — use `.env` + a secret manager; keep them gitignored.
- Executed verification is the only "done" gate.

## Status
Bootstrap in progress. See `STATUS.md` (once added) for the live cursor.
