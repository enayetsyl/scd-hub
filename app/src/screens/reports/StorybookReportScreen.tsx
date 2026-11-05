/**
 * StorybookReportScreen (SB-6, W10) — গল্পের বই রিপোর্ট. Three tabs, each behind its own
 * Reports-hub switch (D-#861): সিরিজ (reports:storybook_series), বই (reports:storybook_books),
 * পাঠক (reports:storybook_readers — names children). Window: 30 days / 90 days / this year.
 * Bars are one hue, scaled to the largest value in view; the exact numbers sit on each row.
 */
import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import {
  STORY_BOOKS_REPORT,
  STORY_READERS_REPORT,
  STORY_SERIES_REPORT,
  type StoryPreferenceCellT,
  type StoryReportWindowT,
  type StoryStatRowT,
} from "../../graphql/storybooks";
import { Badge, Body, Card, Chip, ChipRow, EmptyState, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, isoDateLabel } from "../../lib/labels";
import { radius, space, typeScale, useColors } from "../../theme";

type Tab = "series" | "books" | "readers";

function Bar({ value, max }: { value: number; max: number }): React.ReactElement {
  const colors = useColors();
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ height: 8, borderRadius: radius.sm, backgroundColor: colors.border, overflow: "hidden", marginTop: space(1) }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.primary }} />
    </View>
  );
}

function StatRows({ rows }: { rows: StoryStatRowT[] }): React.ReactElement {
  const colors = useColors();
  const max = Math.max(0, ...rows.map((r) => r.read));
  if (rows.length === 0) return <EmptyState message={STR.stbRepEmpty} />;
  return (
    <View>
      {rows.map((r) => (
        <View key={r.id} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
            <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1, minWidth: 140 }}>
              {r.seriesNo != null ? `${bnNum(r.seriesNo)}. ` : ""}
              {r.nameBn}
            </Text>
            {r.secondCopy ? <Badge text={STR.stbRepSecondCopy} tone="warn" /> : null}
            {r.neverBorrowed ? <Badge text={STR.stbRepNeverBorrowed} tone="muted" /> : null}
          </View>
          <Bar value={r.read} max={max} />
          <Muted style={{ fontSize: 12, marginTop: space(1) }}>
            {STR.stbRepRowLine
              .replace("{lent}", bnNum(r.lent))
              .replace("{read}", bnNum(r.read))
              .replace("{readers}", bnNum(r.readers))
              .replace("{waiting}", bnNum(r.waiting))
              .replace("{copies}", bnNum(r.copies))}
          </Muted>
        </View>
      ))}
    </View>
  );
}

function PrefTable({ title, cells }: { title: string; cells: StoryPreferenceCellT[] }): React.ReactElement | null {
  const colors = useColors();
  if (cells.length === 0) return null;
  const max = Math.max(...cells.map((c) => c.read));
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{title}</Body>
      {cells.map((c) => (
        <View key={`${c.seriesNameBn}-${c.groupLabelBn}`} style={{ paddingVertical: space(1), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Text style={{ ...typeScale.body, color: colors.textPrimary, flex: 1 }}>
              {c.seriesNameBn} · {c.groupLabelBn}
            </Text>
            <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{bnNum(c.read)}</Text>
          </View>
          <Bar value={c.read} max={max} />
        </View>
      ))}
    </Card>
  );
}

export default function StorybookReportScreen(): React.ReactElement {
  const { can } = useAuth();
  const tabs = useMemo(
    () =>
      ([
        ["series", "reports:storybook_series", STR.stbRepTabSeries],
        ["books", "reports:storybook_books", STR.stbRepTabBooks],
        ["readers", "reports:storybook_readers", STR.stbRepTabReaders],
      ] as const).filter(([, perm]) => can(perm)),
    [can],
  );
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? "series");
  const [win, setWin] = useState<StoryReportWindowT>("d30");

  const [sq, rs] = useQuery({ query: STORY_SERIES_REPORT, variables: { window: win }, pause: tab !== "series" });
  const [bq, rb] = useQuery({ query: STORY_BOOKS_REPORT, variables: { window: win }, pause: tab !== "books" });
  const [rq, rr] = useQuery({ query: STORY_READERS_REPORT, variables: { window: win }, pause: tab !== "readers" });
  const active = tab === "series" ? sq : tab === "books" ? bq : rq;
  const reload = (): void => {
    const o = { requestPolicy: "network-only" as const };
    if (tab === "series") rs(o);
    else if (tab === "books") rb(o);
    else rr(o);
  };
  const { refreshing, onRefresh } = usePullRefresh(active.fetching, reload);
  const colors = useColors();
  const books = bq.data?.storyBooksReport ?? [];
  const secondCopies = books.filter((b) => b.secondCopy).length;
  const readers = rq.data?.storyReadersReport;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <ChipRow>
          {tabs.map(([key, , label]) => (
            <Chip key={key} label={label} selected={tab === key} onPress={() => setTab(key)} />
          ))}
        </ChipRow>
        <ChipRow>
          {([
            ["d30", STR.stbRepD30],
            ["d90", STR.stbRepD90],
            ["year", STR.stbRepYear],
          ] as const).map(([k, label]) => (
            <Chip key={k} label={label} selected={win === k} onPress={() => setWin(k)} />
          ))}
        </ChipRow>
        <QueryGate results={[active]} onRetry={reload} loaderLabel={STR.loading}>
          {tab === "series" ? (
            <Card>
              <StatRows rows={sq.data?.storySeriesReport ?? []} />
            </Card>
          ) : null}
          {tab === "books" ? (
            <View style={{ gap: space(3) }}>
              {secondCopies > 0 ? <Notice tone="warn" message={STR.stbRepSecondCopyHint.replace("{n}", bnNum(secondCopies))} /> : null}
              <Card>
                <StatRows rows={books} />
              </Card>
            </View>
          ) : null}
          {tab === "readers" && readers ? (
            <View style={{ gap: space(3) }}>
              <Card>
                {readers.readers.length === 0 ? <EmptyState message={STR.stbRepEmpty} /> : null}
                {readers.readers.map((r) => (
                  <View key={r.studentId} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, gap: space(1) }}>
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
                      <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1, minWidth: 120 }}>{r.name}</Text>
                      {r.stopped ? <Badge text={STR.stbRepStopped} tone="warn" /> : null}
                      {r.overdue ? <Badge text={STR.stbDeskOverdue} tone="danger" /> : null}
                    </View>
                    <Muted style={{ fontSize: 12 }}>
                      {STR.stbRepReaderLine.replace("{cls}", r.classLabelBn).replace("{sec}", r.sectionNameBn).replace("{n}", bnNum(r.read))}
                      {r.favouriteTagBn ? ` · ${STR.stbRepFavourite.replace("{tag}", r.favouriteTagBn)}` : ""}
                      {r.lastVisit ? ` · ${isoDateLabel(r.lastVisit)}` : ""}
                    </Muted>
                  </View>
                ))}
              </Card>
              <PrefTable title={STR.stbRepByClass} cells={readers.byClass} />
              <PrefTable title={STR.stbRepBySection} cells={readers.bySection} />
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
