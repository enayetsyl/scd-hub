/**
 * MarkEscalationListScreen (D-#1106) — the 09:30 "জমার হিসাব বাকি" list, reopened.
 *
 * The 09:30 pop-up (D-#890, MarkEscalationPopup) closes for good once Office or the
 * Principal taps "বুঝেছি". This screen reads the same server snapshot again, for any day
 * that had one: the newest by default, or the day picked. Rows marked after 09:30 say so,
 * and a row opens that section's অ্যাসাইনমেন্ট কাজ to check it — only for a login holding
 * `assignment:view` (the workspace's own gate; Office is off by default). Reaching it does NOT
 * acknowledge anything; it is a plain read gated on `mark_submission:alerts`.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MARK_ESCALATION, MARK_ESCALATION_DAYS } from "../../graphql/markSubmission";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Select, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, fullDateLabel, hwSubjectLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "MarkEscalationList">;

export default function MarkEscalationListScreen({ navigation, route }: Props): React.ReactElement {
  const { can } = useAuth();
  const canOpenWork = can("assignment:view");
  const [picked, setPicked] = useState<string | null>(route.params?.dateKey ?? null);
  const [daysQ, refetchDays] = useQuery({ query: MARK_ESCALATION_DAYS, requestPolicy: "cache-and-network" });
  const days = daysQ.data?.markEscalationDays ?? [];
  const dateKey = picked ?? days[0]?.dateKey ?? null;
  const [listQ, refetchList] = useQuery({
    query: MARK_ESCALATION,
    variables: { dateKey },
    pause: !dateKey,
    requestPolicy: "cache-and-network",
  });
  const list = dateKey ? listQ.data?.markEscalation ?? null : null;
  const rows = list?.rows ?? [];
  const open = rows.filter((r) => !r.markedNow).length;

  function retry(): void {
    refetchDays({ requestPolicy: "network-only" });
    if (dateKey) refetchList({ requestPolicy: "network-only" });
  }

  return (
    <Screen>
      <Muted style={{ marginBottom: space(3) }}>{STR.mesIntro}</Muted>
      <QueryGate
        results={dateKey ? [daysQ, listQ] : [daysQ]}
        onRetry={retry}
        isEmpty={days.length === 0}
        empty={<EmptyState message={STR.mesNoDays} />}
      >
        <Select
          label={STR.mesDay}
          value={dateKey}
          options={days.map((d) => ({
            label: fullDateLabel(d.dateKey),
            value: d.dateKey,
            hint: d.openCount > 0 ? `${bnNum(d.openCount)} ${STR.msgItemPending}` : STR.mesAllDone,
          }))}
          onChange={setPicked}
        />
        {list ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.mesSummary.replace("{total}", bnNum(rows.length)).replace("{open}", bnNum(open))}
            </Body>
          </Card>
        ) : (
          <EmptyState message={STR.mesNoList} />
        )}
        {rows.map((r) => (
          <Card
            key={r.asItemId}
            onPress={
              // The workspace is `assignment:view` (Office is off by default) — without it
              // the row would open an empty page, so it stays a plain row.
              canOpenWork && r.classId
                ? () => navigation.navigate("AssignmentWorkspace", { sectionId: r.sectionId, classId: r.classId })
                : undefined
            }
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{r.teacherNames.join(", ")}</Body>
                <Muted>
                  {r.sectionLabel} · {hwSubjectLabel(r.subject)} ({r.asId})
                </Muted>
              </View>
              <Badge
                text={r.markedNow ? STR.msgEscMarkedNow : STR.msgItemPending}
                tone={r.markedNow ? "ok" : "danger"}
              />
            </View>
          </Card>
        ))}
      </QueryGate>
    </Screen>
  );
}
