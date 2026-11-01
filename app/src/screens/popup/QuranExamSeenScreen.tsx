/**
 * QuranExamSeenScreen (D-#882) — who tapped "ঠিক আছে, দেখেছি" on the Quran exam
 * schedule pop-up. That pop-up is built into the app, not a pop-up notice, so it has no
 * report of its own; this one sits in the pop-up section beside the notices' reports.
 * Not-seen families first, with their guardians' phones so the Office can call.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { QX_GUARDIAN_SEEN, type QxSeenRowT } from "../../graphql/quranExam";
import { Badge, Body, Card, Chip, ChipRow, EmptyState, ErrorBanner, Loader, Muted, Screen } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { STR, bnNum, isoDateTimeLabel } from "../../lib/labels";
import { qxLevelLabel } from "../../lib/quranExam";
import { friendlyError } from "../../lib/errors";
import type { PopupStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<PopupStackParamList, "QuranExamSeen">;

const FILTERS: Array<{ key: string; label: () => string }> = [
  { key: "not_seen", label: () => STR.qxSeenFilterNotSeen },
  { key: "seen", label: () => STR.qxSeenFilterSeen },
  { key: "all", label: () => STR.qxSeenFilterAll },
];

function stateBadge(r: QxSeenRowT): { text: string; tone: "ok" | "danger" | "gold" } {
  if (r.state === "SEEN") return { text: STR.qxSeenStateSeen, tone: "ok" };
  if (r.state === "CHANGED") return { text: STR.qxSeenStateChanged, tone: "gold" };
  return { text: STR.qxSeenStateNot, tone: "danger" };
}

export default function QuranExamSeenScreen({ route }: Props): React.ReactElement {
  const { examId } = route.params;
  const [filter, setFilter] = useState("not_seen");
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: QX_GUARDIAN_SEEN, variables: { examId, filter, page, pageSize: 30 }, requestPolicy: "cache-and-network" });
  useFocusEffect(React.useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]));
  const d = q.data?.quranExamGuardianSeen;

  return (
    <Screen scroll>
      {q.error ? <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      {q.fetching && !d ? <Loader label={STR.loading} /> : null}
      {d ? (
        <>
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.qxSeenProgress.replace("{seen}", bnNum(d.seen)).replace("{total}", bnNum(d.total)).replace("{notSeen}", bnNum(d.notSeen))}
            </Body>
            {d.changed > 0 ? <Muted>{STR.qxSeenChangedCount.replace("{n}", bnNum(d.changed))}</Muted> : null}
            {!d.published ? <Muted>{STR.qxSeenDraft}</Muted> : null}
          </Card>
          <ChipRow>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label()} selected={filter === f.key} onPress={() => { setFilter(f.key); setPage(1); }} />
            ))}
          </ChipRow>
          {d.rows.rows.length === 0 ? <EmptyState message={STR.ppListEmpty} /> : null}
          {d.rows.rows.map((r) => {
            const b = stateBadge(r);
            return (
              <Card key={r.studentId}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
                  <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160, fontWeight: "600" }}>{r.studentName}</Body>
                  <Badge text={b.text} tone={b.tone} />
                </View>
                <Muted>{`${r.classLabelBn} · ${qxLevelLabel(r.level)}`}</Muted>
                {r.seenAt ? <Muted>{STR.qxSeenBy.replace("{name}", r.seenByName ?? "").replace("{time}", isoDateTimeLabel(r.seenAt))}</Muted> : null}
                {r.state !== "SEEN" ? (
                  r.guardians.length ? r.guardians.map((g) => <Muted key={g}>{g}</Muted>) : <Muted>{STR.qxSeenNoGuardian}</Muted>
                ) : null}
              </Card>
            );
          })}
          <Pager page={d.rows.page} pageSize={d.rows.pageSize} total={d.rows.total} onPage={setPage} />
        </>
      ) : null}
    </Screen>
  );
}
