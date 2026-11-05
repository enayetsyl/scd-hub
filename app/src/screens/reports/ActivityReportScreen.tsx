/**
 * ActivityReportScreen (AS-5) — অ্যাক্টিভিটি শিট রিপোর্ট. Three tabs, each behind its own
 * Reports-hub switch (D-#861): দক্ষতা (reports:activity_skills), ব্যাংক (reports:activity_sheets),
 * শিক্ষার্থী (reports:activity_students — names children). Window: 30 days / 90 days / this year.
 * Bars are one hue, scaled to the largest value in view; the exact numbers sit on each row.
 */
import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import { ACTIVITY_SKILL_AREAS } from "@scd/shared";
import { ACTIVITY_BANK_REPORT, ACTIVITY_CHILDREN_REPORT, ACTIVITY_SKILL_REPORT, type ActivityReportWindowT } from "../../graphql/activitySheets";
import { Badge, Card, Chip, ChipRow, EmptyState, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, activityLevelLabel, activitySkillLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { radius, space, typeScale, useColors } from "../../theme";

type Tab = "skills" | "banks" | "children";

function Bar({ value, max }: { value: number; max: number }): React.ReactElement {
  const colors = useColors();
  const pct = max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ height: 8, borderRadius: radius.sm, backgroundColor: colors.border, overflow: "hidden", marginTop: space(1) }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.primary }} />
    </View>
  );
}

export default function ActivityReportScreen(): React.ReactElement {
  const colors = useColors();
  const { can } = useAuth();
  const tabs = useMemo(
    () =>
      ([
        ["skills", "reports:activity_skills", STR.actRepTabSkills],
        ["banks", "reports:activity_sheets", STR.actRepTabBanks],
        ["children", "reports:activity_students", STR.actRepTabChildren],
      ] as const).filter(([, perm]) => can(perm)),
    [can],
  );
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? "skills");
  const [win, setWin] = useState<ActivityReportWindowT>("d30");
  const [sq, rs] = useQuery({ query: ACTIVITY_SKILL_REPORT, variables: { window: win }, pause: tab !== "skills" });
  const [bq, rb] = useQuery({ query: ACTIVITY_BANK_REPORT, variables: { window: win }, pause: tab !== "banks" });
  const [cq, rc] = useQuery({ query: ACTIVITY_CHILDREN_REPORT, variables: { window: win }, pause: tab !== "children" });
  const active = tab === "skills" ? sq : tab === "banks" ? bq : cq;
  const reload = (): void => {
    const o = { requestPolicy: "network-only" as const };
    if (tab === "skills") rs(o);
    else if (tab === "banks") rb(o);
    else rc(o);
  };
  const { refreshing, onRefresh } = usePullRefresh(active.fetching, reload);
  const skills = sq.data?.activitySkillReport;
  const banks = bq.data?.activityBankReport ?? [];
  const kids = cq.data?.activityChildrenReport;
  const row = { paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border } as const;

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
          {tab === "skills" && skills ? (
            <View style={{ gap: space(3) }}>
              <Card>
                {skills.rows.map((r) => (
                  <View key={r.skill} style={row}>
                    <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{activitySkillLabel(r.skill)}</Text>
                    <Bar value={r.finished} max={Math.max(0, ...skills.rows.map((x) => x.finished))} />
                    <Muted style={{ fontSize: 12, marginTop: space(1) }}>
                      {STR.actRepSkillLine.replace("{n}", bnNum(r.finished)).replace("{p}", bnNum(r.allCorrectPct)).replace("{c}", bnNum(r.children))}
                    </Muted>
                  </View>
                ))}
              </Card>
              {skills.grid.length > 0 ? (
                <Card>
                  <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, marginBottom: space(2) }}>{STR.actRepGrid}</Text>
                  {[...new Set(skills.grid.map((g) => g.classLabelBn))].map((cls) => (
                    <View key={cls} style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1), flexWrap: "wrap" }}>
                      <Text style={{ ...typeScale.body, color: colors.textPrimary, width: 110 }}>{cls}</Text>
                      {ACTIVITY_SKILL_AREAS.map((sk) => {
                        const cell = skills.grid.find((g) => g.classLabelBn === cls && g.skill === sk);
                        return (
                          <Muted key={sk} style={{ minWidth: 90 }}>
                            {activitySkillLabel(sk)} {bnNum(cell?.finished ?? 0)}
                          </Muted>
                        );
                      })}
                    </View>
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}
          {tab === "banks" ? (
            <Card>
              {banks.length === 0 ? <EmptyState message={STR.stbRepEmpty} /> : null}
              {banks.map((b) => (
                <View key={b.bankId} style={row}>
                  <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                    <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1, minWidth: 140 }}>
                      {b.nameBn} <Text style={{ color: colors.textSecondary }}>· {b.code}</Text>
                    </Text>
                    {b.neverTaken ? <Badge text={STR.actRepNeverTaken} tone="muted" /> : null}
                    {b.notReturned > 0 ? <Badge text={STR.actRepNotReturned.replace("{n}", bnNum(b.notReturned))} tone="warn" /> : null}
                    {b.repeats > 0 ? <Badge text={STR.actRepRepeats.replace("{n}", bnNum(b.repeats))} tone="info" /> : null}
                  </View>
                  <Bar value={b.given} max={Math.max(0, ...banks.map((x) => x.given))} />
                  <Muted style={{ fontSize: 12, marginTop: space(1) }}>
                    {STR.actRepBankLine
                      .replace("{g}", bnNum(b.given))
                      .replace("{b}", bnNum(b.back))
                      .replace("{p}", bnNum(b.allCorrectPct))
                      .replace("{t}", bnNum(b.viaTray))
                      .replace("{u}", bnNum(b.viaGuardian))}
                  </Muted>
                  {b.levels
                    .filter((l) => l.given > 0 || l.back > 0)
                    .map((l) => (
                      <View key={l.level} style={{ flexDirection: "row", gap: space(2), alignItems: "center", marginTop: space(1) }}>
                        <Muted style={{ fontSize: 12 }}>
                          {STR.actRepLevelLine.replace("{level}", activityLevelLabel(l.level)).replace("{b}", bnNum(l.back)).replace("{p}", bnNum(l.allCorrectPct))}
                        </Muted>
                        {l.tooHard ? <Badge text={STR.actRepTooHard} tone="warn" /> : null}
                      </View>
                    ))}
                </View>
              ))}
            </Card>
          ) : null}
          {tab === "children" && kids ? (
            <View style={{ gap: space(3) }}>
              <Card>
                {kids.children.length === 0 ? <EmptyState message={STR.stbRepEmpty} /> : null}
                {kids.children.map((c) => (
                  <View key={c.studentId} style={row}>
                    <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
                      <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1, minWidth: 120 }}>{c.name}</Text>
                      {c.open > 0 ? <Badge text={STR.actRepOpen.replace("{n}", bnNum(c.open))} tone="info" /> : null}
                      {c.notReturned > 0 ? <Badge text={STR.actRepNotReturned.replace("{n}", bnNum(c.notReturned))} tone="warn" /> : null}
                    </View>
                    <Muted style={{ fontSize: 12 }}>
                      {STR.actRepChildLine.replace("{cls}", c.classLabelBn).replace("{sec}", c.sectionNameBn).replace("{n}", bnNum(c.finished)).replace("{a}", bnNum(c.allCorrect))}
                      {c.favouriteSkillBn ? ` · ${STR.actRepFavourite.replace("{skill}", c.favouriteSkillBn)}` : ""}
                      {c.last ? ` · ${isoDateLabel(c.last)}` : ""}
                    </Muted>
                  </View>
                ))}
              </Card>
              {kids.sections.length > 0 ? (
                <Card>
                  <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, marginBottom: space(2) }}>{STR.actRepSections}</Text>
                  {kids.sections.map((s) => (
                    <View key={`${s.classLabelBn}-${s.sectionNameBn}`} style={row}>
                      <Text style={{ ...typeScale.body, color: colors.textPrimary }}>
                        {s.classLabelBn} · {s.sectionNameBn}
                      </Text>
                      <Bar value={s.finished} max={Math.max(0, ...kids.sections.map((x) => x.finished))} />
                      <Muted style={{ fontSize: 12 }}>{STR.actRepSectionLine.replace("{n}", bnNum(s.children)).replace("{f}", bnNum(s.finished))}</Muted>
                    </View>
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
