/**
 * The activity-sheet card on the guardian's আজ (AS-4, D-#991 — the Today-card leg of the
 * checked alert): sheets with the child, the latest one checked (7 days), a level-up hint,
 * an owed sticker, and the month's count. Hidden when there is nothing to say.
 * Tapping it opens the child's sheets.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "urql";
import { ACTIVITY_TODAY } from "../../graphql/activitySheets";
import { Badge, Body, Card, Muted } from "../../components/ui";
import { STR, activityLevelLabel, activityResultLabel, bnNum } from "../../lib/labels";
import { space } from "../../theme";

export function ActivityTodayCard({ studentId, onOpen }: { studentId: string; onOpen: () => void }): React.ReactElement | null {
  const [q] = useQuery({ query: ACTIVITY_TODAY, variables: { studentId }, pause: !studentId, requestPolicy: "cache-and-network" });
  const t = q.data?.activityToday;
  if (!t || (t.open === 0 && !t.latest && t.owed === 0 && t.doneThisMonth === 0)) return null;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.actNav}</Body>
          <Muted>{STR.actTodayOpen}</Muted>
        </View>
        {t.latest ? (
          <Badge
            text={STR.actTodayLatest.replace("{bank}", t.latest.bankNameBn).replace("{result}", activityResultLabel(t.latest.issue.result ?? ""))}
            tone={t.latest.issue.result === "ALL_CORRECT" ? "ok" : "info"}
          />
        ) : null}
        {t.hint ? (
          <Muted style={{ marginTop: space(1) }}>
            {STR.actLevelHint.replace("{bank}", t.hint.bankNameBn).replace("{from}", activityLevelLabel(t.hint.from)).replace("{to}", activityLevelLabel(t.hint.to))}
          </Muted>
        ) : null}
        {t.open > 0 ? <Muted style={{ marginTop: space(1) }}>{STR.actTodayHolding.replace("{n}", bnNum(t.open))}</Muted> : null}
        {t.owed > 0 ? <Muted style={{ marginTop: space(1) }}>⭐ {STR.actTodayOwed}</Muted> : null}
        <Muted style={{ marginTop: space(2) }}>{STR.actTodayMonth.replace("{n}", bnNum(t.doneThisMonth))}</Muted>
      </Card>
    </Pressable>
  );
}
