/**
 * MistakeReviewScreen — ব্যাখ্যা যাচাই (D-#939, docs/prd-staff-mistakes.md §5): entries
 * waiting for a decision (never the caller's own), and every entry in the school. A
 * reviewer accepts the reason (not counted), counts it, or moves it to the person at fault,
 * with an optional note the staff member reads.
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
import { Screen, H2, Muted, Button, Chip, ChipRow, Field, Select, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { StaffMistakeCard } from "../../components/StaffMistakeCard";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
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

export default function MistakeReviewScreen(): React.ReactElement {
  const { can, user } = useAuth();
  const canSeeAll = can("staff_mistakes:view_all");
  const [tab, setTab] = React.useState<"queue" | "all">("queue");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [queue, refetchQueue] = useQuery({ query: STAFF_MISTAKE_QUEUE, requestPolicy: "cache-and-network", pause: tab !== "queue" });
  const [all, refetchAll] = useQuery({ query: STAFF_MISTAKES, variables: {}, requestPolicy: "cache-and-network", pause: tab !== "all" });
  const q = tab === "queue" ? queue : all;
  const rows = (tab === "queue" ? queue.data?.staffMistakeQueue : all.data?.staffMistakes) ?? [];
  const refetch = (): void => {
    refetchQueue({ requestPolicy: "network-only" });
    if (canSeeAll) refetchAll({ requestPolicy: "network-only" });
  };

  return (
    <Screen scroll>
      <H2>{STR.smrReviewTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.smrReviewHelp}</Muted>
      {canSeeAll ? (
        <ChipRow>
          <Chip label={STR.smrTabQueue} selected={tab === "queue"} onPress={() => setTab("queue")} />
          <Chip label={STR.smrTabAll} selected={tab === "all"} onPress={() => setTab("all")} />
        </ChipRow>
      ) : null}
      {q.fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState message={tab === "queue" ? STR.smrReviewEmpty : STR.smrEmpty} />
      ) : (
        rows.map((m) => {
          // Nobody decides their own entry (the server refuses it too).
          const decidable = m.status !== "MOVED" && m.staffUserId !== user?.id;
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
