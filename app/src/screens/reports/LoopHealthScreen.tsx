/**
 * LoopHealthScreen (AL-13, docs/prd-academic-loop-2027.md journey L, AC-L1..L3) - "শিক্ষাচক্রের অবস্থা". Two reads, both
 * gated server-side on `reports:loop_health` (Reports hub), neither writes anything:
 *   - how the loop is running, per teacher or per শাখা × subject, for the last 4 or 8 weeks: periods with a lesson marked,
 *     marks confirmed by the deadline, papers with a tick (a 0 % rate is shown, never judged), class tests with a sheet,
 *     weak -> improving moves, re-teach before / after;
 *   - the January readiness list per class × subject (the current or the prepared next year): tree locked, switch, weeks of
 *     stock, plans with tags, rotation, targets, hints - each green or red with what to do - and the under-4-weeks list.
 * Wide content is stacked, not tabled, so it holds at 360 dp.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import {
  LOOP_HEALTH_PAGE,
  LOOP_HEALTH_YEARS,
  LOOP_READINESS,
  type LoopCheckT,
  type LoopHealthPageT,
  type LoopHealthRowT,
  type LoopRateT,
  type LoopReadinessT,
} from "../../graphql/loopHealth";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePageState } from "../../lib/paging";
import { space, useColors } from "../../theme";
import { fill } from "../mastery/masteryStateUi";

const PAGE = 30;
const DAY = 24 * 3600 * 1000;

const weeksText = (w: number | null | undefined): string => (w === null || w === undefined ? STR.lhUnlimited : fill(STR.lhWeeks, { n: bnNum(w) }));

function rateText(r: LoopRateT | undefined): string {
  if (!r || r.pct === null) return STR.lhNoData;
  return `${bnNum(r.done)}/${bnNum(r.total)} · ${bnNum(r.pct)}%`;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap", paddingVertical: 2 }}>
      <Muted style={{ flexShrink: 1, flexBasis: "55%" }}>{label}</Muted>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>
        <Body style={{ fontWeight: "700" }}>{value}</Body>
        {note ? <Muted style={{ fontSize: 12 }}>{note}</Muted> : null}
      </View>
    </View>
  );
}

function HealthCard({ r }: { r: LoopHealthRowT }): React.ReactElement {
  const title =
    r.kind === "TEACHER"
      ? r.teacherName ?? STR.lhTeacherUnknown
      : `${r.className ?? ""} ${r.sectionName ?? ""} · ${hwSubjectLabel(r.subject ?? "")}`.trim();
  const hasMoves = r.weakToImproving + r.weakToMastered > 0;
  const hasReteach = r.reteachOpened + r.reteachClosed > 0;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      <Metric label={STR.lhPeriods} value={rateText(r.periods)} />
      <Metric label={STR.lhPapers} value={rateText(r.papers)} />
      <Metric label={STR.lhTicks} value={rateText(r.ticks)} note={r.zeroNotJudged ? STR.lhZeroNote : undefined} />
      <Metric label={STR.lhTests} value={rateText(r.classTests)} />
      <Metric
        label={STR.lhMoves}
        value={hasMoves ? fill(STR.lhMovesLine, { a: bnNum(r.weakToImproving), b: bnNum(r.weakToMastered) }) : STR.lhNoData}
      />
      <Metric
        label={STR.lhReteach}
        value={hasReteach ? fill(STR.lhReteachLine, { o: bnNum(r.reteachOpened), c: bnNum(r.reteachClosed) }) : STR.lhNoData}
        note={
          r.reteachBeforePct !== null && r.reteachAfterPct !== null
            ? fill(STR.lhReteachBA, { b: bnNum(r.reteachBeforePct), a: bnNum(r.reteachAfterPct) })
            : undefined
        }
      />
    </Card>
  );
}

function HealthTab(): React.ReactElement {
  const [kind, setKind] = useState<"TEACHER" | "SECTION">("SECTION");
  const [weeks, setWeeks] = useState<4 | 8>(4);
  const [page, setPage] = usePageState(`${kind}|${weeks}`);
  const from = weeks === 8 ? new Date(Date.now() - 55 * DAY).toISOString().slice(0, 10) : null;
  const [{ data, fetching, error }] = useQuery({
    query: LOOP_HEALTH_PAGE,
    variables: { kind, from, to: null, page, pageSize: PAGE },
    requestPolicy: "cache-and-network",
  });
  const v = data?.loopHealthPage as LoopHealthPageT | undefined;
  const rows = v?.page?.rows ?? [];
  return (
    <>
      <ChipRow>
        <Chip label={STR.lhBySection} selected={kind === "SECTION"} onPress={() => setKind("SECTION")} />
        <Chip label={STR.lhByTeacher} selected={kind === "TEACHER"} onPress={() => setKind("TEACHER")} />
      </ChipRow>
      <ChipRow>
        <Chip label={STR.lhPeriod4} selected={weeks === 4} onPress={() => setWeeks(4)} />
        <Chip label={STR.lhPeriod8} selected={weeks === 8} onPress={() => setWeeks(8)} />
      </ChipRow>
      {v ? <Muted>{fill(STR.lhRange, { from: v.from, to: v.to })}</Muted> : null}
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && !v ? <Loader /> : null}
      {v && rows.length === 0 ? <EmptyState message={STR.lhHealthEmpty} /> : null}
      {rows.map((r) => (
        <HealthCard key={r.key} r={r} />
      ))}
      <Pager page={v?.page?.page ?? page} pageSize={v?.page?.pageSize ?? PAGE} total={v?.page?.total ?? 0} onPage={setPage} />
    </>
  );
}

function CheckLine({ c, onCoverage }: { c: LoopCheckT; onCoverage: () => void }): React.ReactElement {
  const colors = useColors();
  const label = (STR as Record<string, string>)[`lhCk${c.key}`] ?? c.key;
  const todo = (STR as Record<string, string>)[`lhTodo${c.key}`] ?? "";
  const mark = c.state === "OK" ? "✔" : c.state === "RED" ? "✖" : "–";
  const tone = c.state === "OK" ? colors.success : c.state === "RED" ? colors.error : colors.textSecondary;
  let detail: string;
  if (c.state === "NA") detail = STR.lhDtNA;
  else if (c.key === "STOCK") {
    detail = fill(STR.lhDtStock, { n: bnNum(c.have), h: weeksText(c.hwWeeks), a: weeksText(c.asctWeeks) }) + (c.usingDefault ? STR.lhDtStockDefault : "");
  } else if (c.key === "TREE" || c.key === "SWITCH") detail = "";
  else detail = fill(STR.lhDtCount, { have: bnNum(c.have), need: bnNum(c.need ?? 0) });
  return (
    <View style={{ paddingVertical: space(1), borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Body style={{ color: tone, fontWeight: "700" }}>{mark}</Body>
        <View style={{ flex: 1 }}>
          <Body style={c.state === "RED" ? { color: colors.error } : undefined}>{label}</Body>
          {detail ? <Muted style={{ fontSize: 12 }}>{detail}</Muted> : null}
          {c.key === "STOCK" && ((c.emptyObjectives ?? []).length > 0 || c.hwUnderWeekCount + c.asctUnderWeekCount > 0) ? (
            <View>
              <Muted style={{ fontSize: 12 }}>
                {fill(STR.lhStockCounts, { h: bnNum(c.hwEmptyCount), a: bnNum(c.asctEmptyCount), uh: bnNum(c.hwUnderWeekCount), ua: bnNum(c.asctUnderWeekCount) })}
              </Muted>
              {(c.emptyObjectives ?? []).length > 0 ? <Muted style={{ fontSize: 12, fontWeight: "700" }}>{STR.lhEmptyObjs}</Muted> : null}
              {(c.emptyObjectives ?? []).slice(0, 12).map((o) => (
                <Muted key={`${o.code}|${o.share}`} style={{ fontSize: 12 }}>
                  {o.labelBn} · {o.code} · {o.share === "HW" ? STR.lhShareHW : STR.lhShareASCT}
                </Muted>
              ))}
            </View>
          ) : null}
          {c.state === "RED" && todo ? <Muted style={{ fontSize: 12 }}>{todo}</Muted> : null}
          {c.state === "RED" && c.key === "STOCK" ? <Button title={STR.lhOpenCoverage} variant="secondary" onPress={onCoverage} /> : null}
        </View>
      </View>
    </View>
  );
}

function ReadinessTab({ navigation }: { navigation: Nav }): React.ReactElement {
  const [yearId, setYearId] = useState<string | null>(null);
  const [onlyRed, setOnlyRed] = useState(false);
  const [page, setPage] = usePageState(`${yearId}|${onlyRed}`);
  const [{ data: yd }] = useQuery({ query: LOOP_HEALTH_YEARS, requestPolicy: "cache-and-network" });
  const years = (yd?.loopHealthYears ?? []) as { id: string; label: string; current: boolean }[];
  const [{ data, fetching, error }] = useQuery({
    query: LOOP_READINESS,
    variables: { academicYearId: yearId, onlyRed, page, pageSize: PAGE },
    requestPolicy: "cache-and-network",
  });
  const v = data?.loopReadiness as LoopReadinessT | undefined;
  return (
    <>
      {years.length > 1 ? (
        <ChipRow>
          {years.map((y) => (
            <Chip
              key={y.id}
              label={y.current ? y.label : fill(STR.lhYearNext, { label: y.label })}
              selected={(yearId ?? years.find((x) => x.current)?.id) === y.id}
              onPress={() => setYearId(y.current ? null : y.id)}
            />
          ))}
        </ChipRow>
      ) : null}
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && !v ? <Loader /> : null}
      {v ? (
        <>
          <Notice tone={v.switchOn ? "ok" : "info"} message={v.switchOn ? STR.lhSwitchOn : STR.lhSwitchOff} />
          <Card>
            <Body style={{ fontWeight: "700" }}>{fill(STR.lhReadyCount, { r: bnNum(v.readyPairs), t: bnNum(v.totalPairs) })}</Body>
            <ChipRow>
              <Chip label={STR.lhOnlyRed} selected={onlyRed} onPress={() => setOnlyRed(!onlyRed)} />
            </ChipRow>
          </Card>
          {(v.lowStock ?? []).length > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.lhLowStockTitle}</Body>
              {v.lowStock.map((l) => (
                <View key={`${l.classToken}|${l.subject}`} style={{ paddingVertical: 2 }}>
                  <Body>
                    {masteryClassLabel(l.classToken)} · {hwSubjectLabel(l.subject)}
                  </Body>
                  <Muted style={{ fontSize: 12 }}>{fill(STR.lhLowStockLine, { h: weeksText(l.hwWeeks), a: weeksText(l.asctWeeks) })}</Muted>
                </View>
              ))}
            </Card>
          ) : null}
          {(v.rows?.rows ?? []).map((r) => (
            <Card key={`${r.classToken}|${r.subject}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                  {masteryClassLabel(r.classToken)} · {hwSubjectLabel(r.subject)}
                </Body>
                <Badge text={r.ready ? STR.lhReady : STR.lhNotReady} tone={r.ready ? "ok" : "warn"} />
              </View>
              {r.checks.map((c) => (
                <CheckLine key={c.key} c={c} onCoverage={() => navigation.navigate("MasteryBankCoverage", { classToken: r.classToken, subject: r.subject })} />
              ))}
            </Card>
          ))}
          <Pager page={v.rows?.page ?? page} pageSize={v.rows?.pageSize ?? PAGE} total={v.rows?.total ?? 0} onPage={setPage} />
        </>
      ) : null}
    </>
  );
}

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void };

export default function LoopHealthScreen({ navigation }: { navigation: Nav }): React.ReactElement {
  const [tab, setTab] = useState<"HEALTH" | "READY">("HEALTH");
  return (
    <Screen scroll>
      <ChipRow>
        <Chip label={STR.lhTabHealth} selected={tab === "HEALTH"} onPress={() => setTab("HEALTH")} />
        <Chip label={STR.lhTabReady} selected={tab === "READY"} onPress={() => setTab("READY")} />
      </ChipRow>
      {tab === "HEALTH" ? <HealthTab /> : <ReadinessTab navigation={navigation} />}
    </Screen>
  );
}
