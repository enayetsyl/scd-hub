/**
 * Safeguarding referral (docs/prd-child-support-profile.md §16.5, D-#1564) — the route OUT of the
 * support profile. Works with the AI off: the term list and the always-present button need no model.
 *
 *  - raise: a referral with the teacher's words and the signs; the receivers (holders of the LOCKED
 *    `safeguarding:receive`) are notified at once; the notice names no child and no detail (SG-3);
 *  - the notice repeats hourly in school hours until the referral is marked seen;
 *  - read / mark seen / one note / "handled outside the app" — receivers only, never under "view as".
 * This file imports nothing from the support-profile module (one-way dependency).
 */
import { Types } from "mongoose";
import { SAFEGUARDING_SIGNS, callerHasPermission, type Permission, type SafeguardingSign } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { writeAudit } from "../services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf } from "../../access-control/services/holders";
import { Student } from "../../foundation/models/Student";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { SafeguardingReferral, type ISafeguardingReferral } from "./SafeguardingReferral";

export class SafeguardingRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeguardingRefusal";
  }
}

const RECEIVE = "safeguarding:receive" as Permission;
export const SAFEGUARDING_NOTICE_BN = "শিশু সুরক্ষা: একজন শিক্ষক এখনই আপনার সাথে কথা বলতে চান";
/** SG-6: a build-up the system noticed across reports — no teacher is waiting to talk, so the notice says what it is. */
export const SAFEGUARDING_PATTERN_NOTICE_BN = "শিশু সুরক্ষা: একটি শিশুর একাধিক রিপোর্টে একই ধরনের বিষয় উঠেছে — দেখুন";
const noticeBodyFor = (source: string): string => (source === "SUPPORT_COMPARE" ? SAFEGUARDING_PATTERN_NOTICE_BN : SAFEGUARDING_NOTICE_BN);

/** Called when a referral is first seen or closed (the support profile clears its SG-6 banner here;
 *  this file imports nothing from that module). */
export type ReferralClosedHook = (ref: { studentId: string; source: string }) => Promise<void>;
const referralClosedHooks: ReferralClosedHook[] = [];
export function onReferralSeen(h: ReferralClosedHook): void {
  if (!referralClosedHooks.includes(h)) referralClosedHooks.push(h);
}

const PREVIEW_BN = "শিক্ষার্থী সহায়তা: নতুন বার্তা";

async function noticeReceivers(referralId: string, slot: string, source: string): Promise<number> {
  let n = 0;
  for (const uid of await holderIdsOf(RECEIVE)) {
    try {
      const r = await emit({
        recipientUserId: uid,
        kind: "SAFEGUARDING",
        titleBn: PREVIEW_BN,
        bodyBn: noticeBodyFor(source),
        dedupeKey: `safeguarding:${referralId}:${slot}:${uid}`,
      });
      if (r.created) n++;
    } catch {
      /* a notice never blocks the referral */
    }
  }
  return n;
}

export async function raiseReferral(input: {
  studentId: string;
  raisedBy: string;
  source: ISafeguardingReferral["source"];
  signs: SafeguardingSign[];
  textBn: string;
  now?: Date;
}): Promise<ISafeguardingReferral> {
  const now = input.now ?? new Date();
  const signs = [...new Set(input.signs)].filter((s) => (SAFEGUARDING_SIGNS as readonly string[]).includes(s));
  const ref = await SafeguardingReferral.create({
    studentId: new Types.ObjectId(input.studentId),
    raisedBy: new Types.ObjectId(input.raisedBy),
    raisedAt: now,
    source: input.source,
    signs,
    textBn: input.textBn.slice(0, 4000),
    lastNotifiedAt: now,
  });
  await writeAudit({
    eventKind: "SAFEGUARDING_REFERRAL_RAISED",
    actorId: input.raisedBy,
    targetId: ref._id.toString(),
    targetKind: "SafeguardingReferral",
    meta: { referralId: ref._id.toString(), studentId: input.studentId, source: input.source, signs },
  });
  await noticeReceivers(ref._id.toString(), "raised", ref.source);
  return ref;
}

function assertReceiver(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new SafeguardingRefusal("লগইন প্রয়োজন।");
  if (auth.impersonatorId) throw new SafeguardingRefusal("\"দেখুন যেভাবে\" অবস্থায় শিশু সুরক্ষার তথ্য দেখা যায় না।");
  if (!callerHasPermission(auth, RECEIVE)) throw new SafeguardingRefusal("শিশু সুরক্ষার তথ্য দেখার অনুমতি নেই।");
  return auth;
}

export interface ReferralShape {
  id: string;
  studentId: string;
  studentName: string;
  raisedAt: Date;
  source: string;
  signs: string[];
  textBn: string;
  status: string;
  seenAt: Date | null;
  noteBn: string | null;
}

export async function listReferrals(
  auth: AuthPayload | null,
  args: { page?: number | null; pageSize?: number | null; open?: boolean | null },
): Promise<{ rows: ReferralShape[]; total: number; page: number; pageSize: number }> {
  assertReceiver(auth);
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 25));
  const filter = args.open ? { status: "RAISED" } : {};
  const [rows, total] = await Promise.all([
    SafeguardingReferral.find(filter).sort({ raisedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    SafeguardingReferral.countDocuments(filter),
  ]);
  const names = new Map(
    (await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select("name nameBn").lean()).map((s) => [String(s._id), s.nameBn || s.name]),
  );
  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      studentId: String(r.studentId),
      studentName: names.get(String(r.studentId)) ?? "",
      raisedAt: r.raisedAt,
      source: r.source,
      signs: r.signs,
      textBn: r.textBn,
      status: r.status,
      seenAt: r.seenAt,
      noteBn: r.noteBn,
    })),
    total,
    page,
    pageSize,
  };
}

export async function markReferral(
  auth: AuthPayload | null,
  id: string,
  action: "SEEN" | "CLOSED_OUTSIDE_APP",
  noteBn?: string | null,
): Promise<boolean> {
  const a = assertReceiver(auth);
  const ref = await SafeguardingReferral.findById(id);
  if (!ref) throw new SafeguardingRefusal("বিষয়টি পাওয়া যায়নি।");
  const firstSeen = !ref.seenAt;
  if (firstSeen) {
    ref.seenAt = new Date();
    ref.seenBy = new Types.ObjectId(a.userId);
  }
  ref.status = action === "CLOSED_OUTSIDE_APP" ? "CLOSED_OUTSIDE_APP" : ref.status === "RAISED" ? "SEEN" : ref.status;
  if (noteBn != null) ref.noteBn = noteBn.slice(0, 300);
  await ref.save();
  if (firstSeen || action === "CLOSED_OUTSIDE_APP") {
    for (const h of referralClosedHooks) {
      try {
        await h({ studentId: String(ref.studentId), source: ref.source });
      } catch {
        /* a hook never blocks the receiver */
      }
    }
  }
  if (firstSeen) {
    await writeAudit({
      eventKind: "SAFEGUARDING_REFERRAL_SEEN",
      actorId: a.userId,
      targetId: id,
      targetKind: "SafeguardingReferral",
      meta: { referralId: id, studentId: String(ref.studentId), source: ref.source, signs: ref.signs },
    });
  }
  return true;
}

/** SG-3: an unseen referral is re-notified hourly in school hours (07:00–17:00 Dhaka). */
export async function renotifyUnseenReferrals(now: Date = new Date()): Promise<number> {
  const hour = Number(now.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", hour12: false }));
  if (hour < 7 || hour >= 17) return 0;
  const due = await SafeguardingReferral.find({ status: "RAISED", lastNotifiedAt: { $lte: new Date(now.getTime() - 60 * 60 * 1000) } }).limit(200);
  let n = 0;
  for (const r of due) {
    n += await noticeReceivers(r._id.toString(), `${dhakaDayKey(now)}T${hour}`, r.source);
    r.lastNotifiedAt = now;
    await r.save();
  }
  return n;
}
