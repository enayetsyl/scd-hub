# Canned result files (docs/prd-child-support-profile.md §16.9 I-01 … I-14)

Templates of `support-result/v1` answers. Codes are random for every batch (DE-8), so the files hold
placeholders — `{{BATCH}}`, `{{NONCE}}`, `{{METHOD}}`, `{{R1}}` / `{{R2}}` (the batch's new reports),
`{{A1}}` (an approved context report), `{{C1}}` (the child), `{{CLASSMATE}}` — that
`fillResult()` (supportBatchFixtures.ts) replaces from the batch's own map. `{{DATE:…}}` is the
method's real date token and is left alone. Files I-15 … I-22 cover the remaining validator rules
(frequency word, link/HTML, flag quote/suggestion, duplicates, safeguarding LOW/HIGH, unknown top
field, a NEEDS_REWRITE round-trip). Invented content only.
