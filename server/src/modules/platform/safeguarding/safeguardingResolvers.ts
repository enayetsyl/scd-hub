/**
 * শিশু সুরক্ষা — safeguarding referrals (docs/prd-child-support-profile.md §16.5 SG-7, D-#1564).
 * Only the holder of the LOCKED `safeguarding:receive`; never under "view as" (the service refuses).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { listReferrals, markReferral, type ReferralShape } from "./SafeguardingService";

const ReferralRef = builder.objectRef<ReferralShape>("SafeguardingReferral").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    raisedAt: t.string({ resolve: (r) => r.raisedAt.toISOString() }),
    source: t.exposeString("source"),
    signs: t.exposeStringList("signs"),
    textBn: t.exposeString("textBn"),
    status: t.exposeString("status"),
    seenAt: t.string({ nullable: true, resolve: (r) => r.seenAt?.toISOString() ?? null }),
    noteBn: t.string({ nullable: true, resolve: (r) => r.noteBn }),
  }),
});
const ReferralPageRef = pageRef("SafeguardingReferralPage", ReferralRef);

builder.queryField("safeguardingReferralsPage", (t) =>
  t.field({
    type: ReferralPageRef,
    authScopes: { hasPermission: "safeguarding:receive" },
    args: { open: t.arg.boolean({ required: false }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => listReferrals(ctx.auth, a),
  }),
);

builder.mutationField("markSafeguardingReferral", (t) =>
  t.boolean({
    description: "SEEN (দেখেছি) or CLOSED_OUTSIDE_APP (অ্যাপের বাইরে ব্যবস্থা নেওয়া হয়েছে), with one optional note line.",
    authScopes: { hasPermission: "safeguarding:receive" },
    args: { id: t.arg.string({ required: true }), action: t.arg.string({ required: true }), noteBn: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => markReferral(ctx.auth, a.id, a.action === "CLOSED_OUTSIDE_APP" ? "CLOSED_OUTSIDE_APP" : "SEEN", a.noteBn),
  }),
);
