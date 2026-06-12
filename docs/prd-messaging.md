# PRD — Messaging Module (Staff Chat + Guardian Notices)

| | |
|---|---|
| **Status** | DRAFT v1.0 — build contract |
| **Owner** | Principal |
| **Date** | 2026-06-12 |
| **Decisions** | D-#76, D-#77, D-#78, D-#79 (this session); builds on D-#45, D-#48, D-#52, ADR-003, ADR-005, ADR-008 |
| **Plane** | Operational / identity (ADR-005) — no corpus path; J5.6 firewall must stay green |

## 1. Goal

Make SCD Hub the **default communication channel for staff** (Teacher / Office /
Principal), replacing WhatsApp for internal school communication, while keeping
WhatsApp **permanently** as the guardian-delivery fallback (ADR-003 reaffirmed).
This pulls the deferred **messaging pipeline** forward: it is the pipeline that
D-#52's routine triggers (bell / attendance / class-note reminders, R5.4–R5.5
guardian notify + push) were written to ride.

**Guardians are NOT chat participants.** They are notice **recipients**: today via
composed notices fanned out as wa.me links (no guardian login needed); push
delivery to guardians lands later with the guardian portal (pipeline-deferred,
unchanged).

## 2. Settled product choices (Principal, 2026-06-12)

1. Staff-only channel; guardians receive notices, never join chats.
2. One-to-one chat open between any two staff members.
3. Groups: auto-provisioned **class-wise** (per Section), **subject-wise**
   (per routine subject), **school-wide**; plus **manual ad-hoc/regular groups**
   created by Principal/Office only.
4. All groups default to **open discussion**; school-wide is switchable to
   announcement-only by Principal/Office.
5. **Principal may open and read any conversation**, including one-to-one.
6. Senders may **edit and delete** own messages; delete hides the content from
   everyone (a "removed" placeholder remains) but the original is **kept in the
   append-only audit** (ADR-008).
7. Attachments: **photo, PDF, video, voice note — max 10 MB per file**.
8. **Read receipts / seen status** required.
9. **wa.me copy-links remain forever** as the fallback path (ADR-003).

## 3. Gap table

| Need | Exists today | Gap |
|---|---|---|
| Send/receive messages | Nothing — only the wa.me deep-link builder (ADR-003, copy-out to WhatsApp) | Full chat data model + resolvers + UI |
| Conversations (1:1, group) | No model | `Conversation` + membership model |
| Class/subject/school groups | `Section` (+ classTeacherId, supportTeacherIds, D-#42/#53), `SubjectGroup` (D-#48), routine slots (R-2) know who teaches what | Auto-provision + idempotent membership sync (mirror D-#49's source-tag pattern) |
| Reply / forward / reactions | Nothing | Message-level fields + resolvers |
| Edit / delete with audit trace | Append-only `Audit` model + AuditService (ADR-008) | New audit kinds + retained-original semantics |
| Read receipts | Nothing | Per-message seen tracking |
| Principal oversight | Role exists; no read-override mechanism for chat | `chat:oversee` perm + audited override |
| File attachments | PDFs are *generated* (pdfkit); no uploaded-binary storage anywhere | First binary upload/storage path (see §9 open item) |
| Guardian notices | wa.me builder exists per-tracker; no notice composer | Notice model + per-guardian wa.me fan-out |
| Push notifications | None (`message:dispatch` perm declared, transport never built — D-#52) | Expo push transport for **staff** (M-7); guardian push stays portal-deferred |
| RBAC | Role/perm system (ADR-004/017) | New app-native `chat:*` perms |

## 4. Vocabulary & contract impact

**App-native only — NO wire-contract twin, NO two-/three-place sync.** A chat is a
feature, not import-envelope content (same ruling as trackers D-#33, HR, routine
D-#46). The import-envelope schema, mirrored enums, and the Python harness are
untouched. The **vocab verifier** is extended to check the new entries.

Additions to `/shared/vocab.ts` (+ `*_LABELS_BN` for all UI-facing values):

- Permissions: `chat:read` (PRINCIPAL/TEACHER/OFFICE), `chat:write` (same),
  `chat:manage` (PRINCIPAL/OFFICE — group create/edit, membership, posting
  policy, resync), `chat:oversee` (PRINCIPAL only).
- `CONVERSATION_KINDS = [DIRECT, SECTION, SUBJECT, SCHOOL, CUSTOM]`
- `POSTING_POLICIES = [OPEN, ANNOUNCEMENT]`
- `ATTACHMENT_KINDS = [IMAGE, PDF, VIDEO, AUDIO]`
- `NOTICE_SCOPES = [SCHOOL, SECTION]`

No new role; no change to TEACHER/OFFICE/PRINCIPAL sets beyond the perm grants
above (keeps the small role set, D-#17).

## 5. Slices (build order)

### M-1 — Core models + 1:1 chat + read receipts (server)
- Models: `Conversation` (kind, refId?, title, postingPolicy, active, createdBy),
  `ConversationMember` (conversationId, userId, `source: "auto"|"manual"`,
  addedBy, joinedAt), `ChatMessage` (conversationId, senderId, body, replyToId?,
  forwardOfId?, attachments[], editedAt?, deletedAt?/deletedBy?),
  `MessageReceipt` (messageId, userId, seenAt).
- `ChatService`: `openDirectConversation(otherUserId)` (idempotent — one DIRECT
  conversation per user pair), `sendMessage`, `markSeen`.
- Resolvers: `myConversations`, `conversation(id)` (member-only),
  `messages(conversationId, cursor)`, `sendMessage`, `markSeen` — gated
  `chat:read`/`chat:write` + membership check.
- Receipts: sender sees per-message seen-by (list + count).
- Acceptance: non-member read denied; messages ordered + paginated; seen state
  correct across two users; jest + tsc + vocab verifier green; firewall green.

### M-2 — Groups: auto-provision + manual + posting policy (server)
- Auto-provision: one SECTION conversation per active Section (members = class
  teacher + support teachers + teachers holding routine slots / teaching grants
  on it); one SUBJECT conversation per `ROUTINE_SUBJECTS` value (members = all
  teachers with a routine slot in that subject — Quran/Arabic flow in via their
  `SubjectGroup` slots, D-#48); one SCHOOL conversation (all active staff users).
- **Idempotent membership sync** mirroring D-#49: sync writes/removes only
  `source:"auto"` member rows; `source:"manual"` rows (added by Office) are never
  touched. Sync runs on routine-slot create/delete, class-teacher/support change,
  and via an explicit `resyncChatGroups` mutation (`chat:manage`).
- Manual groups: `createGroupConversation` / `archiveConversation` /
  `addMember` / `removeMember` — `chat:manage` only (Principal/Office).
  Teachers cannot create groups; DIRECT remains open to all staff.
- `setPostingPolicy(conversationId, policy)` — `chat:manage`; ANNOUNCEMENT
  blocks `sendMessage` for members without `chat:manage` (reactions still
  allowed). Default OPEN everywhere.
- Acceptance: routine change reflects in auto membership without touching manual
  rows; teacher group-create denied; ANNOUNCEMENT enforcement correct.

### M-3 — Rich messaging: reply, forward, reactions, edit, delete (server)
- Reply: `replyToId` renders quoted context; forward: `forwardMessage(messageId,
  toConversationId)` (sender must be member of both; `forwardOfId` set).
- Reactions: `Reaction` (messageId, userId, emoji) — one per user per message,
  toggleable.
- Edit: own messages only; prior body written to audit (`MESSAGE_EDITED`),
  `editedAt` flag rendered. No time limit (Principal's choice — no limit set).
- Delete: own messages only; content replaced by a removed-placeholder for ALL
  readers; **original body + attachments refs retained in the append-only audit**
  (`MESSAGE_DELETED`, ADR-008). Hard delete never occurs.
- Acceptance: deleted message invisible in queries but present in audit; edit
  audit carries the prior body; forward across conversations correct.

### M-4 — Attachments (server)
- Upload path: photo / PDF / video / voice note; per-file hard limit
  **10 MB** (10,485,760 bytes) + MIME whitelist per `ATTACHMENT_KINDS`.
- Storage: **server-disk on the Oracle VM** (proposed default, see §9), metadata
  in Mongo (`Attachment`: kind, mime, sizeBytes, storagePath, originalName,
  uploadedBy); download route gated by conversation membership (+ oversight).
- Acceptance: >10 MB rejected with Bangla error; disallowed MIME rejected;
  non-member download denied; deleted message's attachment inaccessible to
  members but referenced in audit.

### M-5 — App screens (Expo)
- New **Chat tab** (💬, gated `chat:read`): conversation list (groups + DMs,
  unread badge), conversation screen (messages, reply-swipe/long-press, forward,
  emoji reactions, edit/delete own, attachment picker + voice-note recorder,
  seen-by sheet), new-DM picker (staff directory), group-manage screens
  (`chat:manage`: create group, members, posting policy, resync).
- Bangla labels throughout from `shared/vocab` (English codes where applicable);
  removed-placeholder text in Bangla.
- Polling/refetch acceptable this slice; live transport rides M-7.
- Acceptance: app tsc clean + web bundle green; all M-1..M-4 capabilities
  reachable in UI.

### M-6 — Principal oversight + guardian notice composer + dispatch hook
- Oversight: `chat:oversee` (PRINCIPAL) — read-only access to ANY conversation
  incl. DIRECT, plus its audit trail (sees deleted originals). **Each oversight
  open is itself audit-logged** (`CHAT_OVERSIGHT_OPENED`) — accountability runs
  both directions. Oversight UI: conversation browser (Admin/Chat area).
- Guardian notices (option c, phase now): `GuardianNotice` (scope SCHOOL|SECTION,
  title, body, composedBy) + composer screen. Delivery = **per-guardian wa.me
  link fan-out** (reuses the ADR-003 builder + roster guardian phones); teacher
  taps through the list or copies all. No guardian login required.
- **Authorization lands the D-#45 parent-comms duty:** SECTION-scoped notice =
  that section's class teacher (`assertIsClassTeacher`) or Principal/Office;
  SCHOOL-scoped = `chat:manage`. No new permission (D-#42 pattern).
- D-#52 hook: internal `MessageDispatchService.dispatchSystemMessage(userId,
  text)` — posts into a system→user DIRECT thread. This is the interface the
  routine triggers (bell-duty, attendance, class-note prompts) will call; wiring
  the triggers themselves stays in the routine module's court.
- Acceptance: non-class-teacher section notice denied; oversight open audited;
  dispatch API unit-tested.

### M-7 — Staff push notifications (Expo push)
- `expo-notifications` + Expo push service: device token registration per staff
  login; push on new message in a conversation (muted-conversation toggle),
  and on `dispatchSystemMessage`.
- **This is the push transport D-#52 / R5.4–R5.5 have been waiting on** — for
  STAFF. Guardian push remains portal-deferred (out of scope, §7).
- Acceptance: token lifecycle (login/logout) correct; no push to non-members;
  graceful no-op on web where push is unavailable.

## 6. Journeys (Given / When / Then)

- **J-M1 (1:1 + receipt):** Given two teachers, When A sends B a message, Then B
  sees it in their conversation list, and after B opens it A sees B's seen
  status with timestamp.
- **J-M2 (group creation authority):** Given a TEACHER without `chat:manage`,
  When they attempt `createGroupConversation`, Then it is denied with a Bangla
  message; When OFFICE creates "Sports Day committee," Then members they add can
  chat in it.
- **J-M3 (auto membership follows the routine):** Given teacher X gains a routine
  slot for Class 3 Boys, When the sync runs, Then X appears in the Class 3 Boys
  SECTION conversation; Given Office had manually added Y, Then Y's membership
  is untouched by any sync.
- **J-M4 (delete + audit):** Given A deletes their own message, When any member
  views the thread, Then they see only a removed-placeholder; When the audit is
  inspected, Then the original body is present (`MESSAGE_DELETED`).
- **J-M5 (Principal oversight):** Given a DIRECT chat between two teachers, When
  the Principal opens it via oversight, Then it is readable (incl. deleted
  originals via audit) and a `CHAT_OVERSIGHT_OPENED` audit row is written; a
  TEACHER attempting the same is denied.
- **J-M6 (attachment limit):** Given a 12 MB video, When upload is attempted,
  Then it is rejected before storage with a Bangla size error; a 9 MB video
  succeeds and only members can download it.
- **J-M7 (announcement mode):** Given the SCHOOL conversation is set
  ANNOUNCEMENT, When a teacher tries to post, Then it is blocked (reaction still
  allowed); Principal/Office posts succeed.
- **J-M8 (guardian notice, no login):** Given the class teacher of Class 2 Girls
  composes a SECTION notice, Then a wa.me link is produced per guardian phone of
  that section's students; a non-class-teacher subject teacher of the same
  section is denied; OFFICE composing a SCHOOL notice succeeds.
- **J-M9 (reply/forward/reaction):** Given a message in the staff-room group,
  When B replies, forwards it to a SUBJECT group they belong to, and reacts 👍,
  Then the reply shows quoted context, the forward shows provenance, and the
  reaction toggles per user.

## 7. Out of scope (this PRD)

- Guardian chat participation, guardian logins, guardian push (all land with the
  guardian portal — pipeline unchanged).
- Student users (students have no logins, by design).
- Voice/video **calls**; WhatsApp Business API integration (links only, ADR-003).
- End-to-end encryption — **deliberately excluded**: Principal oversight (D-#77)
  and audit retention (ADR-008) require server-readable messages. Recorded so it
  is never "added" silently later.
- Message full-text search; retention/archival policy beyond append-only audit;
  typing indicators (nice-to-have, not contracted).
- Wiring the R5 routine triggers to the dispatch hook (routine module's task,
  enabled by M-6/M-7).

## 8. Reused / unchanged

- Import envelope, mirrored enums, Python harness — untouched (no sync).
- ADR-003 wa.me builder — **reused and reaffirmed permanent** (notices + existing
  tracker copy-links).
- ADR-008 audit model/service — reused (new kinds: `MESSAGE_EDITED`,
  `MESSAGE_DELETED`, `CHAT_OVERSIGHT_OPENED`, `CHAT_GROUP_CREATED`,
  `CHAT_MEMBERSHIP_CHANGED`, `NOTICE_SENT`).
- `Section` (classTeacherId/supportTeacherIds), `SubjectGroup`, routine slots,
  `assertIsClassTeacher` — read as membership/authority sources; not modified.
- `ScopeGrant` — untouched; chat membership is its own model, NOT a scope.
- ADR-005 plane split — chat is identity-plane; nothing crosses to corpus;
  J5.6 fail-closed firewall test must stay green every slice.

## 9. Open items

1. **Attachment storage backend (proposed default: Oracle VM disk).** Atlas
   free tier is ~512 MB total — GridFS with 10 MB videos would exhaust it
   almost immediately. Proposal: store binaries on the server's disk (path from
   env), metadata in Mongo. Confirm at M-4 build if the hosting picture has
   changed; flag to the Principal if any paid storage becomes necessary.
2. **Disk quota policy** (e.g. warn at N GB, per-conversation media cap) —
   parked; revisit after real usage data.

## 10. Traceability

D-#76 (module + staff-only + wa.me permanent) · D-#77 (oversight + edit/delete
audit) · D-#78 (group provisioning + posting policy) · D-#79 (attachments +
guardian notices + push transport) · builds on D-#42/#45 (class-teacher comms
duty — landed by M-6), D-#48 (SubjectGroup), D-#49 (source-tagged idempotent
sync pattern), D-#52 (trigger pipeline — M-6/M-7 provide its transport),
ADR-003, ADR-005, ADR-008. Vocab: app-native `chat:*`, `CONVERSATION_KINDS`,
`POSTING_POLICIES`, `ATTACHMENT_KINDS`, `NOTICE_SCOPES` (+BN labels) — verifier
extended, no wire twin.
