/**
 * DailyReportTodayCard (D-#1052, owner 2026-11-06: notification plus an unread Today card) —
 * the newest daily school report whose notification this person has not opened. Opening the
 * report marks it read, so the card goes away. Own query: mount OUTSIDE Today's QueryGate.
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_UNREAD_DAILY_REPORT_QUERY } from "../graphql/dailyReport";
import { Body, Button, Card, Muted } from "./ui";
import { STR, bnNum, getActiveLang } from "../lib/labels";
import { space } from "../theme/tokens";

const num = (n: number): string => (getActiveLang() === "en" ? String(n) : bnNum(n));

export function DailyReportTodayCard(): React.ReactElement | null {
  const [q] = useQuery({ query: MY_UNREAD_DAILY_REPORT_QUERY, requestPolicy: "cache-and-network" });
  const nav = useNavigation() as unknown as { navigate: (name: string, params?: object) => void };
  const r = q.data?.myUnreadDailyReport;
  if (!r) return null;
  const h = r.headline;
  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <Body style={{ fontWeight: "700" }}>{STR.drpTodayCardTitle}</Body>
        <Muted>{r.dateKey}</Muted>
        <Body>{`${STR.drpOnTime} ${num(h.onTime)} · ${STR.drpProblems} ${num(h.problems)} · ${STR.drpMistakes} ${num(h.mistakes)}`}</Body>
        {h.rate != null ? <Muted>{`${STR.drpRate} ${num(h.rate)}%`}</Muted> : null}
        <Button
          title={STR.drpTodayCardOpen}
          variant="ghost"
          onPress={() => nav.navigate("ReportsTab", { screen: "DailyReport", params: { date: r.dateKey }, initial: false })}
        />
      </View>
    </Card>
  );
}
