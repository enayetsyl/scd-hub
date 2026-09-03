/**
 * WorkClaimQueueScreen (GC-5, D-#554) — "অভিভাবকের জানানো — অনিষ্পন্ন".
 *
 * Every unresolved guardian claim, visible to Office and Principal from the
 * instant it is filed — being TOLD is the laddered thing (11:30 / 13:00), being
 * able to SEE is not.
 *
 * Rows sort by CHECKPOINT rather than by age, because the same-day ladder made
 * "how many days old" the wrong question. And the only action here is the nudge:
 * OFFICE holds no tracker permission, so it can remind the teacher and nothing
 * else. The footer says so out loud, so nobody hunts for a missing button.
 */
import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useMutation, useQuery } from "urql";
import { Screen, H1, Body, Muted, Card, Badge, Button, EmptyState, Notice, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { space } from "../../theme/tokens";
import { STR, bnNum } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import {
  WORK_CLAIM_QUEUE_QUERY,
  NUDGE_WORK_CLAIM,
  type WorkClaimRowT,
} from "../../graphql/operations";

/** The checkpoint's severity — the same three-step reading the guardian's own
 *  status badge uses, so staff and family are looking at one scale. */
function toneFor(checkpoint: string): "danger" | "warn" | "info" | "muted" {
  if (checkpoint === "PRINCIPAL_TOLD") return "danger";
  if (checkpoint === "OFFICE_TOLD") return "warn";
  if (checkpoint === "WAITING") return "info";
  return "muted";
}

export default function WorkClaimQueueScreen(): React.ReactElement {
  const [q, refetch] = useQuery({ query: WORK_CLAIM_QUEUE_QUERY, variables: {} });
  const [, nudge] = useMutation(NUDGE_WORK_CLAIM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );

  const rows: WorkClaimRowT[] = q.data?.workClaimQueue ?? [];

  const onNudge = async (row: WorkClaimRowT) => {
    setBusyId(row.claimId);
    setError(null);
    const res = await nudge({ claimId: row.claimId });
    setBusyId(null);
    if (res.error) {
      // Once-per-day is a refusal the operator is meant to read, not a failure.
      setError(res.error.graphQLErrors?.[0]?.message ?? res.error.message);
      return;
    }
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <H1>{STR.wcQueueTitle}</H1>

        {error ? (
          <View style={{ marginTop: space(2) }}>
            <Notice tone="danger" message={error} />
          </View>
        ) : null}

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
          {rows.length === 0 ? (
            <EmptyState message={STR.wcQueueEmpty} />
          ) : (
            <Card>
              {rows.map((r, i) => (
                <View key={r.claimId}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ marginTop: space(2), gap: space(1) }}>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: space(2),
                      }}
                    >
                      <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                        {r.studentNameBn} · {r.sectionNameBn}
                      </Body>
                      <Badge text={r.checkpointLabelBn} tone={toneFor(r.checkpoint)} />
                    </View>
                    {/* D-#635: WHICH DAY's homework this is. Without it the row named
                        the work only by its id, and staff had to open the tracker to
                        find out whether the claim was about today or last week. */}
                    <Muted>
                      {r.subject} · {r.workId}
                      {r.dueDateKey ? ` · ${bnNum(r.dueDateKey)}` : ""} · {r.teacherName}
                    </Muted>
                    {r.note ? <Body>{r.note}</Body> : null}
                    {r.nudgedToday ? (
                      <Badge text={STR.wcNudgedToday} tone="muted" />
                    ) : (
                      <Button
                        title={STR.wcNudge}
                        variant="secondary"
                        loading={busyId === r.claimId}
                        disabled={!!busyId}
                        onPress={() => void onNudge(r)}
                      />
                    )}
                  </View>
                </View>
              ))}

              <View style={{ marginTop: space(3) }}>
                <Divider />
                <Muted style={{ marginTop: space(2) }}>{STR.wcOfficeFooter}</Muted>
              </View>
            </Card>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
