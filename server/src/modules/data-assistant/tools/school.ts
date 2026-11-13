/**
 * daily_report, notices (docs/prd-data-assistant-mcp.md §7 tools 2, 22).
 *
 * daily_report calls `dailyReportFor` (parts filtered to the viewer's switches by the service) and
 * NOT the `dailyReport` query's `markDailyReportSeen` write: reading through the assistant never
 * marks the person's notification read. Parts are also allow-listed by key (the 12 known parts at
 * build time): a part added later — e.g. by the support-profile build — is dropped until reviewed
 * (§5.6).
 */
import { z } from "zod";
import { callerHasPermission } from "@scd/shared";
import { ANY_PART } from "../../daily-report/partSwitches";
import { dailyReportFor, viewerFor } from "../../daily-report/services/DailyReportService";
import { popupNoticeReport, popupNoticesPage, popupRecipientsPage } from "../../popup-notices/services/PopupNoticeService";
import { assertRule } from "../gates";
import { SHORT_TEXT_CAP, wrapUntrusted } from "../untrusted";
import { type ToolDef } from "../types";
import { cap, checkDay, DATE_KEY, iso, OBJECT_ID } from "./common";

/** The daily-report parts the assistant may pass on (DAILY_REPORT_SECTIONS at DA-1). */
export const DAILY_PARTS_ALLOWED = ["ATTENDANCE", "STAFF", "TEACHING", "HOMEWORK", "ASSIGNMENT", "CLASS_TEST", "MISTAKES", "WORK_BOARD", "OFFICE", "GUARDIANS", "FINANCE", "SYSTEM"] as const;

const DAILY_GATE = { anyOf: ANY_PART } as const;

export const dailyReport: ToolDef = {
  name: "daily_report",
  label_bn: "দৈনিক রিপোর্ট",
  label_en: "Daily school report",
  description:
    "The day at a glance (দৈনিক রিপোর্ট, আজকের অবস্থা, সমস্যা): only the parts you may see — attendance, staff, teaching, homework, assignments, " +
    "class tests, office, finance… each with its numbers and up to 30 listed problems. date defaults to today (a live 'so far' view before the evening send).",
  input: { date: DATE_KEY.optional() },
  gates: [{ mode: "default", rule: DAILY_GATE, resolver: { file: "modules/daily-report/resolvers/dailyReport.ts", field: "dailyReport" } }],
  maxRows: 30,
  async run(ctx, a) {
    assertRule(ctx.auth, DAILY_GATE);
    const args = a as { date?: string };
    const date = args.date ?? ctx.today;
    checkDay(date, ctx.today, 400);
    const viewer = await viewerFor({ ...ctx.auth, userId: ctx.auth.userId });
    const view = await dailyReportFor(date, viewer);
    if (!view) return { data: { date, report: null, note: "No saved report for that day." }, rowCount: 0 };
    const parts = view.parts.filter((p) => (DAILY_PARTS_ALLOWED as readonly string[]).includes(p.key));
    let rows = 0;
    let truncated = false;
    const out = parts.map((p) => {
      const items = cap(p.items ?? [], 30);
      rows += items.rows.length;
      truncated ||= items.truncated || (p.itemsMore ?? 0) > 0;
      return {
        part: p.key,
        status: p.status,
        on_time: p.onTime,
        problems: p.problems,
        mistakes: p.mistakes,
        numbers: Object.fromEntries((p.stats ?? []).map((s) => [s.key, s.value])),
        items: items.rows.map((i) => ({ tone: i.tone, title: i.title, subtitle: i.subtitle ?? null, value: i.value ?? null })),
        more_items: (p.itemsMore ?? 0) + (items.total - items.rows.length),
      };
    });
    return {
      data: { date: view.dateKey, day_type: view.dayType, live: view.live, generated_at: iso(view.generatedAt), headline: view.headline, previous_rate: view.previousRate, parts: out },
      rowCount: rows,
      truncated,
    };
  },
};

const NOTICE_GATE = { anyOf: ["popup_notice:view"] } as const;

export const notices: ToolDef = {
  name: "notices",
  label_bn: "পপ-আপ নোটিশ",
  label_en: "Pop-up notices",
  description:
    "Pop-up notices (নোটিশ, কারা দেখেছে, কারা দেখেনি). Without notice_id: the newest notices with audience, dates and seen / done counts " +
    "(status: DRAFT | PUBLISHED | WITHDRAWN). With notice_id: its report; with recipients=pending|done also up to 100 recipients' names. " +
    "The notice text comes as untrusted_text. No phone numbers.",
  input: {
    status: z.enum(["DRAFT", "PUBLISHED", "WITHDRAWN"]).optional(),
    notice_id: OBJECT_ID.optional(),
    recipients: z.enum(["pending", "done"]).optional(),
  },
  gates: [
    { mode: "default", rule: NOTICE_GATE, resolver: { file: "modules/popup-notices/resolvers/popupNotice.ts", field: "popupNoticesPage" } },
    { mode: "report", rule: NOTICE_GATE, resolver: { file: "modules/popup-notices/resolvers/popupNotice.ts", field: "popupNoticeReport" } },
    { mode: "recipients", rule: NOTICE_GATE, resolver: { file: "modules/popup-notices/resolvers/popupNotice.ts", field: "popupRecipientsPage" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, NOTICE_GATE);
    const args = a as { status?: string; notice_id?: string; recipients?: "pending" | "done" };
    if (args.notice_id) {
      const r = await popupNoticeReport(args.notice_id);
      const out: Record<string, unknown> = {
        notice_id: r.noticeId,
        recipients: r.recipients,
        reachable: r.reachable,
        unreachable: r.unreachable,
        seen: r.seen,
        read: r.read,
        acted: r.acted,
        done: r.done,
        not_seen: r.notSeen,
        choices: r.choices.map((c) => ({ label: c.label, count: c.count })),
        groups: r.groups.map((g) => ({ group: g.group, reachable: g.reachable, seen: g.seen, done: g.done })),
      };
      let rows = 1;
      if (args.recipients) {
        const page = await popupRecipientsPage(args.notice_id, args.recipients === "pending" ? "not_done" : "done", { page: 1, pageSize: 100 });
        // Q3: guardian names only with guardians:view_all. Never the row's phone / wa.me link.
        const guardianNames = callerHasPermission(ctx.auth, "guardians:view_all");
        out.recipient_list = page.rows.map((p) => ({ name: p.kind === "guardian" && !guardianNames ? null : p.name, kind: p.kind, group: p.group, state: p.state, done: p.done }));
        out.recipient_total = page.total;
        rows += page.rows.length;
      }
      return { data: out, rowCount: rows, truncated: false };
    }
    const page = await popupNoticesPage({ page: 1, pageSize: 30, status: args.status ?? null });
    return {
      data: page.rows.map((n) => ({
        notice_id: n.id,
        title: n.titleBn || n.titleEn,
        body: wrapUntrusted(n.bodyBn || n.bodyEn, SHORT_TEXT_CAP),
        audience: n.audienceSummary,
        status: n.displayStatus,
        starts: n.startsAt,
        ends: n.endsOn,
        recipients: n.recipientCount,
        seen: n.seenCount,
        done: n.doneCount,
        pending: Math.max(0, (n.recipientCount ?? 0) - (n.doneCount ?? 0)),
      })),
      rowCount: page.rows.length,
      truncated: page.total > page.rows.length,
      total: page.total,
    };
  },
};
