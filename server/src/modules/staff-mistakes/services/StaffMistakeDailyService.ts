/**
 * The end-of-day mistake report (D-#1016, docs/prd-staff-mistakes.md §18).
 *
 * At 18:00 Dhaka every holder of `staff_mistakes:view_all` (the Principal by default, and
 * whoever the Principal gives it to) gets ONE notification naming who made which mistake that
 * day; tapping it opens that day's list. A day with nothing to report sends nothing. Accepted
 * entries (approved leave, a "not a mistake" button) and moved-away rows are left out. A
 * Principal's own entries reach only holders of review_principal (D-#1000). Entries recorded
 * after 18:00 are in the day's list, not in that evening's notification.
 */
import { STAFF_MISTAKE_KIND_TITLE_BN, type StaffMistakeKind } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";
import { personName } from "../../../lib/personName";
import { StaffMistake } from "../models/StaffMistake";
import { User } from "../../foundation/models/User";
import { holderIdsOf } from "../../access-control/services/holders";
import { emitStaffMistakeDaily } from "../../notifications/services/emitters";
import { PRINCIPAL_REVIEW, principalUserIds } from "./principalPrivacy";

export const STAFF_MISTAKE_DAILY_MINUTES = 18 * 60;
/** People named in one notification; the rest are "আরও N জন". */
const MAX_PEOPLE = 8;

interface PersonDay {
  staffUserId: string;
  name: string;
  kinds: Map<StaffMistakeKind, number>;
  total: number;
}

/** One person's line: "রহিমা (৩): উপস্থিতি বদলানো ×২; …". */
function personLine(p: PersonDay): string {
  const parts = [...p.kinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${STAFF_MISTAKE_KIND_TITLE_BN[k] ?? k}${n > 1 ? ` ×${bnNum(n)}` : ""}`);
  return `${p.name} (${bnNum(p.total)}): ${parts.join("; ")}`;
}

export function dailyReportText(people: PersonDay[]): { titleBn: string; bodyBn: string } {
  const total = people.reduce((s, p) => s + p.total, 0);
  const shown = people.slice(0, MAX_PEOPLE).map(personLine);
  const more = people.length > MAX_PEOPLE ? [`আরও ${bnNum(people.length - MAX_PEOPLE)} জন — তালিকায় দেখুন`] : [];
  return {
    titleBn: `আজকের কর্মীর ভুল: ${bnNum(total)}টি (${bnNum(people.length)} জন)`,
    bodyBn: [...shown, ...more].join("\n"),
  };
}

/** Send the day's report. Returns how many notifications went out. */
export async function dispatchStaffMistakeDaily(now: Date = new Date()): Promise<number> {
  const dateKey = dhakaDayKey(now);
  const rows = await StaffMistake.find({ dateKey, status: { $in: ["EXPLANATION_DUE", "PENDING_REVIEW", "COUNTED"] } })
    .select("staffUserId kind")
    .lean();
  if (rows.length === 0) return 0;
  const recipients = await holderIdsOf("staff_mistakes:view_all");
  if (recipients.length === 0) return 0;

  const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.staffUserId)))] } })
    .select("name nameBn")
    .lean();
  const names = new Map(users.map((u) => [String(u._id), personName(u)]));
  const byPerson = new Map<string, PersonDay>();
  for (const r of rows) {
    const id = String(r.staffUserId);
    const p = byPerson.get(id) ?? { staffUserId: id, name: names.get(id) ?? "কর্মী", kinds: new Map(), total: 0 };
    p.kinds.set(r.kind as StaffMistakeKind, (p.kinds.get(r.kind as StaffMistakeKind) ?? 0) + 1);
    p.total += 1;
    byPerson.set(id, p);
  }
  const people = [...byPerson.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const principals = new Set(await principalUserIds());
  const mayHandlePrincipal = new Set(await holderIdsOf(PRINCIPAL_REVIEW));
  let sent = 0;
  for (const to of recipients) {
    const visible = mayHandlePrincipal.has(to) ? people : people.filter((p) => !principals.has(p.staffUserId));
    if (visible.length === 0) continue;
    const text = dailyReportText(visible);
    await emitStaffMistakeDaily({ recipientUserId: to, dateKey, ...text });
    sent += 1;
  }
  return sent;
}
