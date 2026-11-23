/**
 * AssignmentLoadPanel (AL-8, AC-C10, PRD §4.4) — "শিশুর সাপ্তাহিক চাপ": per child, the minutes on Friday and Saturday
 * summed across every subject of the week plus weekend extra homework. A day over the daily cap is a warning, never a
 * block (R10). The Thursday class homework is listed on its own line and is NOT counted (R27).
 * Wide table → a horizontal ScrollView inside its card (360 dp).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { ASSIGNMENT_LOAD_QUERY, type AssignmentLoad } from "../graphql/mastery";
import { Badge, Body, Card, Muted, Notice } from "./ui";
import { STR, bnNum, hwSubjectLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space, useColors } from "../theme";

const fill = (tpl: string, vars: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export function AssignmentLoadPanel({ sectionId, dueDate }: { sectionId: string; dueDate: string }): React.ReactElement | null {
  const colors = useColors();
  const [{ data, error }] = useQuery({
    query: ASSIGNMENT_LOAD_QUERY,
    variables: { sectionId, dueDate },
    pause: !sectionId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate),
    requestPolicy: "cache-and-network",
  });
  const load = data?.assignmentLoad as AssignmentLoad | undefined;
  if (error) return <Notice message={friendlyError(error)} tone="danger" />;
  if (!load) return null;
  const hours = Math.round((load.dayCap / 60) * 10) / 10;
  const cell = (n: number, over: boolean) => (
    <View style={{ width: 64, alignItems: "center" }}>
      <Body style={{ color: over ? colors.error : colors.textPrimary, fontWeight: over ? "700" : "400" }}>{bnNum(n)}</Body>
    </View>
  );
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.al8LoadTitle}</Body>
      <Muted>{fill(STR.al8LoadHint, { n: bnNum(load.dayCap) })}</Muted>
      {load.children.length === 0 ? <Muted>{STR.al8LoadNone}</Muted> : null}
      {load.children.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ gap: space(1) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <View style={{ width: 150 }}>
                <Muted>{STR.al8LoadChild}</Muted>
              </View>
              <View style={{ width: 64, alignItems: "center" }}>
                <Muted>{STR.al8LoadFri}</Muted>
              </View>
              <View style={{ width: 64, alignItems: "center" }}>
                <Muted>{STR.al8LoadSat}</Muted>
              </View>
              <View style={{ width: 110 }}>
                <Muted>{STR.al8LoadExtra.replace("{n}", "")}</Muted>
              </View>
            </View>
            {load.children.map((c) => (
              <View key={c.studentId} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <View style={{ width: 150 }}>
                  <Body numberOfLines={1}>
                    {c.schoolId ? `${bnNum(c.schoolId)} · ` : ""}
                    {c.name}
                  </Body>
                </View>
                {cell(c.fri, c.overFri)}
                {cell(c.sat, c.overSat)}
                <View style={{ width: 110 }}>
                  <Muted>
                    {c.extraFri > 0 || c.extraSat > 0 ? `${bnNum(c.extraFri)} / ${bnNum(c.extraSat)}` : "—"}
                  </Muted>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {load.children.some((c) => c.warn) ? <Notice message={fill(STR.al8LoadWarn, { n: bnNum(hours) })} tone="warn" /> : null}
      {load.thursdayHomework.length > 0 ? (
        <View style={{ gap: space(1) }}>
          <Muted>{STR.al8LoadThu}</Muted>
          {load.thursdayHomework.map((h, i) => (
            <View key={`${h.subject}-${i}`} style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
              <Badge text={hwSubjectLabel(h.subject)} tone="muted" />
              <Body style={{ flexShrink: 1 }}>
                {bnNum(h.minutes)} {STR.asMinutes}
                {h.description ? ` · ${h.description}` : ""}
              </Body>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
