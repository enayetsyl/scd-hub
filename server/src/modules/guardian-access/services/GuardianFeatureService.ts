/**
 * Guardian release switch (D-#1011). A guardian-facing feature (the storybook shelf, activity
 * sheets) is hidden from every family until it is switched on — for all guardians, or for the
 * chosen guardians only. No row = OFF. Staff screens never read this.
 *
 * Every guardian path of those features calls `assertGuardianFeature` (resolvers + file gates);
 * notifications to families go through `guardiansWithFeature`, so a family that cannot see the
 * feature is never told about it.
 */
import { Types } from "mongoose";
import { GUARDIAN_FEATURES, type GuardianFeature } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { GuardianFeatureAccess } from "../models/GuardianFeatureAccess";

export const FEATURE_OFF_BN = "এই সুবিধাটি এখনো আপনার জন্য চালু হয়নি";

function assertFeature(feature: string): asserts feature is GuardianFeature {
  if (!(GUARDIAN_FEATURES as readonly string[]).includes(feature)) throw new ForbiddenError(`Unknown guardian feature: ${feature}`);
}

async function rowOf(feature: GuardianFeature): Promise<{ onForAll: boolean; ids: Set<string> }> {
  const row = await GuardianFeatureAccess.findOne({ feature }).select("onForAll guardianIds").lean();
  return { onForAll: row?.onForAll === true, ids: new Set((row?.guardianIds ?? []).map((x) => x.toString())) };
}

/** Is the feature on for this guardian? */
export async function guardianFeatureOn(feature: GuardianFeature, guardianId: string): Promise<boolean> {
  const r = await rowOf(feature);
  return r.onForAll || r.ids.has(guardianId);
}

/** The features on for one guardian (drives their sidebar + Today cards). */
export async function guardianFeaturesFor(guardianId: string): Promise<GuardianFeature[]> {
  const rows = await GuardianFeatureAccess.find({}).select("feature onForAll guardianIds").lean();
  return GUARDIAN_FEATURES.filter((f) => {
    const row = rows.find((r) => r.feature === f);
    return !!row && (row.onForAll === true || (row.guardianIds ?? []).some((x) => x.toString() === guardianId));
  });
}

/** Keep only the guardians who can see the feature (notification fan-out). */
export async function guardiansWithFeature<T extends { _id: { toString(): string } }>(feature: GuardianFeature, guardians: T[]): Promise<T[]> {
  if (guardians.length === 0) return guardians;
  const r = await rowOf(feature);
  return r.onForAll ? guardians : guardians.filter((g) => r.ids.has(g._id.toString()));
}

/** Refuse a GUARDIAN caller while the feature is off for them. Staff pass untouched. */
export async function assertGuardianFeature(ctx: AppContext, feature: GuardianFeature): Promise<void> {
  if (!ctx.auth || ctx.auth.role !== "GUARDIAN") return;
  if (!(await guardianFeatureOn(feature, ctx.auth.userId))) throw new ForbiddenError(FEATURE_OFF_BN);
}

// ---------------------------------------------------------------------------
// The switch screen
// ---------------------------------------------------------------------------

export interface GuardianPick {
  guardianId: string;
  name: string;
  phone: string | null;
  /** "আয়েশা (কেজি ক)" — the children this login is linked to. */
  childrenText: string;
}

async function picksOf(guardianIds: Types.ObjectId[] | string[]): Promise<GuardianPick[]> {
  if (guardianIds.length === 0) return [];
  const [guardians, links] = await Promise.all([
    Guardian.find({ _id: { $in: guardianIds } }).select("name phone").lean(),
    GuardianLink.find({ guardianId: { $in: guardianIds } }).select("guardianId studentId active").lean(),
  ]);
  const live = links.filter((l) => l.active !== false);
  const students = await Student.find({ _id: { $in: live.map((l) => l.studentId) } }).select("name nameBn classId sectionId").lean();
  const [classes, sections] = await Promise.all([
    Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("nameBn").lean(),
    Section.find({ _id: { $in: students.map((s) => s.sectionId) } }).select("nameBn").lean(),
  ]);
  const cls = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));
  const sec = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const stu = new Map(students.map((s) => [s._id.toString(), s]));
  return guardians
    .map((g) => {
      const kids = live
        .filter((l) => l.guardianId.toString() === g._id.toString())
        .map((l) => stu.get(l.studentId.toString()))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => {
          const c = cls.get(s.classId?.toString() ?? "") ?? "";
          const sn = sec.get(s.sectionId?.toString() ?? "") ?? "";
          // Section names often carry the class already ("কেজি বালিকা") — never say it twice.
          const where = sn && c && sn.includes(c) ? sn : [c, sn].filter(Boolean).join(" ");
          return `${s.nameBn || s.name}${where ? ` (${where})` : ""}`;
        });
      return { guardianId: g._id.toString(), name: g.name, phone: g.phone ?? null, childrenText: kids.join(", ") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface GuardianFeatureAccessView {
  feature: GuardianFeature;
  onForAll: boolean;
  guardians: GuardianPick[];
}

export async function guardianFeatureAccess(feature: string): Promise<GuardianFeatureAccessView> {
  assertFeature(feature);
  const row = await GuardianFeatureAccess.findOne({ feature }).select("onForAll guardianIds").lean();
  return { feature, onForAll: row?.onForAll === true, guardians: await picksOf(row?.guardianIds ?? []) };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find guardian logins by guardian name / phone, or by a child's name / school ID. */
export async function searchGuardians(q: string): Promise<GuardianPick[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const re = new RegExp(esc(text), "i");
  const digits = text.replace(/\D/g, "");
  const schoolIds = /^\d+$/.test(text) ? [text, text.padStart(4, "0")] : [text];
  const [byGuardian, kids] = await Promise.all([
    Guardian.find({ active: true, $or: [{ name: re }, ...(digits.length >= 4 ? [{ phone: new RegExp(esc(digits)) }] : [])] }).select("_id").limit(20).lean(),
    Student.find({ active: true, $or: [{ name: re }, { nameBn: re }, { schoolId: { $in: schoolIds } }] }).select("_id").limit(20).lean(),
  ]);
  const links = kids.length ? await GuardianLink.find({ studentId: { $in: kids.map((k) => k._id) } }).select("guardianId active").lean() : [];
  const ids = new Set([...byGuardian.map((g) => g._id.toString()), ...links.filter((l) => l.active !== false).map((l) => l.guardianId.toString())]);
  const active = await Guardian.find({ _id: { $in: [...ids] }, active: true }).select("_id").limit(30).lean();
  return picksOf(active.map((g) => g._id));
}

export async function setGuardianFeatureForAll(feature: string, onForAll: boolean, actorId: string): Promise<GuardianFeatureAccessView> {
  assertFeature(feature);
  await GuardianFeatureAccess.updateOne({ feature }, { $set: { onForAll, updatedBy: actorId } }, { upsert: true });
  await writeAudit({ eventKind: "GUARDIAN_FEATURE_SET", actorId, targetKind: "GuardianFeatureAccess", meta: { feature, onForAll } });
  return guardianFeatureAccess(feature);
}

export async function setGuardianFeatureFor(feature: string, guardianId: string, on: boolean, actorId: string): Promise<GuardianFeatureAccessView> {
  assertFeature(feature);
  if (!Types.ObjectId.isValid(guardianId)) throw new ForbiddenError("অভিভাবক পাওয়া যায়নি");
  const g = await Guardian.findById(guardianId).select("_id").lean();
  if (!g) throw new ForbiddenError("অভিভাবক পাওয়া যায়নি");
  const id = new Types.ObjectId(guardianId);
  await GuardianFeatureAccess.updateOne(
    { feature },
    on ? { $addToSet: { guardianIds: id }, $set: { updatedBy: actorId } } : { $pull: { guardianIds: id }, $set: { updatedBy: actorId } },
    { upsert: true },
  );
  await writeAudit({ eventKind: "GUARDIAN_FEATURE_SET", actorId, targetKind: "GuardianFeatureAccess", targetId: guardianId, meta: { feature, guardianId, on } });
  return guardianFeatureAccess(feature);
}
