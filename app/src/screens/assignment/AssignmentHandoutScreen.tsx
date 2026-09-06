/**
 * AssignmentHandoutScreen (AS-T7, D-#643) — the whole-school handout board.
 *
 * The office's preparation view and the tap-through from both Today cards: for the
 * week containing the chosen date, which section gets which subject packets, who
 * takes that section's LAST period (the person who will come to the counter), and
 * whether each packet has a print request behind it yet.
 *
 * Read-only by design (owner call 2026-09-05): the cross-check is done with paper in
 * hand, and a tick box nobody is required to fill is worse than an honest list. The
 * date stepper walks whole days — the board follows the week the date falls in, so
 * stepping back on a Friday still shows the week that just delivered.
 */
import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { ASSIGNMENT_HANDOUT_BOARD_QUERY, type HandoutPacketT } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, classLevelLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { dateKey } from "../../lib/dates";
import { space } from "../../theme/tokens";

/** `dateKey` ± n days, kept in local time (the board is a school-day view). */
function shiftKey(key: string, days: number): string {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function PacketChips({ packets }: { packets: HandoutPacketT[] }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
      {packets.map((p) => (
        <Badge
          key={p.entryId}
          text={p.printRequested ? hwSubjectLabel(p.subject) : `${hwSubjectLabel(p.subject)} ⚠`}
          tone={p.printRequested ? "muted" : "warn"}
        />
      ))}
    </View>
  );
}

export default function AssignmentHandoutScreen(): React.ReactElement {
  const [date, setDate] = useState(() => dateKey());
  const [q, refetch] = useQuery({
    query: ASSIGNMENT_HANDOUT_BOARD_QUERY,
    variables: { date },
    requestPolicy: "cache-and-network",
  });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));

  const board = q.data?.assignmentHandoutBoard ?? null;
  const sections = board?.sections ?? [];
  const totalPackets = sections.reduce((n, s) => n + s.packets.length, 0);
  const unprinted = sections.reduce((n, s) => n + s.packets.filter((p) => !p.printRequested).length, 0);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(2) }}>
          <Pressable accessibilityRole="button" onPress={() => setDate((d) => shiftKey(d, -1))}>
            <Badge text="◀" tone="muted" />
          </Pressable>
          <H2>{bnNum(date)}</H2>
          <Pressable accessibilityRole="button" onPress={() => setDate((d) => shiftKey(d, 1))}>
            <Badge text="▶" tone="muted" />
          </Pressable>
        </View>

        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : null}
        {q.fetching && !board ? <Loader label={STR.loading} /> : null}

        {board ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.hoBoardTitle}</Body>
            <Muted style={{ marginTop: 2 }}>
              {STR.hoWeekWord} {bnNum(board.weekNumber)}
              {board.deliveryDateKey ? ` · ${STR.hoDeliveryDate}: ${bnNum(board.deliveryDateKey)}` : ""}
            </Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(2) }}>
              {board.isDeliveryToday ? <Badge text={STR.hoDeliveryToday} tone="brand" /> : null}
              <Badge text={`${bnNum(totalPackets)} ${STR.hoSubjectsWord}`} tone="info" />
              {unprinted > 0 ? <Badge text={`${STR.hoNotPrinted}: ${bnNum(unprinted)}`} tone="warn" /> : null}
            </View>
          </Card>
        ) : null}

        {board && sections.length === 0 && !q.fetching ? <EmptyState message={STR.hoEmptyWeek} /> : null}

        {sections.map((s) => (
          <Card key={s.sectionId}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700" }}>
                {classLevelLabel(s.classLevel)}
                {s.sectionNameBn ? ` — ${s.sectionNameBn}` : ""}
              </Body>
              {s.lastPeriodNumber ? (
                <Muted>
                  {STR.hoPeriodWord} {bnNum(s.lastPeriodNumber)}
                </Muted>
              ) : null}
              {s.isCover ? <Badge text={STR.hoCover} tone="info" /> : null}
              <Badge text={`${bnNum(s.packets.length)} ${STR.hoSubjectsWord}`} tone="brand" />
            </View>

            {s.handoutTeacherName ? (
              <Muted style={{ marginTop: 2 }}>{s.handoutTeacherName}</Muted>
            ) : (
              <Badge text={STR.hoNoTeacher} tone="danger" />
            )}

            <PacketChips packets={s.packets} />

            {/* Per-subject detail: who prepares it, and whether the digital delivery
                pass has been entered — the two things the office is asked about. */}
            {s.packets.map((p) => (
              <View
                key={`${p.entryId}-row`}
                style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}
              >
                <Body style={{ flex: 1 }}>
                  {hwSubjectLabel(p.subject)}
                  {p.subjectTeacherName ? ` · ${p.subjectTeacherName}` : ""}
                </Body>
                <Badge text={p.delivered ? STR.hoEntered : STR.hoNotEntered} tone={p.delivered ? "ok" : "muted"} />
              </View>
            ))}

            {s.nilPackets.length > 0 ? (
              <Muted style={{ marginTop: space(2) }}>
                {STR.hoNilTitle}: {s.nilPackets.map((p) => hwSubjectLabel(p.subject)).join(", ")}
              </Muted>
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
