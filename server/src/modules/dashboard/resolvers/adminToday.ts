/**
 * adminToday resolver (D-#316) — the Principal/Office Today dashboard: one
 * generic-card aggregate per day. Gate: Principal/Office by ROLE (the
 * reconciliationReport precedent, D-#88/#290) — school-wide oversight, and
 * OFFICE holds no tracker:read.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  adminToday,
  type AdminTodayCard,
  type AdminCardBadge,
  type AdminCardRow,
} from "../services/AdminTodayService";

function assertDashboardAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("ড্যাশবোর্ড শুধুমাত্র অধ্যক্ষ/অফিসের জন্য");
  }
}

const AdminCardBadgeRef = builder.objectRef<AdminCardBadge>("AdminCardBadge").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    value: t.exposeInt("value"),
    tone: t.exposeString("tone"),
  }),
});

const AdminCardRowRef = builder.objectRef<AdminCardRow>("AdminCardRow").implement({
  fields: (t) => ({
    title: t.exposeString("title"),
    subtitle: t.string({ nullable: true, resolve: (r) => r.subtitle }),
    value: t.string({ nullable: true, resolve: (r) => r.value }),
    tone: t.exposeString("tone"),
  }),
});

const AdminTodayCardRef = builder.objectRef<AdminTodayCard>("AdminTodayCard").implement({
  description:
    "One generic dashboard card (D-#316): key → the app's icon/title/deep-link registry; " +
    "badges are language-free keys the app labels; rows carry names + language-neutral codes.",
  fields: (t) => ({
    key: t.exposeString("key"),
    badges: t.field({ type: [AdminCardBadgeRef], resolve: (c) => c.badges }),
    rows: t.field({ type: [AdminCardRowRef], resolve: (c) => c.rows }),
    moreCount: t.exposeInt("moreCount"),
  }),
});

builder.queryField("adminToday", (t) =>
  t.field({
    type: [AdminTodayCardRef],
    description: "The Principal/Office Today dashboard — every module's day at a glance (D-#316).",
    authScopes: { authenticated: true },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertDashboardAdmin(ctx);
      return adminToday(args.date);
    },
  }),
);
