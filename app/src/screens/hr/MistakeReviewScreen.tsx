/**
 * MistakeReviewScreen — ব্যাখ্যা যাচাই (D-#939, docs/prd-staff-mistakes.md §5): entries
 * waiting for a decision (never the caller's own), and every entry in the school. A
 * reviewer accepts the reason (not counted), counts it, or moves it to the person at fault,
 * with an optional note the staff member reads. D-#1020: the দিনের তালিকা tab is the
 * day's list the 18:00 report opens (route param dateKey); people who are not told
 * (no staff_mistakes:view_own) never read the note.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  DECIDE_STAFF_MISTAKE,
  STAFF_MISTAKE_MOVE_TARGETS,
  STAFF_MISTAKE_QUEUE,
  STAFF_MISTAKES,
  type StaffMistakeT,
} from "../../graphql/staffMistakes";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Button, Chip, ChipRow, Field, Select, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { StaffMistakeCard } from "../../components/StaffMistakeCard";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum, dhakaDateKey, fullDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

function DecidePanel({ m, onDone }: { m: StaffMistakeT; onDone: () => void }): React.ReactElement {
  const [note, setNote] = React.useState("");
  const [moveTo, setMoveTo] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState(false);
  const [targets] = useQuery({ query: STAFF_MISTAKE_MOVE_TARGETS, pause: !moving });
  const [{ fetching }, decide] = useMutation(DECIDE_STAFF_MISTAKE);
  const toast = useToast();

  async function go(decision: "EXCUSE" | "COUNT" | "MOVE"): Promise<void> {
    const res = await decide({ id: m.id, decision, note: note.trim() || null, moveToUserId: decision === "MOVE" ? moveTo : null });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(STR.smrDecided, "ok");
    onDone();
  }

  const options = (targets.data?.staffMistakeMoveTargets ?? [])
    .filter((t) => t.userId !== m.staffUserId)
    .map((t) => ({ label: t.name, value: t.userId }));

  return (
    <View style={{ marginTop: space(3), gap: space(2) }}>
      <Field label={STR.smrNoteLabel} value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.smrDecideExcuse} onPress={() => void go("EXCUSE")} loading={fetching} />
        <Button title={STR.smrDecideCount} variant="danger" onPress={() => void go("COUNT")} loading={fetching} />
        <Button title={STR.smrDecideMove} variant="secondary" onPress={() => setMoving(true)} disabled={fetching} />
      </View>
      {moving ? (
        <View style={{ gap: space(2) }}>
          <Select label={STR.smrMoveTo} value={moveTo} options={options} onChange={setMoveTo} placeholder={STR.smrMovePick} searchable />
          <Button title={STR.smrDecideMove} variant="secondary" onPress={() => void go("MOVE")} disabled={!moveTo} loading={fetching} />
        </View>
      ) : null}
    </View>
  );
}

/** "YYYY-MM-DD" moved by whole days (keys only — no device Intl). */
function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Props = NativeStackScreenProps<HrStackParamList, "MistakeReview">;

export default function MistakeReviewScreen({ route }: Props): React.ReactElement {
  const { can, user } = useAuth();
  const canSeeAll = can("staff_mistakes:view_all");
  const canReview = can("staff_mistakes:review");
  const today = dhakaDateKey();
  // D-#1020: the day's list is the daily report's page — the notification opens its date.
  const [tab, setTab] = React.useState<"day" | "queue" | "all">(canSeeAll ? "day" : "queue");
  const [day, setDay] = React.useState<string>(route.params?.dateKey ?? today);
  React.useEffect(() => {
    if (route.params?.dateKey && canSeeAll) {
      setDay(route.params.dateKey);
      setTab("day");
    }
  }, [route.params?.dateKey, canSeeAll]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [queue, refetchQueue] = useQuery({ query: STAFF_MISTAKE_QUEUE, requestPolicy: "cache-and-network", pause: tab !== "queue" || !canReview });
  const [all, refetchAll] = useQuery({ query: STAFF_MISTAKES, variables: {}, requestPolicy: "cache-and-network", pause: tab !== "all" });
  const [dayQ, refetchDay] = useQuery({ query: STAFF_MISTAKES, variables: { dateKey: day }, requestPolicy: "cache-and-network", pause: tab !== "day" });
  const q = tab === "queue" ? queue : tab === "day" ? dayQ : all;
  const rows = (tab === "queue" ? queue.data?.staffMistakeQueue : tab === "day" ? dayQ.data?.staffMistakes : all.data?.staffMistakes) ?? [];
  const refetch = (): void => {
    if (canReview) refetchQueue({ requestPolicy: "network-only" });
    if (canSeeAll) {
      refetchAll({ requestPolicy: "network-only" });
      refetchDay({ requestPolicy: "network-only" });
    }
  };

  return (
    <Screen scroll>
      <H2>{STR.smrReviewTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{tab === "day" ? STR.smrDayHelp : STR.smrReviewHelp}</Muted>
      {canSeeAll ? (
        <ChipRow>
          <Chip label={STR.smrTabDay} selected={tab === "day"} onPress={() => setTab("day")} />
          {canReview ? <Chip label={STR.smrTabQueue} selected={tab === "queue"} onPress={() => setTab("queue")} /> : null}
          <Chip label={STR.smrTabAll} selected={tab === "all"} onPress={() => setTab("all")} />
        </ChipRow>
      ) : null}
      {tab === "day" ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), marginVertical: space(2) }}>
          <Button title={STR.smrDayPrev} variant="secondary" onPress={() => setDay((d) => shiftDay(d, -1))} />
          <Body style={{ fontWeight: "700", flexShrink: 1, textAlign: "center" }}>
            {day === today ? `${STR.smrDayToday} · ` : ""}
            {fullDateLabel(day)}
            {rows.length > 0 ? ` · ${bnNum(rows.length)}` : ""}
          </Body>
          <Button title={STR.smrDayNext} variant="secondary" onPress={() => setDay((d) => shiftDay(d, 1))} disabled={day >= today} />
        </View>
      ) : null}
      {q.fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState message={tab === "queue" ? STR.smrReviewEmpty : tab === "day" ? STR.smrDayEmpty : STR.smrEmpty} />
      ) : (
        rows.map((m) => {
          // Nobody decides their own entry except the Principal (D-#1000; the server enforces it too).
          const decidable =
            canReview && m.status !== "MOVED" && (m.staffUserId !== user?.id || can("staff_mistakes:review_principal"));
          const decided = m.status === "COUNTED" || m.status === "EXCUSED";
          return (
            <StaffMistakeCard key={m.id} m={m} showName>
              {!decidable ? null : openId === m.id ? (
                <DecidePanel
                  m={m}
                  onDone={() => {
                    setOpenId(null);
                    refetch();
                  }}
                />
              ) : (
                <Button
                  title={decided ? STR.smrChangeDecision : STR.smrDecide}
                  variant={decided ? "secondary" : "primary"}
                  onPress={() => setOpenId(m.id)}
                  style={{ marginTop: space(3) }}
                />
              )}
            </StaffMistakeCard>
          );
        })
      )}
    </Screen>
  );
}
