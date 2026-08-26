/**
 * ChildAssignmentsScreen (AS-T5 guardian rider, AJ-8) — the linked child's
 * assignments: pending / overdue (days late) / returned with marks + result +
 * feedback. Link-gated server-side (guardian:read_child +
 * assertGuardianOfStudent); shipped now because the guardian portal is BUILT
 * (the PRD pre-flight note's GP-rider posture).
 *
 * D-#476 — this list used to load the child's ENTIRE assignment history on every
 * open, which only grows as the year fills. It now asks for a page at a time,
 * newest first, and "show older" widens it.
 *
 * Widening the LIMIT rather than accumulating offset pages is deliberate: the
 * whole history is tens of rows, so a re-fetch is cheap, and it cannot develop
 * the duplicate/stale-page bugs a client-side merge grows the moment the parent
 * switches child mid-scroll. There are no date pickers here because assignments
 * are ordered by when they were set, not browsed by calendar date — the
 * homework and class-note screens are the date-addressed ones.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_ASSIGNMENTS } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Button, Loader, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { LoadOlder } from "../../components/LoadOlder";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { WorkClaimBlock } from "../../components/WorkClaimBlock";
import { useRecordView } from "../../lib/useRecordView";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, lifecycleStateLabel } from "../../lib/labels";
import { openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { space } from "../../theme/tokens";

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** Rows per page. Comfortably more than a screenful, so the first page answers
 *  "what is open right now" without a tap. */
const PAGE_SIZE = 20;

export default function ChildAssignmentsScreen(): React.ReactElement {
  const { selected } = useGuardianChild();
  useRecordView("ASSIGNMENTS", selected?.studentId);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const studentId = selected?.studentId ?? "";
  // A different child starts from page one — otherwise the new child inherits
  // however far the previous one had been paged back.
  useEffect(() => setLimit(PAGE_SIZE), [studentId]);
  const [q, refetchQ] = useQuery({
    query: CHILD_ASSIGNMENTS,
    variables: { studentId, limit, offset: 0 },
    pause: !selected,
  });
  const list = q.data?.childAssignments ?? [];
  // A short page is the end of the history: the server had nothing more to give.
  const exhausted = !q.fetching && list.length < limit;
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
              {/* D-#478: WHAT the assignment is. Above the id, because the id is not
                  what the family came to read. Null on pre-D-#478 items — the card
                  then renders exactly as it did before. */}
              {a.description ? <Body style={{ marginTop: space(1) }}>{a.description}</Body> : null}
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

              {/* GC-3 — the same control the homework card carries. One component,
                  because the two record models are symmetric and the family should
                  not meet two different affordances for the same act. */}
              <WorkClaimBlock
                studentId={studentId}
                tracker="ASSIGNMENT"
                recordId={a.recordId}
                canClaim={a.canClaim}
                claim={a.claim}
                subjectLabel={hwSubjectLabel(a.subject)}
                workId={a.asId}
                onChanged={() => refetchQ({ requestPolicy: "network-only" })}
              />
            </Card>
          ))
        )}
        {list.length > 0 ? (
          <LoadOlder
            onPress={() => setLimit((n) => n + PAGE_SIZE)}
            loading={q.fetching}
            exhausted={exhausted}
          />
        ) : null}
        </QueryGate>
        )}
        {fileError ? <Notice message={fileError} tone="danger" /> : null}
      </ScrollView>
    </Screen>
  );
}
