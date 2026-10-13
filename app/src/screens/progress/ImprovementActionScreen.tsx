/**
 * ImprovementActionScreen (SP-2..SP-4, docs/prd-student-progress.md §4–§6) — one action as
 * Office / Principal track it: progress per part, a day strip per part showing WHO marked each
 * day (the teacher, the cover teacher on a leave day, or Office/Principal on behalf — never
 * blurred together), the reasons for missed days, each family's ticks for a CLASS action,
 * today's hand-over, before/after once it has ended, and Stop / Extend.
 *
 * Tapping an unmarked teacher day (today or earlier) marks it on the teacher's behalf (D-#737):
 * a DONE needs "how do you know", a COULDNT needs the reason.
 */
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { IMPROVEMENT_ON_BEHALF_REASONS, IMPROVEMENT_TEACHER_REASONS } from "@scd/shared";
import {
  IMPROVEMENT_ACTION,
  STOP_IMPROVEMENT_ACTION,
  EXTEND_IMPROVEMENT_ACTION,
  TICK_IMPROVEMENT_TASK,
  UNTICK_IMPROVEMENT_TASK,
  type ImprovementDayCellT,
} from "../../graphql/improvement";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, classSectionLabel, subjectShortLabel, improvementReasonLabel } from "../../lib/labels";
import { isWholeClassSectionName } from "../../lib/sectionPicks";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { actionStateLabel, actionStateTone, dayLook, shortDay } from "../../lib/improvement";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ImprovementAction">;

const pct = (v: number | null | undefined): string => (v == null ? "—" : `${bnNum(Math.round(v))}%`);

function Strip({
  label,
  days,
  onPick,
  picked,
}: {
  label: string;
  days: ImprovementDayCellT[];
  onPick?: (d: ImprovementDayCellT) => void;
  picked?: string | null;
}): React.ReactElement {
  const c = useColors();
  return (
    <View style={{ gap: 6, marginTop: space(2) }}>
      <Text style={{ fontWeight: "600", color: c.textPrimary }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {days.map((d) => {
          const look = dayLook(d, c);
          const tip = `${d.dayKey}: ${look.label}${d.byName ? ` — ${d.byName}` : ""}${d.reason ? ` (${improvementReasonLabel(d.reason)})` : ""}`;
          const body = (
            <View
              style={{
                width: 46,
                height: 50,
                borderRadius: 6,
                borderWidth: picked === d.dayKey ? 3 : 1,
                borderColor: picked === d.dayKey ? c.info : look.border,
                borderStyle: d.future ? "dashed" : "solid",
                backgroundColor: look.bg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 10, color: look.fg }}>{shortDay(d.dayKey)}</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", color: look.fg }}>{look.mark}</Text>
            </View>
          );
          return onPick && !d.future ? (
            <Pressable key={d.dayKey} onPress={() => onPick(d)} accessibilityRole="button" accessibilityLabel={tip}>
              {body}
            </Pressable>
          ) : (
            <View key={d.dayKey} accessibilityLabel={tip}>
              {body}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Legend(): React.ReactElement {
  const c = useColors();
  const items: Array<{ status: string | null; by: string | null; future: boolean }> = [
    { status: "DONE", by: "SELF", future: false },
    { status: "DONE", by: "COVER", future: false },
    { status: "DONE", by: "OFFICE", future: false },
    { status: "COULDNT", by: "SELF", future: false },
    { status: null, by: null, future: false },
    { status: null, by: null, future: true },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(1) }}>
      {items.map((it, i) => {
        const l = dayLook(it, c);
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: l.bg, borderWidth: 1, borderColor: l.border, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: l.fg }}>{l.mark}</Text>
            </View>
            <Text style={{ fontSize: 12, color: c.textSecondary }}>{l.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ImprovementActionScreen({ route }: Props): React.ReactElement {
  const { id } = route.params;
  const c = useColors();
  const [q, refetch] = useQuery({ query: IMPROVEMENT_ACTION, variables: { id }, requestPolicy: "cache-and-network" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const [stopM, stop] = useMutation(STOP_IMPROVEMENT_ACTION);
  const [extM, extend] = useMutation(EXTEND_IMPROVEMENT_ACTION);
  const [tickM, tick] = useMutation(TICK_IMPROVEMENT_TASK);
  const [, untick] = useMutation(UNTICK_IMPROVEMENT_TASK);
  const [err, setErr] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<ImprovementDayCellT | null>(null);
  const [pickMode, setPickMode] = React.useState<"DONE" | "COULDNT">("DONE");

  const d = q.data?.improvementAction;
  const a = d?.summary;
  const reload = (): void => refetch({ requestPolicy: "network-only" });

  async function run<T>(p: Promise<{ error?: unknown; data?: T }>): Promise<boolean> {
    setErr(null);
    const res = await p;
    if (res.error) {
      setErr(friendlyError(res.error as never));
      return false;
    }
    reload();
    return true;
  }

  const missed = [...(d?.teacherDays ?? []).map((x) => ({ ...x, part: STR.impTeacherPart })), ...(d?.guardianDays ?? []).map((x) => ({ ...x, part: STR.impGuardianPart }))]
    .filter((x) => !x.future && x.status !== "DONE")
    .sort((x, y) => y.dayKey.localeCompare(x.dayKey));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <QueryGate result={q} onRetry={reload} loaderLabel={STR.loading}>
          {a && d ? (
            <View style={{ gap: space(3) }}>
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", fontSize: 17, flexShrink: 1 }}>
                    {subjectShortLabel(a.subject)} ·{" "}
                    {a.scope === "CLASS"
                      ? `${STR.impScopeClass} · ${a.classLevel != null ? classSectionLabel(a.classLevel, isWholeClassSectionName(a.sectionNameBn) ? null : a.sectionNameBn) : a.sectionNameBn}`
                      : a.studentName}
                  </Body>
                  <Badge
                    text={`${actionStateLabel(a.state)}${a.state === "RUNNING" && a.dayNumber ? ` · ${STR.impDay} ${bnNum(a.dayNumber)}/${bnNum(a.totalDays)}` : ""}`}
                    tone={actionStateTone(a.state)}
                  />
                </View>
                <Muted>
                  {a.startKey} – {a.endKey} · {bnNum(a.totalDays)} {STR.impDay}
                  {a.createdByName ? ` · ${a.createdByName}` : ""}
                </Muted>
                {a.reason ? <Muted>{STR.impWhy}: {a.reason}</Muted> : null}
                {a.stopReason ? <Muted>{STR.impStStopped}: {a.stopReason}</Muted> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
                  {a.teacherTask ? (
                    <View style={{ flexGrow: 1, flexBasis: 220, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space(3) }}>
                      <Muted>
                        {STR.impTeacherPart}
                        {a.teacherName ? ` · ${a.teacherName}` : ""}
                      </Muted>
                      <Text style={{ color: c.textPrimary }}>{a.teacherTask}</Text>
                      <Text style={{ fontSize: 22, fontWeight: "700", color: c.textPrimary }}>
                        {bnNum(a.teacherDone)}/{bnNum(a.teacherOwed)}
                      </Text>
                    </View>
                  ) : null}
                  {a.guardianTask ? (
                    <View style={{ flexGrow: 1, flexBasis: 220, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space(3) }}>
                      <Muted>{STR.impGuardianPart}</Muted>
                      <Text style={{ color: c.textPrimary }}>{a.guardianTask}</Text>
                      <Text style={{ fontSize: 22, fontWeight: "700", color: c.textPrimary }}>
                        {bnNum(a.guardianDone)}/{bnNum(a.guardianOwed)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flexGrow: 1, flexBasis: 200, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space(3) }}>
                    <Muted>
                      {STR.impBefore} → {STR.impAfter}
                    </Muted>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: c.textPrimary }}>
                      {pct(a.before)} → {a.after == null ? "…" : pct(a.after)}
                    </Text>
                    {a.after == null ? <Muted>{STR.impAfterPending}</Muted> : null}
                  </View>
                </View>
                {d.todayResponsibleSource && d.todayResponsibleSource !== "ASSIGNED" ? (
                  <Notice
                    message={`${STR.impTodayBy}: ${d.todayResponsibleName ?? STR.impNeedsPerson}${d.todayResponsibleSource === "COVER" ? ` (${STR.impSourceCover})` : d.todayResponsibleSource === "OVERRIDE" ? ` (${STR.impSourceOverride})` : ""}`}
                    tone={d.todayResponsibleSource === "NONE" ? "warn" : "info"}
                  />
                ) : null}
              </Card>

              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.impDayByDay}</Body>
                <Legend />
                {d.teacherDays.length ? (
                  <Strip
                    label={`${STR.impTeacherPart}${a.teacherName ? ` — ${a.teacherName}` : ""}`}
                    days={d.teacherDays}
                    picked={picked?.dayKey ?? null}
                    onPick={a.state === "STOPPED" ? undefined : (day) => setPicked(day.dayKey === picked?.dayKey ? null : day)}
                  />
                ) : null}
                {d.guardianDays.length ? <Strip label={STR.impGuardianPart} days={d.guardianDays} /> : null}

                {picked ? (
                  <View style={{ marginTop: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: c.surfaceAlt, gap: space(2) }}>
                    <Body style={{ fontWeight: "700" }}>{picked.dayKey}</Body>
                    {picked.status ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                        <Muted>
                          {picked.status === "DONE" ? STR.impLegendDone : STR.impLegendCouldnt}
                          {picked.byName ? ` — ${picked.byName}` : ""}
                          {picked.reason ? ` (${improvementReasonLabel(picked.reason)})` : ""}
                        </Muted>
                        <Button
                          title={STR.impUndo}
                          variant="ghost"
                          onPress={async () => {
                            if (await run(untick({ actionId: a.id, dayKey: picked.dayKey }))) setPicked(null);
                          }}
                        />
                      </View>
                    ) : (
                      <View style={{ gap: space(2) }}>
                        <ChipRow>
                          <Chip label={STR.impMarkOnBehalf} selected={pickMode === "DONE"} onPress={() => setPickMode("DONE")} />
                          <Chip label={STR.impMarkCouldnt} selected={pickMode === "COULDNT"} onPress={() => setPickMode("COULDNT")} />
                        </ChipRow>
                        <Muted>{pickMode === "DONE" ? STR.impHowKnow : STR.impWhyNot}</Muted>
                        <ChipRow>
                          {(pickMode === "DONE" ? IMPROVEMENT_ON_BEHALF_REASONS : IMPROVEMENT_TEACHER_REASONS).map((r) => (
                            <Chip
                              key={r}
                              label={improvementReasonLabel(r)}
                              onPress={async () => {
                                if (await run(tick({ actionId: a.id, dayKey: picked.dayKey, status: pickMode, reason: r }))) setPicked(null);
                              }}
                            />
                          ))}
                        </ChipRow>
                        {tickM.fetching ? <Muted>{STR.loading}</Muted> : null}
                      </View>
                    )}
                  </View>
                ) : null}
              </Card>

              {missed.length ? (
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.impMissedNotes}</Body>
                  {missed.slice(0, 20).map((x) => (
                    <Muted key={`${x.part}-${x.dayKey}`} style={{ marginTop: 4 }}>
                      {x.dayKey} · {x.part}: {x.status === "COULDNT" ? `${STR.impLegendCouldnt} — ${improvementReasonLabel(x.reason)}${x.byName ? ` (${x.byName})` : ""}` : STR.impLegendNotMarked}
                    </Muted>
                  ))}
                </Card>
              ) : null}

              {d.families.length ? (
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.impFamilies}</Body>
                  {d.families.map((f) => (
                    <View key={f.studentId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border }}>
                      <Text style={{ flex: 1, color: c.textPrimary, fontWeight: "600" }}>{f.name}</Text>
                      <Text style={{ color: f.done === 0 && f.owed > 0 ? c.error : c.textPrimary, fontWeight: "700" }}>
                        {bnNum(f.done)}/{bnNum(f.owed)}
                      </Text>
                      <Text style={{ width: 70, textAlign: "right", color: c.textSecondary, letterSpacing: 2 }}>
                        {f.last3.map((s) => (s === "DONE" ? "✓" : s === "COULDNT" ? "–" : "?")).join(" ")}
                      </Text>
                    </View>
                  ))}
                </Card>
              ) : null}

              {err ? <Notice message={err} tone="danger" /> : null}
              {a.state === "RUNNING" || a.state === "UPCOMING" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={STR.impExtend5} variant="secondary" loading={extM.fetching} onPress={() => void run(extend({ id: a.id, days: 5 }))} />
                  <Button title={STR.impStop} variant="danger" loading={stopM.fetching} onPress={() => void run(stop({ id: a.id }))} />
                </View>
              ) : null}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
