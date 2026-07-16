/**
 * ChildAssignmentsScreen (AS-T5 guardian rider, AJ-8) — the linked child's
 * assignments: pending / overdue (days late) / returned with marks + result +
 * feedback. Link-gated server-side (guardian:read_child +
 * assertGuardianOfStudent); shipped now because the guardian portal is BUILT
 * (the PRD pre-flight note's GP-rider posture).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_ASSIGNMENTS } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Button, Loader, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, lifecycleStateLabel } from "../../lib/labels";
import { openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { space } from "../../theme/tokens";

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

export default function ChildAssignmentsScreen(): React.ReactElement {
  const { selected } = useGuardianChild();
  const [q, refetchQ] = useQuery({
    query: CHILD_ASSIGNMENTS,
    variables: { studentId: selected?.studentId ?? "" },
    pause: !selected,
  });
  const list = q.data?.childAssignments ?? [];
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function onOpenFile(fileId: string): Promise<void> {
    setFileError(null);
    setOpeningId(fileId);
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setFileError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChildSwitcher />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!selected ? (
          <Loader label={STR.loading} />
        ) : (
        <QueryGate
          result={q}
          onRetry={() => refetchQ({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {list.length === 0 ? (
          <EmptyState message={STR.asNoItems} />
        ) : (
          list.map((a) => (
            <Card key={a.recordId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(a.subject)}</Body>
                <Badge
                  text={
                    a.daysLate > 0
                      ? `${STR.asGpOverdue} — ${bnNum(a.daysLate)} ${STR.asGpDaysLate}`
                      : a.state === "RETURNED"
                        ? STR.asGpDone
                        : a.pending
                          ? STR.asGpPending
                          : lifecycleStateLabel(a.state)
                  }
                  tone={a.daysLate > 0 ? "danger" : a.state === "RETURNED" ? "ok" : "brand"}
                />
              </View>
              <Muted style={{ marginTop: 2 }}>
                {a.asId} · {STR.asWeek} {bnNum(a.weekNumber)}
                {a.isResubmission ? ` · ${STR.hwResubmissions}` : ""}
              </Muted>
              <Muted>
                {STR.asDeliverBy} {day(a.deliveryDate)} · {STR.asDueBy} {day(a.dueDate)}
              </Muted>
              {a.result ? (
                <Muted>
                  {hwResultLabel(a.result)}
                  {a.marks !== null && a.totalMarks !== null ? ` · ${bnNum(a.marks)}/${bnNum(a.totalMarks)}` : ""}
                </Muted>
              ) : null}
              {a.feedback ? <Body style={{ marginTop: 4 }}>{a.feedback}</Body> : null}
              {FILE_VIEW_SUPPORTED && a.attachmentIds.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  {a.attachmentIds.map((fid, i) => (
                    <Button
                      key={fid}
                      title={`📎 ${STR.cnAttachments} ${bnNum(i + 1)}`}
                      variant="secondary"
                      loading={openingId === fid}
                      disabled={!!openingId}
                      onPress={() => void onOpenFile(fid)}
                      style={{ flexGrow: 1 }}
                    />
                  ))}
                </View>
              ) : null}
            </Card>
          ))
        )}
        </QueryGate>
        )}
        {fileError ? <Notice message={fileError} tone="danger" /> : null}
      </ScrollView>
    </Screen>
  );
}
