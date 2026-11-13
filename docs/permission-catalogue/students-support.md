# Area: students — support profile and safeguarding

Features: `support_profile`, `safeguarding` (docs/prd-child-support-profile.md §8; D-#1547, D-#1548, D-#1564).
Every resolver also runs `supportCaller` (`server/src/modules/support-profile/services/supportAccess.ts`):
OFFICE and GUARDIAN refused whatever is stored; "view as" refused unless the real person holds
`support_profile:view_all`. Per-child reach is `currentSupportReaders` (§8.2), never a role check.

## (a) Mutations — `server/src/modules/support-profile/resolvers/supportProfile.ts`
| resolver | gate | extra rule |
|---|---|---|
| saveSupportReportDraft | `support_profile:report` | current reader of the child; ≤ 3 open drafts |
| submitSupportReport | `support_profile:report` | current reader; cover teacher: the cover day only; GUARDIAN_INFO: class teacher or view_all |
| withdrawSupportReport | `support_profile:report` | own report, not IN_BATCH |
| raiseSafeguardingConcern | `support_profile:report` | current reader |
| decideSupportReport | `support_profile:approve` | TO_PROCESS / PROCESSED; no open safeguarding hold; RETURN only while the author reads the child |
| resolveSupportSafeguardingHold | `support_profile:approve` | never under "view as" |
| openSupportProfile / closeSupportProfile / reopenSupportProfile | `support_profile:manage` | never under "view as" |
| setSupportProfileSwitch | `support_profile:manage` | ships OFF |

## (b) Queries — same file
| resolver | gate | extra rule |
|---|---|---|
| mySupportReportsPage | `support_profile:report` | own rows; text only while still a reader |
| supportReport | any of `report` / `approve` / `view_all` | own while a reader, else approve/view_all; audited (REPORT) |
| supportProfileView | any of `view` / `view_all` | current reader; audited (CARD / FULL) |
| supportProfileChips | any of `view` / `view_all` | existence only; not audited |
| supportQueuePage | `support_profile:approve` | |
| supportProfilesPage | `support_profile:view_all` | ordered by class and name |
| supportProfileSetting | `support_profile:manage` | |

## (c) Safeguarding — `server/src/modules/platform/safeguarding/safeguardingResolvers.ts`
| resolver | gate | extra rule |
|---|---|---|
| safeguardingReferralsPage | `safeguarding:receive` | never under "view as" |
| markSafeguardingReferral | `safeguarding:receive` | never under "view as" |

## (d) Batches (CSP-2) — `server/src/modules/support-profile/resolvers/supportBatch.ts`
Every field `support_profile:process` (LOCKED) and refused in every "view as" session (`assertProcess`).
| resolver | gate | extra rule |
|---|---|---|
| supportBatchesPage | `support_profile:process` | |
| createSupportBatch / cancelSupportBatch | `support_profile:process` | one open batch at a time |
| downloadSupportPack | `support_profile:process` | fail-closed name scan; built in memory, hash + download entry + audit only |
| uploadSupportResult / supportImportPreview / applySupportImport / discardSupportImport | `support_profile:process` | the producer needs a passed evaluation for the method version |
| downloadSupportEvalPack / recordSupportEvaluation / supportMethodInfo | `support_profile:process` | |

## (e) App gates
Screens arrive with CSP-5 (teacher surfaces) and CSP-2/3 (batch, queue). Each button checks its action with `can("support_profile:…")`.
