/**
 * Daily school report (D-#1013–#1018, docs/prd-daily-report.md). Reads open to anyone holding
 * at least one part's switch; the service then shows only the parts that person holds. Sharing
 * is `reports:daily_share`, settings `reports:daily_settings` (both Principal by default).
 */
import { builder } from "../../../schema";
import { ANY_PART } from "../partSwitches";
import type { IDailyReportItem, IDailyReportLink, IDailyReportPart, IDailyReportStat } from "../models/DailyReport";
import {
  dailyReportFor,
  getSettings,
  liveReport,
  markDailyReportSeen,
  myUnreadDailyReport,
  reportHistory,
  saveSettings,
  viewerFor,
  type DailyReportHeadline,
  type DailyReportHistory,
  type DailyReportSettingsShape,
  type DailyReportView,
  type HistoryDay,
  type HistoryPart,
  type RepeatedProblem,
} from "../services/DailyReportService";
import { listShares, removeDailyReportShare, shareDailyReport, type DailyReportShareRow } from "../services/DailyReportShareService";
import type { AuthPayload } from "../../../context";
import { User } from "../../foundation/models/User";


const viewer = (auth: AuthPayload) => viewerFor({ ...auth, userId: auth.userId });

const LinkRef = builder.objectRef<IDailyReportLink>("DailyReportLink");
LinkRef.implement({
  fields: (t) => ({
    tab: t.exposeString("tab"),
    screen: t.exposeString("screen"),
    params: t.exposeString("params", { description: "JSON object of string route params." }),
    perms: t.exposeStringList("perms", { description: "Any of these opens the target; hide the jump otherwise." }),
  }),
});

const ItemRef = builder.objectRef<IDailyReportItem>("DailyReportItem");
ItemRef.implement({
  fields: (t) => ({
    tone: t.exposeString("tone"),
    title: t.exposeString("title"),
    subtitle: t.string({ nullable: true, resolve: (i) => i.subtitle }),
    value: t.string({ nullable: true, resolve: (i) => i.value }),
    link: t.field({ type: LinkRef, nullable: true, resolve: (i) => i.link }),
  }),
});

const StatRef = builder.objectRef<IDailyReportStat>("DailyReportStat");
StatRef.implement({ fields: (t) => ({ key: t.exposeString("key"), value: t.exposeInt("value") }) });

const PartRef = builder.objectRef<IDailyReportPart>("DailyReportPart");
PartRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    status: t.exposeString("status"),
    onTime: t.exposeInt("onTime"),
    problems: t.exposeInt("problems"),
    mistakes: t.exposeInt("mistakes"),
    stats: t.field({ type: [StatRef], resolve: (p) => p.stats }),
    items: t.field({ type: [ItemRef], resolve: (p) => p.items }),
    itemsMore: t.exposeInt("itemsMore"),
    link: t.field({ type: LinkRef, nullable: true, resolve: (p) => p.link }),
    fixedLater: t.int({ resolve: (p) => p.fixedLater ?? 0 }),
  }),
});

const HeadlineRef = builder.objectRef<DailyReportHeadline>("DailyReportHeadline");
HeadlineRef.implement({
  fields: (t) => ({
    onTime: t.exposeInt("onTime"),
    problems: t.exposeInt("problems"),
    mistakes: t.exposeInt("mistakes"),
    rate: t.int({ nullable: true, resolve: (h) => h.rate }),
  }),
});

const ViewRef = builder.objectRef<DailyReportView>("DailyReportView");
ViewRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    dayType: t.exposeString("dayType"),
    generatedAt: t.string({ nullable: true, resolve: (v) => (v.generatedAt ? new Date(v.generatedAt).toISOString() : null) }),
    live: t.exposeBoolean("live"),
    headline: t.field({ type: HeadlineRef, resolve: (v) => v.headline }),
    previousRate: t.int({ nullable: true, resolve: (v) => v.previousRate }),
    fixedLater: t.exposeInt("fixedLater"),
    parts: t.field({ type: [PartRef], resolve: (v) => v.parts }),
  }),
});

const HistoryDayRef = builder.objectRef<HistoryDay>("DailyReportHistoryDay");
HistoryDayRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    onTime: t.exposeInt("onTime"),
    problems: t.exposeInt("problems"),
    mistakes: t.exposeInt("mistakes"),
    rate: t.int({ nullable: true, resolve: (d) => d.rate }),
  }),
});

const HistoryPartRef = builder.objectRef<HistoryPart>("DailyReportHistoryPart");
HistoryPartRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    onTime: t.exposeInt("onTime"),
    problems: t.exposeInt("problems"),
    mistakes: t.exposeInt("mistakes"),
    rate: t.int({ nullable: true, resolve: (p) => p.rate }),
    prevRate: t.int({ nullable: true, resolve: (p) => p.prevRate }),
  }),
});

const RepeatedRef = builder.objectRef<RepeatedProblem>("DailyReportRepeated");
RepeatedRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    title: t.exposeString("title"),
    subtitle: t.string({ nullable: true, resolve: (r) => r.subtitle }),
    days: t.exposeInt("days"),
  }),
});

const HistoryRef = builder.objectRef<DailyReportHistory>("DailyReportHistory");
HistoryRef.implement({
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    days: t.field({ type: [HistoryDayRef], resolve: (h) => h.days }),
    total: t.field({ type: HeadlineRef, resolve: (h) => h.total }),
    previous: t.field({ type: HeadlineRef, resolve: (h) => h.previous }),
    parts: t.field({ type: [HistoryPartRef], resolve: (h) => h.parts }),
    repeated: t.field({ type: [RepeatedRef], resolve: (h) => h.repeated }),
  }),
});

const ShareRef = builder.objectRef<DailyReportShareRow>("DailyReportShare");
ShareRef.implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
    sections: t.exposeStringList("sections"),
    notify: t.exposeBoolean("notify"),
    untilKey: t.string({ nullable: true, resolve: (s) => s.untilKey }),
    expired: t.exposeBoolean("expired"),
  }),
});

const SettingsRef = builder.objectRef<DailyReportSettingsShape>("DailyReportSettings");
SettingsRef.implement({
  fields: (t) => ({
    sendMinutes: t.exposeInt("sendMinutes"),
    headlineSections: t.exposeStringList("headlineSections"),
    notifyPrincipal: t.exposeBoolean("notifyPrincipal"),
  }),
});

// --- Reads -----------------------------------------------------------------

builder.queryField("dailyReport", (t) =>
  t.field({
    type: ViewRef,
    nullable: true,
    description: "One day's saved report (today before the send time: the live 'so far' view). Null = no report that day. Opening it marks its notification read.",
    authScopes: { hasAnyPermission: ANY_PART },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const v = await viewer(ctx.auth!);
      const view = await dailyReportFor(args.date, v);
      if (view && !view.live) await markDailyReportSeen(v.userId, args.date);
      return view;
    },
  }),
);

builder.queryField("dailyReportLive", (t) =>
  t.field({
    type: ViewRef,
    description: "Today so far — built now, never saved.",
    authScopes: { hasAnyPermission: ANY_PART },
    resolve: async (_r, _a, ctx) => liveReport(await viewer(ctx.auth!)),
  }),
);

builder.queryField("dailyReportHistory", (t) =>
  t.field({
    type: HistoryRef,
    description: "Totals over saved days in [from, to], the same span before it, and the repeated problems.",
    authScopes: { hasAnyPermission: ANY_PART },
    args: { from: t.arg.string({ required: true }), to: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => reportHistory(args.from, args.to, await viewer(ctx.auth!)),
  }),
);

builder.queryField("myUnreadDailyReport", (t) =>
  t.field({
    type: ViewRef,
    nullable: true,
    description: "The newest daily report whose notification this person has not opened (the Today card).",
    authScopes: { hasAnyPermission: ANY_PART },
    resolve: async (_r, _a, ctx) => myUnreadDailyReport(await viewer(ctx.auth!)),
  }),
);

builder.queryField("myDailyReportParts", (t) =>
  t.stringList({
    description: "The parts this person may see.",
    authScopes: { hasAnyPermission: ANY_PART },
    resolve: async (_r, _a, ctx) => (await viewer(ctx.auth!)).sections,
  }),
);

builder.queryField("dailyReportShares", (t) =>
  t.field({
    type: [ShareRef],
    authScopes: { hasPermission: "reports:daily_share" },
    resolve: async () => listShares(),
  }),
);

interface ShareCandidate {
  id: string;
  name: string;
  role: string;
}
const CandidateRef = builder.objectRef<ShareCandidate>("DailyReportShareCandidate");
CandidateRef.implement({ fields: (t) => ({ id: t.exposeString("id"), name: t.exposeString("name"), role: t.exposeString("role") }) });

builder.queryField("dailyReportShareCandidates", (t) =>
  t.field({
    type: [CandidateRef],
    description: "Active staff logins (teachers, office, other Principals) the report can be shared with — never guardians or the caller.",
    authScopes: { hasPermission: "reports:daily_share" },
    resolve: async (_r, _a, ctx) => {
      const users = await User.find({ active: true, role: { $ne: "GUARDIAN" }, _id: { $ne: ctx.auth!.userId } })
        .select("name role")
        .sort({ name: 1 })
        .lean();
      return users.map((u) => ({ id: u._id.toString(), name: u.name, role: u.role }));
    },
  }),
);

builder.queryField("dailyReportSettings", (t) =>
  t.field({
    type: SettingsRef,
    authScopes: { hasAnyPermission: ["reports:daily_settings", "reports:daily_share"] },
    resolve: async () => getSettings(),
  }),
);

// --- Writes ----------------------------------------------------------------

builder.mutationField("shareDailyReport", (t) =>
  t.field({
    type: ShareRef,
    authScopes: { hasPermission: "reports:daily_share" },
    args: {
      userId: t.arg.string({ required: true }),
      sections: t.arg.stringList({ required: true }),
      notify: t.arg.boolean({ required: true }),
      untilKey: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      shareDailyReport(
        { userId: ctx.auth!.userId, role: ctx.auth!.role },
        { userId: args.userId, sections: args.sections, notify: args.notify, untilKey: args.untilKey ?? null },
      ),
  }),
);

builder.mutationField("removeDailyReportShare", (t) =>
  t.boolean({
    authScopes: { hasPermission: "reports:daily_share" },
    args: { userId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => removeDailyReportShare({ userId: ctx.auth!.userId, role: ctx.auth!.role }, args.userId),
  }),
);

builder.mutationField("saveDailyReportSettings", (t) =>
  t.field({
    type: SettingsRef,
    authScopes: { hasPermission: "reports:daily_settings" },
    args: {
      sendMinutes: t.arg.int({ required: true }),
      headlineSections: t.arg.stringList({ required: true }),
      notifyPrincipal: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      saveSettings({ sendMinutes: args.sendMinutes, headlineSections: args.headlineSections, notifyPrincipal: args.notifyPrincipal }, ctx.auth!.userId),
  }),
);
