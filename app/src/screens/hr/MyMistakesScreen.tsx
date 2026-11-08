/**
 * MyMistakesScreen — আমার ভুল ও ব্যাখ্যা (D-#936/#937, docs/prd-staff-mistakes.md): the
 * caller's own caught mistakes, newest first, each with its status. An entry still waiting
 * for a reason, or under review, can be explained (or re-explained) from here.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { EXPLAIN_STAFF_MISTAKE, MY_STAFF_MISTAKES, type StaffMistakeT } from "../../graphql/staffMistakes";
import { Screen, H2, Body, Card, Muted, Button, Loader, EmptyState, ErrorBanner, Badge } from "../../components/ui";
import { staffMistakeKindTitle } from "../../lib/staffMistakeLabels";
import { StaffMistakeCard } from "../../components/StaffMistakeCard";
import { useMistakeReason } from "../../state/MistakeReasonContext";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function MyMistakesScreen(): React.ReactElement {
  const [q, refetch] = useQuery({ query: MY_STAFF_MISTAKES, requestPolicy: "cache-and-network" });
  const [, explain] = useMutation(EXPLAIN_STAFF_MISTAKE);
  const { askMistakeReason } = useMistakeReason();
  const toast = useToast();
  const rows = q.data?.myStaffMistakes ?? [];

  const counted = rows.filter((r) => r.status === "COUNTED").length;
  const open = rows.filter((r) => r.status === "EXPLANATION_DUE" || r.status === "PENDING_REVIEW").length;
  const excused = rows.filter((r) => r.status === "EXCUSED").length;

  async function onExplain(m: StaffMistakeT): Promise<void> {
    const pick = await askMistakeReason({
      kind: m.kind,
      message: staffMistakeKindTitle(m.kind),
      initial: m.reasonCode ? { code: m.reasonCode, text: m.reasonText ?? "" } : null,
    });
    if (!pick) return;
    const res = await explain({ id: m.id, reasonCode: pick.code, reasonText: pick.text });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(STR.smrExplained, "ok");
  }

  return (
    <Screen scroll>
      <H2>{STR.smrMyTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.smrMyHelp}</Muted>
      {rows.length > 0 ? (
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", marginBottom: space(3) }}>
          <Badge text={`${STR.smrStCounted} · ${bnNum(counted)}`} tone="danger" />
          <Badge text={`${STR.smrStPending} · ${bnNum(open)}`} tone="warn" />
          <Badge text={`${STR.smrStExcused} · ${bnNum(excused)}`} tone="info" />
        </View>
      ) : null}
      {q.fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : rows.length === 0 ? (
        <EmptyState message={STR.smrEmpty} />
      ) : (
        rows.map((m) => (
          <StaffMistakeCard key={m.id} m={m}>
            {m.status === "EXPLANATION_DUE" || m.status === "PENDING_REVIEW" ? (
              <Button
                title={m.reasonCode ? STR.smrChangeExplain : STR.smrExplain}
                variant={m.reasonCode ? "secondary" : "primary"}
                onPress={() => void onExplain(m)}
                style={{ marginTop: space(3) }}
              />
            ) : null}
          </StaffMistakeCard>
        ))
      )}
    </Screen>
  );
}
