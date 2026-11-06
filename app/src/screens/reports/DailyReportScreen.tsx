/**
 * DailyReportScreen (D-#1030–#1035, docs/prd-daily-report.md) — the end-of-day school report.
 *
 *   দিন   one saved day (today before the send time: "so far", not saved). Three counts, the
 *         on-time rate against the previous 5 days, one line per part; tap a line for its problem
 *         rows, tap a row to open that record, or the part's arrow to open the full report set
 *         to this day. A jump shows only when the viewer holds a switch that opens it (D-#1035).
 *   সপ্তাহ / মাস / বছর   totals from the saved days, against the same span before, problems per
 *         day, the places that went wrong on 3+ days (never people), and each part's rate.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { DAILY_REPORT_SECTION_LABELS_BN, DAILY_REPORT_SECTION_LABELS_EN, type DailyReportSection } from "@scd/shared";
import {
  DAILY_REPORT_HISTORY_QUERY,
  DAILY_REPORT_QUERY,
  type DailyReportHeadlineT,
  type DailyReportItemT,
  type DailyReportLinkT,
  type DailyReportPartT,
} from "../../graphql/dailyReport";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Notice, Loader, Button, ChipRow, Chip } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";
import { addDaysKey, dateKey } from "../../lib/dates";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<ReportsStackParamList, "DailyReport">;
type Mode = "DAY" | "WEEK" | "MONTH" | "YEAR";

const fill = (s: string, vars: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
const num = (n: number): string => (getActiveLang() === "en" ? String(n) : bnNum(n));

export function partLabel(key: string): string {
  const table = getActiveLang() === "en" ? DAILY_REPORT_SECTION_LABELS_EN : DAILY_REPORT_SECTION_LABELS_BN;
  return table[key as DailyReportSection] ?? key;
}

function statLabel(key: string): string {
  const v = (STR as unknown as Record<string, string | undefined>)[`drpS_${key}`];
  return v ?? key;
}

function itemTitle(part: string, title: string): string {
  if (part !== "SYSTEM") return title;
  if (title === "nightly-backup") return STR.drpSysNightly;
  if (title === "hourly-backup") return STR.drpSysHourly;
  if (title === "reminder-clock") return STR.drpSysClock;
  return title;
}

function toneLabel(tone: string): string {
  return tone === "LATE" ? STR.drpToneLate : tone === "MISTAKE" ? STR.drpToneMistake : STR.drpToneMissed;
}

/** The line under a part's name: its stats, zeros dropped (finance keeps all three). */
function statLine(p: DailyReportPartT): string {
  if (p.status === "NA") return STR.drpNA;
  if (p.status === "ERROR") return STR.drpError;
  const keep = p.key === "FINANCE" ? p.stats : p.stats.filter((s) => s.value > 0 && s.key !== "staffSheetMissing");
  const parts = keep.slice(0, 4).map((s) => `${statLabel(s.key)} ${num(s.value)}`);
  if (p.stats.some((s) => s.key === "staffSheetMissing" && s.value > 0)) parts.push(statLabel("staffSheetMissing"));
  return parts.length ? parts.join(" · ") : STR.drpNoProblems;
}

/** Open a report link: App → drawer tab → stack screen with its params (the notification path). */
function useOpenLink(navigation: Props["navigation"]): (l: DailyReportLinkT) => void {
  return (l) => {
    let params: Record<string, string> | undefined;
    try {
      const parsed = JSON.parse(l.params) as Record<string, string>;
      params = Object.keys(parsed).length ? parsed : undefined;
    } catch {
      params = undefined;
    }
    (navigation as unknown as { navigate: (n: string, p: object) => void }).navigate("App", {
      screen: l.tab,
      params: params ? { screen: l.screen, params, initial: false } : { screen: l.screen, initial: false },
    });
  };
}

function Counts({ h }: { h: DailyReportHeadlineT }): React.ReactElement {
  const c = useColors();
  const box = (value: number, label: string, bg: string, fg: string) => (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: 10, paddingVertical: space(2), alignItems: "center" }}>
      <Text style={{ color: fg, fontSize: 24, fontWeight: "700" }}>{num(value)}</Text>
      <Text style={{ color: fg, fontSize: 12 }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      {box(h.onTime, STR.drpOnTime, c.primaryContainer, c.onPrimaryContainer)}
      {box(h.problems, STR.drpProblems, c.warningContainer, c.warning)}
      {box(h.mistakes, STR.drpMistakes, c.errorContainer, c.error)}
    </View>
  );
}

function RateBar({ rate, note }: { rate: number | null; note: string | null }): React.ReactElement | null {
  const c = useColors();
  if (rate == null) return null;
  return (
    <View style={{ gap: space(1), marginTop: space(2) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" }}>
        <Muted>{STR.drpRate}{note ? ` · ${note}` : ""}</Muted>
        <Body style={{ fontWeight: "700", color: c.primary }}>{num(rate)}%</Body>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" }}>
        <View style={{ width: `${Math.max(0, Math.min(100, rate))}%`, height: 6, backgroundColor: c.primary }} />
      </View>
    </View>
  );
}

function PartCard({
  p,
  canOpen,
  open,
}: {
  p: DailyReportPartT;
  canOpen: (l: DailyReportLinkT | null) => boolean;
  open: (l: DailyReportLinkT) => void;
}): React.ReactElement {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const stripe =
    p.status === "OK" ? c.primary : p.status === "WARN" ? c.warning : p.status === "BAD" || p.status === "ERROR" ? c.error : c.border;
  const count = p.problems + p.mistakes;
  const hasRows = p.items.length > 0;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <Pressable
        onPress={() => (hasRows ? setExpanded((e) => !e) : canOpen(p.link) && p.link ? open(p.link) : undefined)}
        accessibilityRole="button"
        style={{ flexDirection: "row" }}
      >
        <View style={{ width: 5, backgroundColor: stripe }} />
        <View style={{ flex: 1, padding: space(3), gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>{partLabel(p.key)}</Body>
            {count > 0 ? <Badge text={num(count)} tone={p.status === "BAD" ? "danger" : "warn"} /> : null}
            {p.fixedLater > 0 ? <Badge text={`✓ ${num(p.fixedLater)}`} tone="ok" /> : null}
          </View>
          <Muted>{statLine(p)}</Muted>
        </View>
        <View style={{ justifyContent: "center", paddingHorizontal: space(3) }}>
          <Muted>{hasRows ? (expanded ? "⌃" : "⌄") : canOpen(p.link) ? "›" : ""}</Muted>
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surfaceAlt, paddingVertical: space(1) }}>
          {p.items.map((it, i) => (
            <ItemRow key={`${it.title}-${i}`} part={p.key} it={it} canOpen={canOpen} open={open} />
          ))}
          {p.itemsMore > 0 ? <Muted style={{ paddingHorizontal: space(3), paddingVertical: space(1) }}>{fill(STR.drpMore, { n: num(p.itemsMore) })}</Muted> : null}
          {p.link && canOpen(p.link) ? (
            <Pressable onPress={() => open(p.link!)} style={{ paddingHorizontal: space(3), paddingVertical: space(2) }} accessibilityRole="link">
              <Text style={{ color: c.primary, fontWeight: "700" }}>{STR.drpOpenFull}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function ItemRow({
  part,
  it,
  canOpen,
  open,
}: {
  part: string;
  it: DailyReportItemT;
  canOpen: (l: DailyReportLinkT | null) => boolean;
  open: (l: DailyReportLinkT) => void;
}): React.ReactElement {
  const c = useColors();
  const linked = canOpen(it.link);
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), paddingVertical: space(1) + 2 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.textPrimary, fontWeight: "600" }}>{itemTitle(part, it.title)}</Text>
        {it.subtitle || it.value ? (
          <Text style={{ color: c.textSecondary, fontSize: 12 }}>{[it.subtitle, it.value].filter(Boolean).join(" · ")}</Text>
        ) : null}
      </View>
      <Badge text={toneLabel(it.tone)} tone={it.tone === "LATE" ? "warn" : it.tone === "MISTAKE" ? "danger" : "muted"} />
      {linked ? <Text style={{ color: c.textDisabled }}>›</Text> : null}
    </View>
  );
  return linked && it.link ? (
    <Pressable onPress={() => open(it.link!)} accessibilityRole="link">
      {body}
    </Pressable>
  ) : (
    body
  );
}

function rangeFor(mode: Mode, key: string): { from: string; to: string } {
  if (mode === "WEEK") return { from: addDaysKey(key, -6), to: key };
  if (mode === "MONTH") return { from: `${key.slice(0, 7)}-01`, to: key };
  return { from: `${key.slice(0, 4)}-01-01`, to: key };
}

function History({ mode, anchor }: { mode: Mode; anchor: string }): React.ReactElement {
  const c = useColors();
  const { from, to } = rangeFor(mode, anchor);
  const [q] = useQuery({ query: DAILY_REPORT_HISTORY_QUERY, variables: { from, to } });
  const h = q.data?.dailyReportHistory;
  if (q.fetching && !h) return <Loader label={STR.loading} />;
  if (q.error) return <Notice tone="danger" message={friendlyError(q.error)} />;
  if (!h || h.days.length === 0) return <Notice tone="info" message={STR.drpNoDays} />;
  const max = Math.max(1, ...h.days.map((d) => d.problems));
  return (
    <View style={{ gap: space(3) }}>
      <Muted>{`${from} → ${to} · ${fill(STR.drpSchoolDays, { n: num(h.days.length) })}`}</Muted>
      <Counts h={h.total} />
      <RateBar rate={h.total.rate} note={h.previous.rate == null ? null : fill(STR.drpPrevSpan, { r: num(h.previous.rate) })} />
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.drpProblemsPerDay}</Body>
        <ScrollView horizontal contentContainerStyle={{ alignItems: "flex-end", gap: 3, height: 96, paddingTop: space(2) }}>
          {h.days.map((d) => (
            <View key={d.dateKey} style={{ alignItems: "center", width: 14 }} accessibilityLabel={`${d.dateKey}: ${d.problems}`}>
              <View
                style={{
                  width: 10,
                  height: Math.max(2, Math.round((d.problems / max) * 72)),
                  borderRadius: 2,
                  backgroundColor: d.problems === 0 ? c.primary : d.problems / max > 0.66 ? c.error : c.warning,
                }}
              />
              <Text style={{ fontSize: 9, color: c.textSecondary }}>{num(Number(d.dateKey.slice(8)))}</Text>
            </View>
          ))}
        </ScrollView>
      </Card>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.drpRepeated}</Body>
        {h.repeated.length === 0 ? <Muted>{STR.drpRepeatedNone}</Muted> : null}
        {h.repeated.map((r, i) => (
          <View key={`${r.key}-${r.title}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), paddingVertical: space(1) }}>
            <Text style={{ color: c.textPrimary, flex: 1 }}>{`${partLabel(r.key)} — ${r.title}${r.subtitle ? ` · ${r.subtitle}` : ""}`}</Text>
            <Text style={{ color: c.warning, fontWeight: "700" }}>{fill(STR.drpRepeatedDays, { n: num(r.days) })}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.drpByPart}</Body>
        {h.parts.map((p) => {
          const diff = p.rate != null && p.prevRate != null ? p.rate - p.prevRate : null;
          return (
            <View key={p.key} style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1), alignItems: "center" }}>
              <Text style={{ color: c.textPrimary, flex: 1 }}>{partLabel(p.key)}</Text>
              <Text style={{ color: c.textSecondary }}>
                {p.key === "MISTAKES" ? `${STR.drpMistakes} ${num(p.mistakes)}` : p.rate == null ? "—" : `${num(p.rate)}%`}
              </Text>
              <Text style={{ width: 44, textAlign: "right", color: diff == null ? c.textDisabled : diff >= 0 ? c.primary : c.error }}>
                {diff == null ? "" : `${diff >= 0 ? "+" : "−"}${num(Math.abs(diff))}`}
              </Text>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

export default function DailyReportScreen({ navigation, route }: Props): React.ReactElement {
  const { can } = useAuth();
  const today = dateKey();
  const [mode, setMode] = useState<Mode>("DAY");
  const [day, setDay] = useState(route.params?.date ?? today);
  React.useEffect(() => {
    if (route.params?.date) {
      setDay(route.params.date);
      setMode("DAY");
    }
  }, [route.params?.date]);
  const [q] = useQuery({ query: DAILY_REPORT_QUERY, variables: { date: day }, pause: mode !== "DAY", requestPolicy: "cache-and-network" });
  const open = useOpenLink(navigation);
  const canOpen = useMemo(() => (l: DailyReportLinkT | null) => !!l && (l.perms.length === 0 || l.perms.some((p) => can(p))), [can]);
  const view = q.data?.dailyReport ?? null;

  React.useLayoutEffect(() => {
    const share = can("reports:daily_share");
    const settings = can("reports:daily_settings");
    if (!share && !settings) return;
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", gap: space(1) }}>
          {share ? <Button title={STR.drpShare} variant="ghost" onPress={() => navigation.navigate("DailyReportShare")} /> : null}
          {settings ? <Button title={STR.drpSettings} variant="ghost" onPress={() => navigation.navigate("DailyReportSettings")} /> : null}
        </View>
      ),
    });
  }, [navigation, can]);

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(getActiveLang() === "en" ? "en-GB" : "bn-BD", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <Screen scroll>
      <View style={{ gap: space(3) }}>
        <ChipRow>
          {(["DAY", "WEEK", "MONTH", "YEAR"] as Mode[]).map((m) => (
            <Chip
              key={m}
              label={m === "DAY" ? STR.drpDay : m === "WEEK" ? STR.drpWeek : m === "MONTH" ? STR.drpMonth : STR.drpYear}
              selected={mode === m}
              onPress={() => setMode(m)}
            />
          ))}
        </ChipRow>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2) }}>
          {mode === "DAY" ? <Button title="‹" variant="ghost" onPress={() => setDay(addDaysKey(day, -1))} /> : null}
          <View style={{ flex: 1 }}>
            <DateField value={day} onChange={(v) => v && setDay(v)} max={today} />
          </View>
          {mode === "DAY" ? <Button title="›" variant="ghost" disabled={day >= today} onPress={() => setDay(addDaysKey(day, 1))} /> : null}
        </View>

        {mode !== "DAY" ? (
          <History mode={mode} anchor={day} />
        ) : q.fetching && !view ? (
          <Loader label={STR.loading} />
        ) : q.error ? (
          <Notice tone="danger" message={friendlyError(q.error)} />
        ) : !view ? (
          <Notice tone="info" message={STR.drpNoReport} />
        ) : (
          <View style={{ gap: space(2) }}>
            <Muted>{view.live ? STR.drpLive : fill(STR.drpSavedAt, { t: time(view.generatedAt) })}</Muted>
            <Counts h={view.headline} />
            <RateBar rate={view.headline.rate} note={view.previousRate == null ? null : fill(STR.drpPrevRate, { r: num(view.previousRate) })} />
            {view.parts.map((p) => (
              <PartCard key={p.key} p={p} canOpen={canOpen} open={open} />
            ))}
            {view.fixedLater > 0 ? <Notice tone="info" message={fill(STR.drpFixedLater, { n: num(view.fixedLater) })} /> : null}
          </View>
        )}
      </View>
    </Screen>
  );
}
