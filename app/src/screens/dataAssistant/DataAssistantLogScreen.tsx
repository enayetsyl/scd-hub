/**
 * DataAssistantLogScreen (docs/prd-data-assistant-mcp.md §11, DA-4) — "তথ্য সহকারীর লগ", the
 * Principal only (data_assistant:audit): every tool call, newest first, paged (D-#761). Filters:
 * tool, outcome, door (app / Claude), Dhaka date range. Each row: time, person (and the Principal
 * when testing as them), door / client, tool, short arguments, outcome, rows, KB, ms.
 */
import React from "react";
import { useQuery } from "urql";
import { DATA_TOOL_CALLS_PAGE, type DataToolCallT } from "../../graphql/dataAssistantAdmin";
import { Screen, Card, Body, Muted, Loader, ErrorBanner, Select, Field, Badge } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fill } from "../aiWorkspace/aiWorkspaceUi";

const PAGE_SIZE = 50;
const OUTCOMES = ["ok", "denied", "invalid", "limited", "error", "off"];
const KEY = /^\d{4}-\d{2}-\d{2}$/;

function Row({ r }: { r: DataToolCallT }): React.ReactElement {
  const args = r.args.length > 160 ? `${r.args.slice(0, 160)}…` : r.args;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{`${r.tool} · ${r.userName ?? r.userId}`}</Body>
      <Muted>{fill(STR.daLogMeta, { at: isoDateTimeLabel(r.at), door: r.surface === "claude" ? r.clientName ?? "Claude" : STR.daLogInApp, rows: r.rowCount, kb: (r.replyBytes / 1024).toFixed(1), ms: r.ms })}</Muted>
      {r.impersonatorName ? <Muted>{fill(STR.daLogViewAs, { name: r.impersonatorName })}</Muted> : null}
      <Muted>{args}</Muted>
      <Badge text={r.outcome} tone={r.outcome === "ok" ? "ok" : r.outcome === "denied" ? "warn" : "danger"} />
    </Card>
  );
}

export default function DataAssistantLogScreen(): React.ReactElement {
  const [tool, setTool] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<string | null>(null);
  const [surface, setSurface] = React.useState<string | null>(null);
  const [fromKey, setFrom] = React.useState("");
  const [toKey, setTo] = React.useState("");
  const filterKey = `${tool}|${outcome}|${surface}|${fromKey}|${toKey}`;
  const [page, setPage] = usePageState(filterKey);
  const [q] = useQuery({
    query: DATA_TOOL_CALLS_PAGE,
    variables: { tool, outcome, surface, fromKey: KEY.test(fromKey) ? fromKey : null, toKey: KEY.test(toKey) ? toKey : null, page, pageSize: PAGE_SIZE },
    requestPolicy: "cache-and-network",
  });
  const data = q.data?.dataToolCallsPage;
  const toolOptions = [{ label: STR.daLogAll, value: "" }, ...["my_access", "daily_report", "find_students", "student_overview", "attendance_day", "student_attendance_history", "attendance_ranking", "homework_status", "assignment_status", "class_test_status", "class_test_marks", "exam_results", "mastery_overview", "lesson_progress", "routine_lookup", "find_staff", "staff_attendance", "staff_leave", "payroll_summary", "finance_summary", "fee_dues", "notices", "question_bank_stats", "monthly_report_status"].map((t) => ({ label: t, value: t }))];
  return (
    <Screen scroll>
      <Card>
        <Select label={STR.daLogTool} value={tool ?? ""} options={toolOptions} onChange={(v) => setTool(v || null)} />
        <Select label={STR.daLogOutcome} value={outcome ?? ""} options={[{ label: STR.daLogAll, value: "" }, ...OUTCOMES.map((o) => ({ label: o, value: o }))]} onChange={(v) => setOutcome(v || null)} />
        <Select
          label={STR.daLogDoor}
          value={surface ?? ""}
          options={[{ label: STR.daLogAll, value: "" }, { label: STR.daLogInApp, value: "in_app" }, { label: "Claude", value: "claude" }]}
          onChange={(v) => setSurface(v || null)}
        />
        <Field label={STR.daLogFrom} value={fromKey} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
        <Field label={STR.daLogTo} value={toKey} onChangeText={setTo} placeholder="YYYY-MM-DD" />
      </Card>
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data && data.rows.length === 0 ? <Muted>{STR.daLogNone}</Muted> : null}
      {data?.rows.map((r) => <Row key={r.id} r={r} />)}
      {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
    </Screen>
  );
}
