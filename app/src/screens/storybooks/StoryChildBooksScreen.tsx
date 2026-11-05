/**
 * StoryChildBooksScreen (SB-4, W4) — a guardian's "my child's books": a book held at the
 * office (waitlist), the storybooks at home now with their due date, books read in the
 * last 7 days / this month / this year (the desk's tick at return), stickers earned, the
 * books being waited for, and earlier books.
 */
import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CHILD_STORY_READING, CHILD_STORY_WAITS, type StoryLoanT } from "../../graphql/storybooks";
import { Badge, Body, Card, Loader, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, isoDateLabel } from "../../lib/labels";
import type { StorybooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";
import { StoryImage } from "./StoryImage";

type Props = NativeStackScreenProps<StorybooksStackParamList, "StoryChildBooks">;

function LoanRow({ l, onOpen, history }: { l: StoryLoanT; onOpen: () => void; history?: boolean }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: space(3), alignItems: "center", paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ width: 72 }}>
        <StoryImage fileId={l.coverFileId} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text onPress={onOpen} style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>
          {l.titleBn}
        </Text>
        <Muted style={{ fontSize: 12 }}>
          {l.seriesNameBn ?? ""}
          {l.seriesNo != null ? ` · ${STR.stbBookNo.replace("{n}", bnNum(l.seriesNo))}` : ""}
        </Muted>
        <Muted style={{ fontSize: 12 }}>
          {history
            ? (l.read ? STR.stbHistoryRead : STR.stbHistoryNotRead).replace("{date}", isoDateLabel(l.returnedAt))
            : STR.stbDueOn.replace("{date}", isoDateLabel(l.dueDate))}
        </Muted>
      </View>
      {!history && l.overdue ? <Badge text={STR.stbDeskOverdue} tone="danger" /> : null}
    </View>
  );
}

export default function StoryChildBooksScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { selected } = useGuardianChild();
  const sid = selected?.studentId ?? "";
  const [q, refetch] = useQuery({ query: CHILD_STORY_READING, variables: { studentId: sid }, pause: !sid });
  const [wq, refetchW] = useQuery({ query: CHILD_STORY_WAITS, variables: { studentId: sid }, pause: !sid });
  const reload = (): void => {
    refetch({ requestPolicy: "network-only" });
    refetchW({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reload);
  const r = q.data?.childStoryReading;
  const waits = wq.data?.childStoryWaits ?? [];
  const held = waits.filter((w) => w.position === 0);
  const name = selected ? selected.nameBn || selected.name : "";
  const open = (titleId: string, title: string) => navigation.navigate("StoryBook", { titleId, title });

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChildSwitcher />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {!selected ? (
          <Loader label={STR.loading} />
        ) : (
          <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
            {r ? (
              <View style={{ gap: space(3) }}>
                {held.map((w) => (
                  <Notice key={w.titleId} tone="ok" message={STR.stbWaitHeld.replace("{name}", name).replace("{date}", isoDateLabel(w.holdUntil))} />
                ))}
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stbCountsTitle}</Body>
                  <View style={{ flexDirection: "row" }}>
                    {[
                      [STR.stbCount7, r.readLast7Days],
                      [STR.stbCountMonth, r.readThisMonth],
                      [STR.stbCountYear, r.readThisYear],
                    ].map(([label, n]) => (
                      <View key={String(label)} style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ ...typeScale.pageTitle, color: colors.textPrimary }}>{bnNum(n as number)}</Text>
                        <Muted style={{ fontSize: 12 }}>{label as string}</Muted>
                      </View>
                    ))}
                  </View>
                  <View style={{ alignItems: "center", marginTop: space(2) }}>
                    <Badge text={STR.stbStickersEarned.replace("{n}", bnNum(r.stickersThisYear))} tone="ok" />
                  </View>
                </Card>
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.stbHoldingNow}</Body>
                  {r.current.length === 0 ? <Muted>{STR.stbHoldingNone}</Muted> : null}
                  {r.current.map((l) => (
                    <LoanRow key={l.loanId} l={l} onOpen={() => open(l.titleId, l.titleBn)} />
                  ))}
                </Card>
                {waits.length > 0 ? (
                  <Card>
                    <Body style={{ fontWeight: "700" }}>{STR.stbWaitingTitle}</Body>
                    {waits.map((w) => (
                      <View key={w.titleId} style={{ flexDirection: "row", paddingVertical: space(1), gap: space(2) }}>
                        <Text onPress={() => open(w.titleId, w.titleBn)} style={{ ...typeScale.body, color: colors.textPrimary, flex: 1 }}>
                          {w.titleBn}
                        </Text>
                        <Badge
                          text={w.position === 0 ? STR.stbQueueHeld.replace("{date}", isoDateLabel(w.holdUntil)) : STR.stbWaitPos.replace("{n}", bnNum(w.position))}
                          tone={w.position === 0 ? "ok" : "info"}
                        />
                      </View>
                    ))}
                  </Card>
                ) : null}
                {r.history.length > 0 ? (
                  <Card>
                    <Body style={{ fontWeight: "700" }}>{STR.stbHistoryTitle}</Body>
                    {r.history.map((l) => (
                      <LoanRow key={l.loanId} l={l} history onOpen={() => open(l.titleId, l.titleBn)} />
                    ))}
                  </Card>
                ) : null}
              </View>
            ) : null}
          </QueryGate>
        )}
      </ScrollView>
    </Screen>
  );
}
