/**
 * MarksDriversScreen — "What moves the marks", live (D-#905–#907).
 *
 * The 23-Sep term study (artifact "নম্বর কীসে বাড়ে") as a Reports-hub screen that reads
 * the live records: which of homework, assignments and attendance go with a child's
 * class-test results, over a rolling window. Same sections, same order, same frozen
 * definitions (server `marksDriversStats.ts`).
 *
 * D-#907: every FINDING sentence is written from the numbers and appears only when they
 * support it — a not-significant link is said to be not significant, a thin group says
 * so — because a page that re-renders every day cannot carry prose fixed on one day's
 * figures. No child is named anywhere; the scatter dots carry a class only.
 *
 * Gated `reports:marks_drivers` (Principal by default) — the server re-enforces.
 */
import React, { useState } from "react";
import { View, ScrollView, Text } from "react-native";
import { useQuery } from "urql";
import { MARKS_DRIVERS_QUERY, type MarksDriversT, type MarksDriversWindowT, type MeasureKeyT } from "../../graphql/marksDrivers";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Button, Notice, Loader, ErrorBanner } from "../../components/ui";
import { HBarChart, ColumnChart, ScatterChart, useSeriesColors } from "../../components/InsightCharts";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

const pct = (v: number | null | undefined): string => (v == null ? "—" : `${bnNum(Math.round(v))}%`);
const frac = (v: number | null | undefined): string => (v == null ? "—" : `${bnNum(Math.round(v * 100))}%`);
const rTxt = (v: number | null | undefined): string =>
  v == null ? "—" : `${v < 0 ? "−" : "+"}${bnNum(Math.abs(v).toFixed(2))}`;
const one = (v: number): string => bnNum(v.toFixed(1));

function measureLabel(k: MeasureKeyT): string {
  return {
    hwQual: STR.mdHwQual,
    asQual: STR.mdAsQual,
    hwDone: STR.mdHwDone,
    asDone: STR.mdAsDone,
    att: STR.mdAtt,
  }[k];
}

/** The finding sentences, each present only when its numbers carry it (D-#907). */
function findings(d: MarksDriversT): string[] {
  const out: string[] = [];
  const sig = d.correlations.filter((c) => c.significant && c.r != null).sort((a, b) => (b.r ?? 0) - (a.r ?? 0));
  if (sig.length > 0 && (sig[0].r ?? 0) > 0) {
    out.push(fill(STR.mdFStrongest, { m: measureLabel(sig[0].key), r: rTxt(sig[0].r) }));
  } else {
    out.push(STR.mdFNoneClear);
  }

  const hw = d.tertiles.find((t) => t.key === "hwDone");
  if (hw && hw.top != null && hw.bottom != null) {
    out.push(fill(STR.mdFHwThirds, { top: pct(hw.top), bottom: pct(hw.bottom), gap: bnNum(Math.round(hw.top - hw.bottom)) }));
  }

  const att = d.correlations.find((c) => c.key === "att");
  if (att && att.r != null) {
    out.push(fill(att.significant ? STR.mdFAttLinked : STR.mdFAttNotLinked, { r: rTxt(att.r) }));
  }

  const b = d.below85;
  if (b.nBelow >= 4 && b.below != null && b.above != null) {
    // The DIRECTION is the finding: "a gap of 3" with the sign dropped read as "they lose 3"
    // even when the group below 85% scored higher (owner screenshot, 2026-11-02).
    const behind = b.above - b.below;
    let s = fill(STR.mdFBelow85, { n: bnNum(b.nBelow), below: one(b.below), above: one(b.above) });
    s += " " + (behind >= 1 ? fill(STR.mdFBelow85Behind, { gap: bnNum(Math.round(behind)) }) : STR.mdFBelow85NotBehind);
    // controlledGap is the below-85 indicator's coefficient: negative = they score lower.
    const c = b.controlledGap;
    if (c != null) {
      const gap = bnNum(Math.round(Math.abs(c)));
      s += " " + (c <= -1 ? fill(STR.mdFBelow85Controlled, { gap }) : c >= 1 ? fill(STR.mdFBelow85ControlledAhead, { gap }) : STR.mdFBelow85ControlledNone);
    }
    if (behind >= 1 && (b.p == null || b.p >= 0.05)) s += " " + STR.mdFNotCertain;
    out.push(s);
  }

  if (d.senior.r != null && d.senior.p != null && d.senior.p < 0.05 && d.senior.r > 0) {
    out.push(fill(STR.mdFSenior, { r: rTxt(d.senior.r), n: bnNum(d.senior.n) }));
  }

  if (d.longAbsent > 0) out.push(fill(STR.mdFLongAbsent, { n: bnNum(d.longAbsent) }));
  return out;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      {sub ? <Muted style={{ marginTop: 2, marginBottom: space(3) }}>{sub}</Muted> : <View style={{ height: space(3) }} />}
      {children}
    </Card>
  );
}

/**
 * D-#910: the headline figures twice — everyone, and without outliers (long-absent children
 * plus extreme values) — so the owner can see whether a handful of children carry a finding.
 * The verdict line compares CONCLUSIONS (significance, direction), not decimals.
 */
function OutlierCompare({ d }: { d: MarksDriversT }): React.ReactElement {
  const colors = useColors();
  const o = d.withoutOutliers;
  if (o.longAbsent + o.extreme === 0) return <Muted>{STR.mdOutNone}</Muted>;

  const corr = (list: MarksDriversT["correlations"], k: MeasureKeyT) => list.find((c) => c.key === k);
  const gap3 = (list: MarksDriversT["tertiles"], k: "hwDone" | "att") => {
    const t = list.find((x) => x.key === k);
    return t && t.top != null && t.bottom != null ? t.top - t.bottom : null;
  };
  const signed = (v: number | null) => (v == null ? "—" : `${v < 0 ? "−" : "+"}${bnNum(Math.abs(v).toFixed(1))}`);
  const below = (b: MarksDriversT["below85"]) => (b.below != null && b.above != null ? b.below - b.above : null);

  type Cell = { text: string; strong?: boolean };
  const rCell = (c?: { r: number | null; significant: boolean }): Cell => ({ text: rTxt(c?.r), strong: c?.significant });
  const rows: Array<{ label: string; all: Cell; kept: Cell }> = [
    { label: STR.mdOutRowN, all: { text: bnNum(d.withResult) }, kept: { text: bnNum(o.withResult) } },
    ...(["hwQual", "asQual", "hwDone", "asDone", "att"] as const).map((k) => ({
      label: measureLabel(k),
      all: rCell(corr(d.correlations, k)),
      kept: rCell(corr(o.correlations, k)),
    })),
    { label: STR.mdOutRowHwGap, all: { text: signed(gap3(d.tertiles, "hwDone")) }, kept: { text: signed(gap3(o.tertiles, "hwDone")) } },
    { label: STR.mdOutRowAttGap, all: { text: signed(gap3(d.tertiles, "att")) }, kept: { text: signed(gap3(o.tertiles, "att")) } },
    { label: STR.mdOutRowBelow85, all: { text: signed(below(d.below85)) }, kept: { text: signed(below(o.below85)) } },
    { label: STR.mdOutRowSenior, all: rCell({ r: d.senior.r, significant: (d.senior.p ?? 1) < 0.05 }), kept: rCell({ r: o.senior.r, significant: (o.senior.p ?? 1) < 0.05 }) },
  ];

  // Same conclusion = every measure keeps its significance, and the below-85 gap keeps its side.
  const flips = (["hwQual", "asQual", "hwDone", "asDone", "att"] as const).filter(
    (k) => (corr(d.correlations, k)?.significant ?? false) !== (corr(o.correlations, k)?.significant ?? false),
  );
  const bAll = below(d.below85);
  const bKept = below(o.below85);
  const belowFlip = bAll != null && bKept != null && (bAll <= -1) !== (bKept <= -1);
  const changed = flips.length > 0 || belowFlip;

  const cell = (c: Cell, w: number, head = false) => (
    <Text
      style={{
        width: w,
        paddingVertical: 6,
        paddingHorizontal: 4,
        fontSize: 13,
        textAlign: "right",
        color: head ? colors.textSecondary : c.strong === false ? colors.textSecondary : colors.textPrimary,
        fontWeight: head || c.strong ? "700" : "400",
      }}
    >
      {c.text}
    </Text>
  );
  return (
    <View style={{ gap: space(3) }}>
      <Notice tone={changed ? "warn" : "ok"} message={changed ? STR.mdOutChanged : STR.mdOutSame} />
      <View>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ flex: 1, paddingVertical: 6, fontSize: 13, fontWeight: "700", color: colors.textSecondary }}>{STR.mdOutColMeasure}</Text>
          {cell({ text: STR.mdOutColAll }, 76, true)}
          {cell({ text: STR.mdOutColKept }, 92, true)}
        </View>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border }}>
            <Text style={{ flex: 1, paddingVertical: 6, fontSize: 13, color: colors.textPrimary }}>{r.label}</Text>
            {cell(r.all, 76)}
            {cell(r.kept, 92)}
          </View>
        ))}
      </View>
      <Muted style={{ fontSize: 12 }}>{STR.mdOutLegend}</Muted>
    </View>
  );
}

function LevelTable({ d }: { d: MarksDriversT }): React.ReactElement {
  const colors = useColors();
  const cols: Array<{ h: string; w: number }> = [
    { h: STR.mdColClass, w: 96 },
    { h: STR.mdColChildren, w: 64 },
    { h: STR.mdAtt, w: 72 },
    { h: STR.mdHwDone, w: 84 },
    { h: STR.mdColResult, w: 72 },
    { h: STR.mdColAttR, w: 96 },
    { h: STR.mdColHwR, w: 96 },
  ];
  const tone = (r: number | null) =>
    r == null ? colors.textSecondary : r >= 0.5 ? colors.primary : r < 0 ? colors.error : colors.textPrimary;
  const cell = (text: string, w: number, i: number, color?: string, bold?: boolean) => (
    <Text
      key={i}
      style={{ width: w, paddingVertical: 6, paddingHorizontal: 4, fontSize: 13, textAlign: i === 0 ? "left" : "right", color: color ?? colors.textPrimary, fontWeight: bold ? "700" : "400" }}
    >
      {text}
    </Text>
  );
  return (
    <ScrollView horizontal>
      <View>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border }}>
          {cols.map((c, i) => cell(c.h, c.w, i, colors.textSecondary, true))}
        </View>
        {d.levels.map((l) => (
          <View key={l.level} style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border, backgroundColor: l.level >= 4 ? colors.surfaceAlt : undefined }}>
            {cell(classLevelLabel(l.level), cols[0].w, 0, undefined, l.level >= 4)}
            {cell(bnNum(l.n), cols[1].w, 1)}
            {cell(frac(l.att), cols[2].w, 2)}
            {cell(frac(l.hwDone), cols[3].w, 3)}
            {cell(l.result == null ? STR.mdNoTests : pct(l.result), cols[4].w, 4, l.result == null ? colors.textSecondary : undefined)}
            {cell(rTxt(l.rAtt), cols[5].w, 5, tone(l.rAtt), (l.rAtt ?? 0) >= 0.5)}
            {cell(rTxt(l.rHw), cols[6].w, 6, tone(l.rHw), (l.rHw ?? 0) >= 0.5)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export default function MarksDriversScreen(): React.ReactElement {
  const colors = useColors();
  const series = useSeriesColors();
  const [window, setWindow] = useState<MarksDriversWindowT>("d90");
  const [refresh, setRefresh] = useState(false);
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: MARKS_DRIVERS_QUERY,
    variables: { window, refresh },
    requestPolicy: "cache-and-network",
  });
  const d = data?.marksDrivers;

  // The first press flips the variable (a new query → a fetch); later presses re-run it.
  const recompute = () => (refresh ? reexecute({ requestPolicy: "network-only" }) : setRefresh(true));
  const pick = (w: MarksDriversWindowT) => {
    setRefresh(false);
    setWindow(w);
  };

  const at = d ? new Date(d.computedAt) : null;
  const atTxt = at ? `${bnNum(String(at.getHours()).padStart(2, "0"))}:${bnNum(String(at.getMinutes()).padStart(2, "0"))}` : "";

  const ready = d && d.withResult >= 12;

  return (
    <Screen scroll>
      <H2>{STR.mdTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.mdSubtitle}</Muted>

      <ChipRow>
        <Chip label={STR.mdWin30} selected={window === "d30"} onPress={() => pick("d30")} />
        <Chip label={STR.mdWin90} selected={window === "d90"} onPress={() => pick("d90")} />
        <Chip label={STR.mdWinYear} selected={window === "year"} onPress={() => pick("year")} />
      </ChipRow>

      {d ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), marginVertical: space(2), flexWrap: "wrap" }}>
          <Muted style={{ flexShrink: 1 }}>
            {fill(STR.mdWindowLine, { from: bnNum(d.fromKey), to: bnNum(d.toKey), at: atTxt })}
          </Muted>
          <Button title={STR.mdRefresh} variant="secondary" onPress={recompute} loading={fetching} />
        </View>
      ) : null}

      {error ? <ErrorBanner message={friendlyError(error)} onRetry={recompute} /> : null}
      {!d && fetching ? <Loader label={STR.mdComputing} /> : null}

      {d ? (
        <>
          <Card>
            <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space(3), columnGap: space(4) }}>
              {[
                [d.students, STR.mdFactStudents],
                [d.testsPrinted, STR.mdFactTests],
                [d.papersMarked, STR.mdFactPapers],
                [d.homeworkRecords + d.assignmentRecords, STR.mdFactRecords],
                [d.medianMarkedDays, STR.mdFactDays],
                [d.withResult, STR.mdFactWithResult],
              ].map(([v, label]) => (
                <View key={label as string} style={{ minWidth: 92 }}>
                  <Body style={{ fontWeight: "700", fontSize: 20 }}>{bnNum(v as number)}</Body>
                  <Muted style={{ fontSize: 12 }}>{label as string}</Muted>
                </View>
              ))}
            </View>
          </Card>

          {!ready ? (
            <Notice tone="info" message={fill(STR.mdTooFew, { n: bnNum(d.withResult) })} />
          ) : (
            <>
              <Card style={{ borderLeftWidth: 3, borderLeftColor: series[0] }}>
                <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.mdFindings}</Body>
                {findings(d).map((s, i) => (
                  <Body key={i} style={{ marginBottom: space(2) }}>• {s}</Body>
                ))}
              </Card>

              <Section
                title={STR.mdOutTitle}
                sub={fill(STR.mdOutSub, {
                  n: bnNum(d.withoutOutliers.longAbsent + d.withoutOutliers.extreme),
                  a: bnNum(d.withoutOutliers.longAbsent),
                  b: bnNum(d.withoutOutliers.extreme),
                })}
              >
                <OutlierCompare d={d} />
              </Section>

              <Section title={STR.mdStrengthTitle} sub={fill(STR.mdStrengthSub, { n: bnNum(d.withResult) })}>
                <HBarChart
                  accessibilityLabel={STR.mdStrengthTitle}
                  max={0.6}
                  data={d.correlations.map((c) => ({
                    label: measureLabel(c.key),
                    value: c.r ?? 0,
                    valueLabel: rTxt(c.r),
                    strong: c.significant,
                    note: c.r == null ? STR.mdTooFewShort : c.significant ? undefined : STR.mdNotSig,
                  }))}
                />
                <Muted style={{ marginTop: space(3), fontSize: 12 }}>{STR.mdStrengthLegend}</Muted>
              </Section>

              <Section title={STR.mdThirdsTitle} sub={STR.mdThirdsSub}>
                <ColumnChart
                  accessibilityLabel={STR.mdThirdsTitle}
                  legend={[
                    { label: STR.mdHwDone, color: series[0] },
                    { label: STR.mdAsDone, color: series[1] },
                    { label: STR.mdAtt, color: series[2] },
                  ]}
                  groups={(["bottom", "middle", "top"] as const).map((g) => ({
                    label: { bottom: STR.mdThirdBottom, middle: STR.mdThirdMiddle, top: STR.mdThirdTop }[g],
                    bars: (["hwDone", "asDone", "att"] as const).map((k, i) => ({
                      value: d.tertiles.find((t) => t.key === k)?.[g] ?? null,
                      color: series[i],
                    })),
                  }))}
                />
              </Section>

              <Section title={STR.mdBandsTitle} sub={STR.mdBandsSub}>
                <ColumnChart
                  accessibilityLabel={STR.mdBandsTitle}
                  divider={{ before: 3, label: STR.mdBandsLine }}
                  groups={d.bands.map((b) => ({
                    label: b.lo === 0 ? `<${bnNum(b.hi)}` : `${bnNum(b.lo)}–${bnNum(b.hi)}`,
                    caption: fill(STR.mdNChildren, { n: bnNum(b.n) }),
                    bars: [{ value: b.meanResult, color: b.hi <= 85 ? colors.textDisabled : series[0] }],
                  }))}
                />
              </Section>

              <Section title={STR.mdLevelsTitle} sub={STR.mdLevelsSub}>
                <LevelTable d={d} />
              </Section>

              <Section title={STR.mdEffectTitle} sub={STR.mdEffectSub}>
                <HBarChart
                  accessibilityLabel={STR.mdEffectTitle}
                  max={Math.max(25, ...d.effects.map((e) => e.marks))}
                  data={d.effects.map((e) => ({
                    label: measureLabel(e.key),
                    value: e.marks,
                    valueLabel: fill(STR.mdMarks, { n: one(e.marks) }),
                    strong: d.correlations.find((c) => c.key === e.key)?.significant ?? false,
                  }))}
                />
              </Section>

              <Section title={STR.mdScatterHwTitle} sub={STR.mdScatterSub}>
                <ScatterChart
                  accessibilityLabel={STR.mdScatterHwTitle}
                  xLabel={STR.mdHwDone}
                  data={d.points
                    .filter((p) => p.hwDone != null)
                    .map((p) => ({
                      x: (p.hwDone as number) * 100,
                      y: p.result,
                      caption: `${classLevelLabel(p.level)} · ${STR.mdHwDone} ${frac(p.hwDone)} · ${STR.mdColResult} ${pct(p.result)}`,
                    }))}
                />
              </Section>

              <Section title={STR.mdScatterAttTitle} sub={STR.mdScatterSub}>
                <ScatterChart
                  accessibilityLabel={STR.mdScatterAttTitle}
                  xLabel={STR.mdAtt}
                  xMin={Math.min(
                    60,
                    Math.floor(Math.min(...d.points.filter((p) => p.att != null).map((p) => (p.att as number) * 100), 100) / 10) * 10,
                  )}
                  data={d.points
                    .filter((p) => p.att != null)
                    .map((p) => ({
                      x: (p.att as number) * 100,
                      y: p.result,
                      caption: `${classLevelLabel(p.level)} · ${STR.mdAtt} ${frac(p.att)} · ${STR.mdColResult} ${pct(p.result)}`,
                    }))}
                />
              </Section>
            </>
          )}

          <Section title={STR.mdHonestTitle}>
            {[STR.mdHonest1, STR.mdHonest2, STR.mdHonest3, STR.mdHonest4].map((s, i) => (
              <Body key={i} style={{ marginBottom: space(2) }}>• {s}</Body>
            ))}
          </Section>

          <Muted style={{ fontSize: 12, marginTop: space(2) }}>{STR.mdMethod}</Muted>
          {d.sanityR != null ? (
            <Muted style={{ fontSize: 12, marginTop: space(1) }}>{fill(STR.mdSanity, { r: rTxt(d.sanityR) })}</Muted>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
