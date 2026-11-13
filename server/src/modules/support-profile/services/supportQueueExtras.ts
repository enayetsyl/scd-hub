/**
 * The Principal's review helpers (docs/prd-child-support-profile.md §6.5, §9.4; D-#1555 part).
 *  - quickApprovable: tone POSITIVE or result WORKED · no flag left · no disagreement · COMPARE shows
 *    no CONTRADICTS_* · no safeguarding question · the check was not skipped · not GUARDIAN_INFO.
 *    There is no "approve all": each still has its own অনুমোদন button.
 *  - the evidence preview (computed, never asked from a model): for each DRAFT item that cites the
 *    report provisionally, its level from approved reports now → its level if this report is approved.
 *  - the daily 16:00 digest to approvers.
 */
import { evidenceLevel, levelRank, sideOfSection, SUPPORT_SECTIONS, type Permission, type SupportLevel, type SupportSection } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { SupportReport, type ISupportReport } from "../models/SupportReport";
import { SupportProfileVersion } from "../models/SupportProfileVersion";
import { notifyHolders } from "./supportNotify";

/**
 * §9.4. COMPARE must have run and shown nothing against the report: no compare → never quick
 * (a report nobody compared is not "cleared"); a CONTRADICTS_* or a build-up (SG-6) → not quick;
 * a child with a safeguarding banner → not quick.
 */
export function isQuickApprovable(r: ISupportReport, opts: { banner?: boolean } = {}): boolean {
  const compare = (r as unknown as { compare?: { agreement?: { status: string }[]; safeguardingPattern?: { present?: boolean } } | null }).compare;
  if (compare == null || opts.banner) return false;
  if (r.status === "SAFEGUARDING_ROUTED" || compare.safeguardingPattern?.present) return false;
  return (
    r.status === "PROCESSED" &&
    (r.tone === "POSITIVE" || r.result === "WORKED") &&
    r.openFlags.length === 0 &&
    r.teacherDisagreements.length === 0 &&
    !(compare.agreement ?? []).some((a) => a.status.startsWith("CONTRADICTS_")) &&
    r.safeguardingAsked === "NONE" &&
    r.safeguardingHold === "NONE" &&
    r.checkSkipped === "NONE" &&
    r.source !== "GUARDIAN_INFO"
  );
}

export interface PreviewItem {
  section: SupportSection;
  textBn: string;
  levelNow: SupportLevel | null;
  levelIfApproved: SupportLevel | null;
}

export async function evidencePreview(r: ISupportReport): Promise<PreviewItem[]> {
  if (!r.profileId) return [];
  const draft = await SupportProfileVersion.findOne({ profileId: r.profileId, status: "DRAFT" }).sort({ versionNo: -1 }).lean();
  if (!draft) return [];
  const today = dhakaDayKey(new Date());
  const out: PreviewItem[] = [];
  for (const section of SUPPORT_SECTIONS) {
    for (const it of draft.sections?.[section] ?? []) {
      const cites = [...it.evidence, ...it.provisionalEvidence].map(String);
      if (!cites.includes(String(r._id))) continue;
      const reps = await SupportReport.find({ _id: { $in: cites } }).select("authorId occurredOn periodNo context subject source result status").lean();
      const ev = (x: (typeof reps)[number]) => ({ id: String(x._id), authorId: String(x.authorId), occurredOn: x.occurredOn, slot: x.periodNo != null ? `P${x.periodNo}` : (x.context ?? "OTHER"), setting: x.subject || x.context || "OTHER", source: x.source, result: x.result });
      const side = sideOfSection(section) ?? "POSITIVE";
      const now = evidenceLevel({ side, todayKey: today, isStrategy: section === "works", evidence: reps.filter((x) => x.status === "APPROVED").map(ev) });
      const ifApproved = evidenceLevel({ side, todayKey: today, isStrategy: section === "works", evidence: reps.filter((x) => x.status === "APPROVED" || String(x._id) === String(r._id)).map(ev) });
      out.push({ section, textBn: it.textBn, levelNow: now.level, levelIfApproved: levelRank(ifApproved.level) >= levelRank(now.level) ? ifApproved.level : now.level });
    }
  }
  return out;
}

/** §9.7: the 16:00 digest — once a day per recipient, counts only PROCESSED reports. */
export async function dailyDigest(now: Date = new Date()): Promise<number> {
  const n = await SupportReport.countDocuments({ status: "PROCESSED" });
  if (!n) return 0;
  return notifyHolders("support_profile:approve" as Permission, `সহায়তা রিপোর্ট: ${n.toLocaleString("bn-BD")} টি অনুমোদনের অপেক্ষায়`, `support-digest:${dhakaDayKey(now)}`);
}
