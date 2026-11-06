/**
 * DailyReportShareService (D-#1034) — the share sheet behind the report's share button.
 *
 * A share is the ordinary per-person grant of each chosen part's `reports:daily_*` switch
 * (AccessControlService, audited as USER_ACCESS_CHANGED like any matrix edit) plus a
 * DailyReportShare row remembering which grants the share itself added, the optional end day
 * and the 18:00 notification toggle. Removing a share (by hand or when the end day passes)
 * takes back ONLY those grants: a switch the person held before the share is never touched.
 */
import { Types } from "mongoose";
import {
  DAILY_REPORT_SECTIONS,
  DAILY_REPORT_SECTION_PERMISSION,
  callerHasPermission,
  type DailyReportSection,
  type Permission,
} from "@scd/shared";
import { DailyReportShare, type IDailyReportShare } from "../models/DailyReportShare";
import { User } from "../../foundation/models/User";
import { addGrantedPermission, removeGrantedPermission, type AccessActor } from "../../access-control/services/AccessControlService";
import { dateKeyOf } from "../../attendance/dates";
import { DailyReportError } from "./DailyReportService";

export interface DailyReportShareRow {
  userId: string;
  name: string;
  role: string;
  sections: DailyReportSection[];
  notify: boolean;
  untilKey: string | null;
  expired: boolean;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

async function loadStaff(userId: string) {
  if (!Types.ObjectId.isValid(userId)) throw new DailyReportError("এই কর্মীকে পাওয়া যায়নি।");
  const u = await User.findById(userId).select("name role active additionalTemplates grantedPermissions revokedPermissions").lean();
  if (!u || u.role === "GUARDIAN") throw new DailyReportError("এই কর্মীকে পাওয়া যায়নি।");
  if (!u.active) throw new DailyReportError("এই কর্মীর লগইন বন্ধ আছে।");
  return u;
}

function profileOf(u: { role: string; additionalTemplates?: unknown; grantedPermissions?: unknown; revokedPermissions?: unknown }) {
  return {
    role: u.role,
    additionalTemplates: (u.additionalTemplates ?? []) as never[],
    grantedPermissions: (u.grantedPermissions ?? []) as never[],
    revokedPermissions: (u.revokedPermissions ?? []) as never[],
  } as Parameters<typeof callerHasPermission>[0];
}

export async function listShares(todayKey = dateKeyOf(new Date())): Promise<DailyReportShareRow[]> {
  const shares = (await DailyReportShare.find({}).lean()) as unknown as IDailyReportShare[];
  const users = await User.find({ _id: { $in: shares.map((s) => s.userId) } }).select("name role").lean();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return shares
    .map((s) => {
      const u = byId.get(s.userId.toString());
      return {
        userId: s.userId.toString(),
        name: u?.name ?? "—",
        role: u?.role ?? "",
        sections: s.sections,
        notify: s.notify,
        untilKey: s.untilKey,
        expired: !!s.untilKey && s.untilKey < todayKey,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Give one person exactly these parts (replacing their previous share). Grants the switches
 * they do not hold yet; takes back the share's own earlier grants that are no longer chosen.
 */
export async function shareDailyReport(
  actor: AccessActor,
  input: { userId: string; sections: string[]; notify: boolean; untilKey: string | null },
  todayKey = dateKeyOf(new Date()),
): Promise<DailyReportShareRow> {
  if (input.userId === actor.userId) throw new DailyReportError("নিজের সঙ্গে শেয়ার করার দরকার নেই।");
  const sections = [...new Set(input.sections)] as DailyReportSection[];
  if (sections.length === 0) throw new DailyReportError("অন্তত একটি অংশ বেছে নিন, অথবা শেয়ার সরিয়ে দিন।");
  if (sections.some((s) => !(DAILY_REPORT_SECTIONS as readonly string[]).includes(s))) {
    throw new DailyReportError("অজানা অংশ।");
  }
  if (input.untilKey !== null && (!DATE_KEY.test(input.untilKey) || input.untilKey < todayKey)) {
    throw new DailyReportError("শেষের তারিখ আজ বা তার পরের কোনো দিন হতে হবে।");
  }
  const user = await loadStaff(input.userId);
  const prev = (await DailyReportShare.findOne({ userId: input.userId }).lean()) as unknown as IDailyReportShare | null;
  const prevGranted = new Set(prev?.grantedPerms ?? []);
  const wanted = new Set<string>(sections.map((s) => DAILY_REPORT_SECTION_PERMISSION[s]));

  // Take back the share's own grants that are no longer chosen.
  for (const perm of prevGranted) {
    if (!wanted.has(perm)) await removeGrantedPermission(actor, input.userId, perm);
  }
  // Grant what they do not already hold (through their role, the matrix, or this share).
  const granted: string[] = [];
  let profile = profileOf(user);
  for (const perm of wanted) {
    if (prevGranted.has(perm)) {
      granted.push(perm);
      continue;
    }
    if (callerHasPermission(profile, perm as Permission)) continue;
    const shape = await addGrantedPermission(actor, input.userId, perm);
    profile = profileOf({ role: shape.role, additionalTemplates: shape.additionalTemplates, grantedPermissions: shape.grantedPermissions, revokedPermissions: shape.revokedPermissions });
    granted.push(perm);
  }

  await DailyReportShare.updateOne(
    { userId: new Types.ObjectId(input.userId) },
    {
      $set: {
        sections,
        grantedPerms: granted,
        notify: input.notify,
        untilKey: input.untilKey,
        sharedBy: new Types.ObjectId(actor.userId),
      },
    },
    { upsert: true },
  );
  const row = (await listShares(todayKey)).find((r) => r.userId === input.userId);
  if (!row) throw new DailyReportError("শেয়ার সংরক্ষণ করা যায়নি।");
  return row;
}

/** Remove a share: take back exactly the grants it added, then delete it. */
export async function removeDailyReportShare(actor: AccessActor, userId: string): Promise<boolean> {
  const share = (await DailyReportShare.findOne({ userId }).lean()) as unknown as IDailyReportShare | null;
  if (!share) return false;
  for (const perm of share.grantedPerms) {
    try {
      await removeGrantedPermission(actor, userId, perm);
    } catch (err) {
      // A deleted / guardian user cannot be edited — the row still goes.
      console.error("[dailyReport] removing a share grant failed:", err);
    }
  }
  await DailyReportShare.deleteOne({ _id: share._id });
  return true;
}

/** Scheduler: shares whose end day has passed are removed (the system acts as the sharer). */
export async function sweepExpiredShares(todayKey: string): Promise<number> {
  const expired = (await DailyReportShare.find({ untilKey: { $ne: null, $lt: todayKey } }).lean()) as unknown as IDailyReportShare[];
  let n = 0;
  for (const s of expired) {
    try {
      const actor: AccessActor = { userId: s.sharedBy.toString(), role: "PRINCIPAL" };
      if (await removeDailyReportShare(actor, s.userId.toString())) n += 1;
    } catch (err) {
      console.error("[dailyReport] expiring a share failed (next day retries):", err);
    }
  }
  return n;
}
