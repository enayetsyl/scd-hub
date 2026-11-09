/**
 * AiUsageReportScreen (AI-7, D-#1140) — the Principal's AI report: this month's budget,
 * spend and usage for a date range (by day, person, feature, model), and each writer's
 * comment-check results (checks, issues, accepted, kept their own, saved unchecked).
 * `reports:ai_usage` (Principal by default); the server re-enforces. CSV on the web.
 */
import React from "react";
import { Platform, View } from "react-native";
import { useQuery } from "urql";
import { AI_USAGE_REPORT, type AiUsageBucketT } from "../../graphql/aiUsageReport";
import { Screen, Card, Body, Muted, Button, Loader, ErrorBanner, Notice } from "../../components/ui";
import { useReportRange } from "../../components/ReportFilters";
import { useColors } from "../../theme";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const usd = (n: number | null | undefined) => (n == null ? "—" : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const pctOf = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}
function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>): void {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  // Leading BOM so Excel opens the Bangla CSV as UTF-8 (the ClassNoteReport pattern).
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Bar({ pct, tone }: { pct: number; tone: "ok" | "warn" | "danger" }): React.ReactElement {
  const colors = useColors() as unknown as Record<string, string>;
  const color = tone === "danger" ? colors.danger ?? "#c0392b" : tone === "warn" ? colors.warning ?? "#d68910" : colors.primary ?? "#1b6b4a";
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border ?? "#ddd", overflow: "hidden", marginVertical: space(1) }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

function BucketTable({ title, rows }: { title: string; rows: AiUsageBucketT[] }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      {rows.length === 0 ? <Muted>{STR.aurNone}</Muted> : null}
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), paddingVertical: space(0.5) }}>
          <Body style={{ flexShrink: 1 }}>{r.label}</Body>
          <Muted>{fill(STR.aurRow, { calls: r.calls, usd: usd(r.usd), capped: r.capped, errors: r.errors })}</Muted>
        </View>
      ))}
    </Card>
  );
}

export default function AiUsageReportScreen(): React.ReactElement {
  const { fromKey, toKey, node } = useReportRange(30);
  const [q] = useQuery({ query: AI_USAGE_REPORT, variables: { fromKey, toKey }, requestPolicy: "cache-and-network" });
  const r = q.data?.aiUsageReport;
  const maxDay = Math.max(0.000001, ...(r?.byDay ?? []).map((d) => d.usd));

  function exportCsv(): void {
    if (!r) return;
    downloadCsv(
      `ai-usage-${r.fromKey}-${r.toKey}.csv`,
      ["section", "name", "calls / checks", "usd", "capped", "errors", "issues found", "accepted %", "kept own %", "not checked"],
      [
        ...r.byPerson.map((p) => ["usage", p.label, p.calls, p.usd, p.capped, p.errors, null, null, null, null]),
        ...r.quality.map((x) => ["quality", x.name, x.checks, null, null, null, x.issuesFound, x.acceptanceRate == null ? null : Math.round(x.acceptanceRate * 100), x.overrideRate == null ? null : Math.round(x.overrideRate * 100), x.notChecked]),
      ],
    );
  }

  return (
    <Screen scroll>
      <Card>{node}</Card>
      {q.fetching && !r ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {r ? (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.aurBudgetTitle}</Body>
            {r.budget.map((b) => (
              <View key={b.scope} style={{ marginTop: space(1) }}>
                <Body>{fill(STR.aurBudgetLine, { label: b.label, spent: usd(b.spentUsd), cap: usd(b.capUsd), pct: b.pct })}</Body>
                <Bar pct={b.pct} tone={b.pct >= 100 ? "danger" : b.pct >= 70 ? "warn" : "ok"} />
                <Muted>{fill(STR.aurProjected, { usd: usd(b.projectedUsd) })}</Muted>
              </View>
            ))}
          </Card>

          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.aurTotalsTitle}</Body>
            <Body>{fill(STR.aurSpend, { usd: usd(r.totals.usd), calls: r.totals.calls })}</Body>
            <Muted>{fill(STR.aurCache, { pct: pctOf(r.totals.cacheHitRate) })}</Muted>
            <Muted>{fill(STR.aurPerCheck, { check: usd(r.totals.avgCostPerCheckUsd), turn: usd(r.totals.avgCostPerTurnUsd) })}</Muted>
            <Muted>{fill(STR.aurTrouble, { capped: r.totals.capped, errors: r.totals.errors, fallbacks: r.totals.fallbacks })}</Muted>
            <Muted>{fill(STR.aurChecked, { checked: r.totals.checked, notChecked: r.totals.notChecked })}</Muted>
          </Card>

          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.aurByDay}</Body>
            {r.byDay.length === 0 ? <Muted>{STR.aurNone}</Muted> : null}
            {r.byDay.map((d) => (
              <View key={d.key}>
                <Muted>{`${d.label} · ${usd(d.usd)} · ${d.calls}`}</Muted>
                <Bar pct={(d.usd / maxDay) * 100} tone="ok" />
              </View>
            ))}
          </Card>

          <BucketTable title={STR.aurByPerson} rows={r.byPerson} />
          <BucketTable title={STR.aurByFeature} rows={r.byFeature} />
          <BucketTable title={STR.aurByModel} rows={r.byModel} />

          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.aurQualityTitle}</Body>
            <Muted>{STR.aurQualityHelp}</Muted>
            {r.quality.length === 0 ? <Muted>{STR.aurNone}</Muted> : null}
            {r.quality.map((x) => (
              <View key={x.userId} style={{ marginTop: space(1) }}>
                <Body style={{ fontWeight: "600" }}>{x.name}</Body>
                <Muted>
                  {fill(STR.aurQualityLine, {
                    checks: x.checks,
                    found: x.issuesFound,
                    accepted: pctOf(x.acceptanceRate),
                    kept: pctOf(x.overrideRate),
                    unchecked: x.notChecked,
                  })}
                </Muted>
                {x.issueTypes.length ? <Muted>{x.issueTypes.map((t) => `${t.type} ${t.count}`).join(" · ")}</Muted> : null}
              </View>
            ))}
          </Card>

          {Platform.OS === "web" ? <Button title={STR.aurCsv} variant="secondary" onPress={exportCsv} /> : <Notice tone="info" message={STR.aurCsvWebOnly} />}
        </>
      ) : null}
    </Screen>
  );
}
