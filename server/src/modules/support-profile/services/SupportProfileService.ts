/**
 * The profile itself (docs/prd-child-support-profile.md §5.1, §7, §8.4, §9.1–§9.2, §9.5).
 *
 *  - open / close / reopen by the Principal (`manage`, LOCKED) — D-#1546, D-#1558;
 *  - the card and the full profile: current readers + view_all; EVERY content read writes one
 *    SUPPORT_PROFILE_VIEWED (surface + via + readerVia, never text) — D-#1549;
 *  - the existence chip shows no content and is not audited;
 *  - the switch (ships OFF; CSP-6 switch-on sets the approval-load review date, §7.8).
 */
import { Types } from "mongoose";
import {
  SUPPORT_SECTIONS,
  isCardFresh,
  isDormant,
  sideOfSection,
  type SupportSection,
} from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { writeAudit } from "../../platform/services/AuditService";
import { Student } from "../../foundation/models/Student";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { SupportProfile, type ISupportProfile } from "../models/SupportProfile";
import { SupportProfileVersion, type ISupportProfileVersion, type SupportItem } from "../models/SupportProfileVersion";
import { SupportReview } from "../models/SupportReview";
import { SupportProfileRefusal } from "./errors";
import { accessToChild, getSupportSetting, holdsViewAll, isSwitchedOn, supportCaller, type SupportCtx } from "./supportAccess";
import { studentsReadBy } from "./supportScope";
import { callerHasPermission, type Permission } from "@scd/shared";

export const SUPPORT_SURFACES = ["CARD", "FULL", "HISTORY", "REPORT"] as const;
export const SUPPORT_VIA = ["ROUTINE", "ATTENDANCE", "CLASS_NOTE", "CLASS_TEST", "STUDENT_PAGE", "QUEUE", "MY_REPORTS"] as const;

/** The audit row carries only known values: a made-up `via` / `surface` is refused. */
export function assertSurfaceVia(surface: string, via: string): void {
  if (!(SUPPORT_SURFACES as readonly string[]).includes(surface)) throw new SupportProfileRefusal("ভুল মান।");
  if (!(SUPPORT_VIA as readonly string[]).includes(via)) throw new SupportProfileRefusal("ভুল মান।");
}

const oid = (s: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(s)) throw new SupportProfileRefusal("ভুল আইডি।");
  return new Types.ObjectId(s);
};

async function assertManage(ctx: SupportCtx) {
  const auth = await supportCaller(ctx, { noViewAs: true });
  if (!callerHasPermission(auth, "support_profile:manage" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  return auth;
}

export async function openProfile(ctx: SupportCtx, studentId: string, reasonBn?: string | null): Promise<ISupportProfile> {
  const auth = await assertManage(ctx);
  if (!(await Student.exists({ _id: oid(studentId) }))) throw new SupportProfileRefusal("শিক্ষার্থী পাওয়া যায়নি।");
  const existing = await SupportProfile.findOne({ studentId: oid(studentId) });
  if (existing) return existing;
  const p = await SupportProfile.create({ studentId: oid(studentId), openedVia: "PRINCIPAL", openedBy: oid(auth.userId), openedAt: new Date(), openReasonBn: reasonBn?.trim() || undefined });
  await SupportReview.create({ profileId: p._id, kind: "PROFILE_OPEN", decision: "OPENED", reasonBn: reasonBn ?? "", by: oid(auth.userId), at: new Date() });
  await writeAudit({ eventKind: "SUPPORT_PROFILE_OPENED", actorId: auth.userId, targetId: studentId, targetKind: "Student", meta: { studentId, openedVia: "PRINCIPAL" } });
  return p;
}

export async function setProfileStatus(ctx: SupportCtx, studentId: string, to: "CLOSED" | "OPEN", reasonBn?: string | null): Promise<ISupportProfile> {
  const auth = await assertManage(ctx);
  const p = await SupportProfile.findOne({ studentId: oid(studentId) });
  if (!p) throw new SupportProfileRefusal("প্রোফাইল পাওয়া যায়নি।");
  if (to === "CLOSED") {
    if (!reasonBn?.trim()) throw new SupportProfileRefusal("বন্ধের কারণ লিখুন।");
    p.status = "CLOSED";
    p.closedAt = new Date();
    p.closedBy = oid(auth.userId);
    p.closeReasonBn = reasonBn.trim();
  } else {
    p.status = "OPEN";
  }
  await p.save();
  await SupportReview.create({ profileId: p._id, kind: to === "CLOSED" ? "PROFILE_CLOSE" : "PROFILE_REOPEN", decision: to, reasonBn: reasonBn ?? "", by: oid(auth.userId), at: new Date() });
  await writeAudit({ eventKind: to === "CLOSED" ? "SUPPORT_PROFILE_CLOSED" : "SUPPORT_PROFILE_REOPENED", actorId: auth.userId, targetId: studentId, targetKind: "Student", meta: { studentId } });
  return p;
}

/** The year cut-over day of the current academic year (E-9 fresh start), or null. */
async function cutoverKey(): Promise<string | null> {
  const y = await AcademicYear.findOne({ current: true }).select("startDate").lean();
  return y?.startDate ? dhakaDayKey(y.startDate) : null;
}

export interface ProfileView {
  profile: ISupportProfile;
  version: ISupportProfileVersion | null;
  studentName: string;
  /** Items grouped per section, with read-time flags (stale / dormant). */
  sections: { section: SupportSection; items: (SupportItem & { stale: boolean; dormant: boolean })[] }[];
  card: {
    strengths: SupportItem[];
    dos: SupportItem[];
    avoids: (SupportItem & { insteadText: string | null })[];
    goal: SupportItem | null;
  } | null;
}

function buildView(profile: ISupportProfile, version: ISupportProfileVersion | null, studentName: string, todayKey: string, cut: string | null): ProfileView {
  const sections = SUPPORT_SECTIONS.map((section) => {
    const side = sideOfSection(section);
    const items = (version?.sections?.[section] ?? []).map((it) => ({
      ...(typeof (it as unknown as { toObject?: () => SupportItem }).toObject === "function" ? (it as unknown as { toObject: () => SupportItem }).toObject() : it),
      stale: side ? !isCardFresh(side, it.lastEvidenceKey, todayKey) : false,
      dormant: isDormant(side, it.lastEvidenceKey, cut),
    }));
    return { section, items };
  });
  if (!version) return { profile, version, studentName, sections, card: null };
  const byId = new Map(sections.flatMap((s) => s.items.map((i) => [i.itemId, { ...i, section: s.section }] as const)));
  // E-8 / E-9 at READ time: a stale or dormant item drops off the card without a new version.
  const onCard = (id: string) => {
    const it = byId.get(id);
    return it && !it.stale && !it.dormant ? it : null;
  };
  const card = {
    strengths: version.card.strengthItemIds.map(onCard).filter(Boolean) as SupportItem[],
    dos: version.card.doItemIds.map(onCard).filter(Boolean) as SupportItem[],
    avoids: version.card.avoidItemIds
      .map(onCard)
      .filter(Boolean)
      .map((a) => ({ ...(a as SupportItem), insteadText: (a as SupportItem).insteadItemId ? (byId.get((a as SupportItem).insteadItemId!)?.textBn ?? null) : null })),
    goal: version.card.goalItemId ? (byId.get(version.card.goalItemId) ?? null) : null,
  };
  return { profile, version, studentName, sections, card };
}

/** The card or the full profile of one child. Audited (one row per open). */
export async function readProfile(ctx: SupportCtx, studentId: string, surface: "CARD" | "FULL", via: string): Promise<ProfileView | null> {
  assertSurfaceVia(surface, via);
  const acc = await accessToChild(ctx, studentId, "view");
  const profile = await SupportProfile.findOne({ studentId: oid(studentId) });
  if (!profile) return null;
  // Closed / left profiles are Principal-only (§7.2).
  if (profile.status !== "OPEN" && acc.mode !== "ALL") throw new SupportProfileRefusal("এই প্রোফাইলটি এখন শুধু প্রধান শিক্ষকের জন্য।");
  const version = profile.currentVersionId ? await SupportProfileVersion.findById(profile.currentVersionId) : null;
  // A profile with no published version shows teachers nothing (no empty card).
  if (!version && acc.mode !== "ALL") return null;
  await writeAudit({
    eventKind: "SUPPORT_PROFILE_VIEWED",
    actorId: acc.auth.userId,
    targetId: studentId,
    targetKind: "Student",
    meta: { studentId, versionNo: version?.versionNo ?? null, surface, via, readerVia: acc.readerVia },
  });
  const st = await Student.findById(oid(studentId)).select("name nameBn").lean();
  return buildView(profile, version, st?.nameBn || st?.name || "", dhakaDayKey(new Date()), await cutoverKey());
}

/**
 * The existence chip (§9.1): which of these children have a PUBLISHED, OPEN profile that this
 * caller may read. No content, not audited. Readers only — a non-reader learns nothing.
 */
export async function chipStudentIds(ctx: SupportCtx, studentIds: string[]): Promise<string[]> {
  const auth = await supportCaller(ctx);
  const ids = studentIds.filter((s) => Types.ObjectId.isValid(s)).slice(0, 200);
  const withProfile = await SupportProfile.find({ studentId: { $in: ids.map(oid) }, status: "OPEN", currentVersionId: { $ne: null } }).select("studentId").lean();
  if (holdsViewAll(auth)) return withProfile.map((p) => String(p.studentId));
  if (!(await isSwitchedOn()) || !callerHasPermission(auth, "support_profile:view" as Permission)) return [];
  // The caller's reach is computed once for the whole list, not per profile.
  const mine = await studentsReadBy(auth.userId, withProfile.map((p) => String(p.studentId)));
  return withProfile.map((p) => String(p.studentId)).filter((id) => mine.has(id));
}

/** §9.3 child picker: the students this caller may write a report about (search by name; max 20). No profile needed. */
export async function reportableStudents(ctx: SupportCtx, search: string): Promise<{ id: string; name: string }[]> {
  const auth = await supportCaller(ctx);
  if (!callerHasPermission(auth, "support_profile:report" as Permission)) throw new SupportProfileRefusal("অনুমতি নেই।");
  if (!holdsViewAll(auth) && !(await isSwitchedOn())) return [];
  const q = search.trim().slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q.length < 2) return [];
  const found = await Student.find({ active: { $ne: false }, $or: [{ name: { $regex: q, $options: "i" } }, { nameBn: { $regex: q, $options: "i" } }] })
    .select("name nameBn")
    .limit(60)
    .lean();
  const mine = holdsViewAll(auth) ? new Set(found.map((x) => String(x._id))) : await studentsReadBy(auth.userId, found.map((x) => String(x._id)));
  return found.filter((x) => mine.has(String(x._id))).slice(0, 20).map((x) => ({ id: String(x._id), name: x.nameBn || x.name }));
}

/** The Principal's list (§9.5): by class and name — never by concern count. */
export async function profilesPage(ctx: SupportCtx, args: { status?: string | null; page?: number | null; pageSize?: number | null }) {
  const auth = await supportCaller(ctx);
  if (!holdsViewAll(auth)) throw new SupportProfileRefusal("অনুমতি নেই।");
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 50));
  const filter = args.status ? { status: args.status } : {};
  const all = await SupportProfile.find(filter).select("studentId status currentVersionId nextReviewDueKey openedAt safeguardingBanner").lean();
  const students = new Map(
    (await Student.find({ _id: { $in: all.map((p) => p.studentId) } }).select("name nameBn classId").lean()).map((s) => [String(s._id), s]),
  );
  const rows = all
    .map((p) => {
      const s = students.get(String(p.studentId)) as { name?: string; nameBn?: string; classId?: Types.ObjectId } | undefined;
      return { id: String(p._id), studentId: String(p.studentId), studentName: s?.nameBn || s?.name || "", classId: s?.classId ? String(s.classId) : "", status: p.status, published: !!p.currentVersionId, nextReviewDueKey: p.nextReviewDueKey ?? null, safeguardingBanner: !!p.safeguardingBanner };
    })
    .sort((a, b) => a.classId.localeCompare(b.classId) || a.studentName.localeCompare(b.studentName, "bn"));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** The switch: ships OFF. Switch-on sets the approval-load review date (switch-on + 30, §7.8). */
export async function setSwitch(ctx: SupportCtx, on: boolean) {
  const auth = await assertManage(ctx);
  const s = await getSupportSetting();
  const today = dhakaDayKey(new Date());
  if (on && !s.switchedOnKey) {
    s.switchedOnKey = today;
    const [y, m, d] = today.split("-").map(Number);
    s.approvalLoadReviewDueKey = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  }
  if (!on) s.switchedOnKey = null;
  s.updatedBy = oid(auth.userId);
  await s.save();
  return s;
}
