/**
 * ChildFeesScreen (GP rider) — a read-only guardian view of the linked child's
 * current outstanding fee due.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_FEE_DUE_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Loader, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { STR, bnNum, getActiveLang } from "../../lib/labels";
import { space } from "../../theme/tokens";

export default function ChildFeesScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  useRecordView("FEES", selected?.studentId);
  const lang = getActiveLang();

  const [q, refetchQ] = useQuery({
    query: CHILD_FEE_DUE_QUERY,
    variables: { studentId: selected?.studentId ?? "" },
    pause: !selected,
  });

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const due = q.data?.childFeeDue;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpFees}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.open}</Muted>
        </Card>

        <QueryGate
          result={q}
          onRetry={() => refetchQ({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {due ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>{lang === "en" ? selected.name : selected.nameBn}</Body>
              <Muted style={{ marginTop: space(1) }}>{STR.finGuardianDue}</Muted>
              <Body style={{ fontWeight: "700", marginTop: space(1) }}>
                {bnNum(due.guardianDue)}
              </Body>
            </Card>
            <Notice
              message={`${STR.finFeesDue}: ${bnNum(due.guardianDue)}`}
              tone={due.guardianDue > 0 ? "warn" : "ok"}
            />
          </>
        ) : (
          <EmptyState message={STR.empty} />
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
