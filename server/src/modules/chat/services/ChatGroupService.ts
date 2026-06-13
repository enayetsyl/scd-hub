/**
 * ChatGroupService (M-2, D-#78) — auto-provisioned groups + manual ad-hoc groups
 * + posting policy. Builds on the M-1 chat core (Conversation/ConversationMember
 * + assertChatMember + ChatService); does NOT duplicate the M-1 machinery.
 *
 * AUTO-PROVISION (the D-#49 source-tag pattern, mirrored from RoutineSlotService):
 *   SECTION  — one per active Section (members = class teacher + support teachers
 *              + teachers holding a routine slot OR an active teaching grant on it)
 *   SUBJECT  — one per ROUTINE_SUBJECTS value (members = every teacher with a
 *              routine slot in that subject; Quran/Arabic flow in via SubjectGroup
 *              slots, D-#48)
 *   SCHOOL   — one singleton (members = all active non-guardian staff users)
 * The membership sync writes/removes ONLY `source:"auto"` rows; a `source:"manual"`
 * row added by Office is NEVER touched (J-M3). The reconcile is idempotent — a
 * re-run with unchanged data is a no-op.
 *
 * MANUAL groups (CUSTOM) are Principal/Office-only (`chat:manage` at the resolver);
 * teachers cannot create groups (DIRECT stays open to all — M-1). Posting policy:
 * ANNOUNCEMENT blocks posting for members without `chat:manage` (enforced in
 * ChatService.sendMessage; this service only persists the field).
 *
 * Identity-plane behind the ADR-005 firewall — no corpus import in this module.
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECTS, ROUTINE_SUBJECT_LABELS_BN, POSTING_POLICIES } from "@scd/shared";
import type { PostingPolicy, RoutineSubject } from "@scd/shared";
import { User } from "../../foundation/models/User";
import { Section, type ISection } from "../../foundation/models/Section";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { writeAudit } from "../../platform/services/AuditService";
import { Conversation, type IConversation } from "../models/Conversation";
import { ConversationMember } from "../models/ConversationMember";
import { ChatError } from "./ChatService";

/** The SCHOOL conversation is a singleton — a fixed refId makes it findable. */
const SCHOOL_REF = "ALL";

export interface SyncCounts {
  conversationId: string;
  added: number;
  removed: number;
}

// ---------------------------------------------------------------------------
// Auto-provision: upsert the conversation + reconcile its auto membership
// ---------------------------------------------------------------------------

/** Find-or-create THE auto conversation for (kind, refId), idempotent — one
 *  SECTION per section, one SUBJECT per subject, one SCHOOL singleton. Only the
 *  title is kept fresh on an existing row; policy/active are insert-time only so
 *  an admin's posting-policy choice is never reset by a resync. */
async function upsertAutoConversation(
  kind: "SECTION" | "SUBJECT" | "SCHOOL",
  refId: string,
  title: string,
): Promise<IConversation> {
  const conv = (await Conversation.findOneAndUpdate(
    { kind, refId },
    {
      $setOnInsert: { kind, refId, postingPolicy: "OPEN", active: true },
      $set: { title },
    },
    { upsert: true, new: true },
  ).lean()) as unknown as IConversation | null;
  if (!conv) throw new ChatError("গ্রুপ তৈরি করা যায়নি");
  return conv;
}

/** Reconcile a conversation's AUTO membership to exactly `desiredUserIds`:
 *  add missing auto rows, remove auto rows no longer desired, never touch a
 *  manual row (the D-#49 source-tag split). A user already present as a manual
 *  member is left as-is (the unique index forbids a second row, and the manual
 *  intent wins). Returns how many auto rows were added/removed. */
async function reconcileAutoMembers(
  conversationId: Types.ObjectId,
  desiredUserIds: string[],
): Promise<{ added: number; removed: number }> {
  const desired = new Set(desiredUserIds);
  const existing = await ConversationMember.find({ conversationId }).lean();
  const manualIds = new Set(
    existing.filter((m) => m.source === "manual").map((m) => m.userId.toString()),
  );
  const existingAuto = existing.filter((m) => m.source === "auto");
  const existingAutoIds = new Set(existingAuto.map((m) => m.userId.toString()));

  const toAdd = [...desired].filter((id) => !existingAutoIds.has(id) && !manualIds.has(id));
  const toRemove = existingAuto.filter((m) => !desired.has(m.userId.toString()));

  if (toAdd.length) {
    const joinedAt = new Date();
    await ConversationMember.bulkWrite(
      toAdd.map((userId) => ({
        updateOne: {
          filter: { conversationId, userId: new Types.ObjectId(userId) },
          update: { $setOnInsert: { source: "auto", joinedAt } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (toRemove.length) {
    await ConversationMember.deleteMany({
      conversationId,
      source: "auto",
      userId: { $in: toRemove.map((m) => m.userId) },
    });
  }
  return { added: toAdd.length, removed: toRemove.length };
}

/** Keep only the ids that are ACTIVE non-guardian staff Users (D-#76: guardians
 *  never appear in a chat; a deactivated teacher drops out on the next sync). */
async function filterActiveStaff(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const users = await User.find({
    _id: { $in: ids },
    active: true,
    role: { $ne: "GUARDIAN" },
  })
    .select("_id")
    .lean();
  return users.map((u) => u._id.toString());
}

// ---------------------------------------------------------------------------
// Desired-membership computation (from roster + routine — no second truth)
// ---------------------------------------------------------------------------

/** A SECTION group's members: class teacher + support teachers + every teacher
 *  with a routine slot OR an active teaching grant on the section (D-#78). */
async function sectionMemberIds(section: ISection): Promise<string[]> {
  const ids = new Set<string>();
  if (section.classTeacherId) ids.add(section.classTeacherId.toString());
  for (const s of section.supportTeacherIds ?? []) ids.add(s.toString());

  const slots = await RoutineSlot.find({
    groupType: "section",
    groupId: section._id,
    active: true,
    teacherId: { $exists: true, $ne: null },
  })
    .select("teacherId")
    .lean();
  for (const sl of slots) if (sl.teacherId) ids.add(sl.teacherId.toString());

  const grants = await ScopeGrant.find({
    kind: "teaching",
    sectionId: section._id,
    active: true,
  })
    .select("teacherId")
    .lean();
  for (const g of grants) if (g.teacherId) ids.add(g.teacherId.toString());

  return [...ids];
}

/** A SUBJECT group's members: every teacher with a routine slot in that subject
 *  (section slots + Quran/Arabic SubjectGroup slots alike, D-#48). */
async function subjectMemberIds(subject: RoutineSubject): Promise<string[]> {
  const slots = await RoutineSlot.find({
    subject,
    active: true,
    teacherId: { $exists: true, $ne: null },
  })
    .select("teacherId")
    .lean();
  const ids = new Set<string>();
  for (const sl of slots) if (sl.teacherId) ids.add(sl.teacherId.toString());
  return [...ids];
}

// ---------------------------------------------------------------------------
// Public sync entry points (group-scoped — called by hooks + the full resync)
// ---------------------------------------------------------------------------

/** Auto-provision + sync the SECTION group for one section (no-op for an inactive
 *  or missing section). Called on class-teacher/support change + section routine
 *  slot create/delete, and by the full resync. */
export async function syncSectionGroup(sectionId: string): Promise<SyncCounts | null> {
  const section = (await Section.findById(sectionId).lean()) as ISection | null;
  if (!section || section.active === false) return null;
  const conv = await upsertAutoConversation("SECTION", section._id.toString(), section.nameBn);
  const desired = await filterActiveStaff(await sectionMemberIds(section));
  const counts = await reconcileAutoMembers(conv._id, desired);
  return { conversationId: conv._id.toString(), ...counts };
}

/** Auto-provision + sync the SUBJECT group for one ROUTINE_SUBJECTS value. */
export async function syncSubjectGroup(subject: RoutineSubject): Promise<SyncCounts> {
  const conv = await upsertAutoConversation("SUBJECT", subject, ROUTINE_SUBJECT_LABELS_BN[subject]);
  const desired = await filterActiveStaff(await subjectMemberIds(subject));
  const counts = await reconcileAutoMembers(conv._id, desired);
  return { conversationId: conv._id.toString(), ...counts };
}

/** Auto-provision + sync the school-wide group (all active non-guardian staff). */
export async function syncSchoolGroup(): Promise<SyncCounts> {
  const conv = await upsertAutoConversation("SCHOOL", SCHOOL_REF, "স্কুল-ব্যাপী");
  const desired = await filterActiveStaff(
    (await User.find({ active: true, role: { $ne: "GUARDIAN" } }).select("_id").lean()).map((u) =>
      u._id.toString(),
    ),
  );
  const counts = await reconcileAutoMembers(conv._id, desired);
  return { conversationId: conv._id.toString(), ...counts };
}

export interface ResyncSummary {
  sections: number;
  subjects: number;
  school: number;
}

/** Full idempotent resync of every auto group (chat:manage). Iterates active
 *  sections, every ROUTINE_SUBJECTS value, and the school singleton; manual rows
 *  are never touched. */
export async function resyncAllChatGroups(actorId: string): Promise<ResyncSummary> {
  const sections = (await Section.find({ active: true }).select("_id").lean()) as Array<{
    _id: Types.ObjectId;
  }>;
  for (const s of sections) await syncSectionGroup(s._id.toString());
  for (const subject of ROUTINE_SUBJECTS) await syncSubjectGroup(subject);
  await syncSchoolGroup();

  await writeAudit({
    eventKind: "CHAT_MEMBERSHIP_CHANGED",
    actorId,
    targetKind: "ChatGroupResync",
    meta: { sections: sections.length, subjects: ROUTINE_SUBJECTS.length, school: 1 },
  });
  return { sections: sections.length, subjects: ROUTINE_SUBJECTS.length, school: 1 };
}

// ---------------------------------------------------------------------------
// Best-effort hooks — called from other modules' mutations (never block them)
// ---------------------------------------------------------------------------

/** Re-sync the auto groups a routine-slot change affects (its SECTION, if a
 *  section slot, and its SUBJECT). Best-effort: a chat-sync failure must never
 *  block or roll back the routine mutation (the emitters' D-#72 posture). */
export async function onRoutineSlotChangedSync(slot: {
  groupType: string;
  groupId: { toString(): string };
  subject?: string;
}): Promise<void> {
  try {
    if (slot.groupType === "section") await syncSectionGroup(slot.groupId.toString());
    if (slot.subject && (ROUTINE_SUBJECTS as readonly string[]).includes(slot.subject))
      await syncSubjectGroup(slot.subject as RoutineSubject);
  } catch (err) {
    console.error("[chat] routine-slot group sync failed (never blocks the host op):", err);
  }
}

/** Re-sync a section's auto group after a class-teacher / support-teacher change.
 *  Best-effort — never blocks the coordinator mutation. */
export async function onSectionTeachersChangedSync(sectionId: string): Promise<void> {
  try {
    await syncSectionGroup(sectionId);
  } catch (err) {
    console.error("[chat] section group sync failed (never blocks the host op):", err);
  }
}

// ---------------------------------------------------------------------------
// Manual (CUSTOM) groups + membership — chat:manage at the resolver
// ---------------------------------------------------------------------------

export interface CreateGroupInput {
  title: string;
  memberIds: string[];
  postingPolicy?: PostingPolicy | null;
  createdBy: string;
}

/** Create a CUSTOM ad-hoc group (Principal/Office only at the resolver). The
 *  creator + the named members are added as `source:"manual"` rows (so no sync
 *  ever touches them); only active non-guardian staff are admitted. */
export async function createGroupConversation(input: CreateGroupInput): Promise<IConversation> {
  const title = (input.title ?? "").trim();
  if (!title) throw new ChatError("গ্রুপের নাম দিতে হবে");

  const conv = await Conversation.create({
    kind: "CUSTOM",
    title,
    postingPolicy: input.postingPolicy ?? "OPEN",
    active: true,
    createdBy: new Types.ObjectId(input.createdBy),
  });

  const candidateIds = [...new Set([input.createdBy, ...(input.memberIds ?? [])])];
  const staff = await filterActiveStaff(candidateIds);
  // The creator is always a member even if the staff filter is empty otherwise.
  const memberIds = new Set(staff);
  memberIds.add(input.createdBy);

  const joinedAt = new Date();
  await ConversationMember.bulkWrite(
    [...memberIds].map((userId) => ({
      updateOne: {
        filter: { conversationId: conv._id, userId: new Types.ObjectId(userId) },
        update: {
          $setOnInsert: { source: "manual", addedBy: new Types.ObjectId(input.createdBy), joinedAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  await writeAudit({
    eventKind: "CHAT_GROUP_CREATED",
    actorId: input.createdBy,
    targetId: conv._id,
    targetKind: "Conversation",
    meta: { title, memberCount: memberIds.size },
  });
  return conv as unknown as IConversation;
}

/** Add a MANUAL member to a group (chat:manage). Works on any non-DIRECT
 *  conversation — incl. an auto SECTION/SUBJECT group (the manual row coexists
 *  with the auto roster and the sync never removes it, D-#49). */
export async function addMember(
  conversationId: string,
  userId: string,
  addedBy: string,
): Promise<void> {
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw new ChatError("কথোপকথন পাওয়া যায়নি");
  if (conv.kind === "DIRECT") throw new ChatError("সরাসরি বার্তায় সদস্য যোগ করা যায় না");
  const staff = await filterActiveStaff([userId]);
  if (staff.length === 0) throw new ChatError("শুধুমাত্র সক্রিয় স্টাফ সদস্য যোগ করা যায়");

  await ConversationMember.updateOne(
    { conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId) },
    { $setOnInsert: { source: "manual", addedBy: new Types.ObjectId(addedBy), joinedAt: new Date() } },
    { upsert: true },
  );
  await writeAudit({
    eventKind: "CHAT_MEMBERSHIP_CHANGED",
    actorId: addedBy,
    targetId: new Types.ObjectId(conversationId),
    targetKind: "Conversation",
    meta: { op: "add", userId },
  });
}

/** Remove a MANUAL member (chat:manage). Only manual rows are removable — an
 *  auto member is owned by the sync (removing it would just be re-added), so a
 *  removal request against an auto row is a no-op. */
export async function removeMember(
  conversationId: string,
  userId: string,
  actorId: string,
): Promise<void> {
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw new ChatError("কথোপকথন পাওয়া যায়নি");
  if (conv.kind === "DIRECT") throw new ChatError("সরাসরি বার্তা থেকে সদস্য সরানো যায় না");
  await ConversationMember.deleteOne({
    conversationId: new Types.ObjectId(conversationId),
    userId: new Types.ObjectId(userId),
    source: "manual",
  });
  await writeAudit({
    eventKind: "CHAT_MEMBERSHIP_CHANGED",
    actorId,
    targetId: new Types.ObjectId(conversationId),
    targetKind: "Conversation",
    meta: { op: "remove", userId },
  });
}

/** Archive (deactivate) a CUSTOM group — it leaves every member's list. Only
 *  CUSTOM groups archive; auto groups are owned by the provisioning sync. */
export async function archiveConversation(
  conversationId: string,
  actorId: string,
): Promise<IConversation> {
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw new ChatError("কথোপকথন পাওয়া যায়নি");
  if (conv.kind !== "CUSTOM") throw new ChatError("শুধুমাত্র নিজস্ব গ্রুপ আর্কাইভ করা যায়");
  await Conversation.updateOne({ _id: conversationId }, { $set: { active: false } });
  await writeAudit({
    eventKind: "CHAT_MEMBERSHIP_CHANGED",
    actorId,
    targetId: new Types.ObjectId(conversationId),
    targetKind: "Conversation",
    meta: { op: "archive" },
  });
  return { ...conv, active: false } as unknown as IConversation;
}

/** Set a group's posting policy (chat:manage). ANNOUNCEMENT enforcement happens
 *  in ChatService.sendMessage; this only persists the field. Not on DIRECT. */
export async function setPostingPolicy(
  conversationId: string,
  policy: PostingPolicy,
  actorId: string,
): Promise<IConversation> {
  if (!(POSTING_POLICIES as readonly string[]).includes(policy))
    throw new ChatError("অবৈধ পোস্টিং নীতি");
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw new ChatError("কথোপকথন পাওয়া যায়নি");
  if (conv.kind === "DIRECT") throw new ChatError("সরাসরি বার্তার নীতি পরিবর্তন করা যায় না");
  await Conversation.updateOne({ _id: conversationId }, { $set: { postingPolicy: policy } });
  await writeAudit({
    eventKind: "CHAT_MEMBERSHIP_CHANGED",
    actorId,
    targetId: new Types.ObjectId(conversationId),
    targetKind: "Conversation",
    meta: { op: "posting_policy", policy },
  });
  return { ...conv, postingPolicy: policy } as unknown as IConversation;
}
