/**
 * MarkCorrectionsScreen — the staff file's "নম্বর জমায় ভুল" list (D-#893,
 * docs/prd-mark-submission-guard.md §4): every same-day correction of a "not submitted"
 * mark, newest first. Lighter than the conduct ladder — a record, not a warning step.
 *
 *   no params              the caller's own notes (mark_submission:view_own, SELF)
 *   { staffProfileId }     one staff member's file (view_notes unless it is the caller)
 *   { all: true }          the whole school (view_notes) — where the correction notice lands
 */
import React from "react";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MARK_CORRECTION_NOTES } from "../../graphql/markSubmission";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, fullDateLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "MarkCorrections">;

/** HH:mm in Asia/Dhaka (Bangla digits via bnNum). */
function dhakaClock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 6 * 3600 * 1000);
  return bnNum(`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`);
}

export default function MarkCorrectionsScreen({ route }: Props): React.ReactElement {
  const params = route.params ?? {};
  const showName = !!params.all;
  const [q, refetch] = useQuery({
    query: MARK_CORRECTION_NOTES,
    variables: { staffProfileId: params.staffProfileId ?? null, all: params.all ?? null },
    requestPolicy: "cache-and-network",
  });
  const notes = q.data?.markCorrectionNotes ?? [];

  return (
    <Screen scroll>
      <H2>{params.name ? `${STR.msgNotesTitle} — ${params.name}` : STR.msgNotesTitle}</H2>
      <Muted style={{ marginBottom: space(3) }}>{STR.msgNotesHelp}</Muted>
      {q.fetching && notes.length === 0 ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : notes.length === 0 ? (
        <EmptyState message={STR.msgNotesEmpty} />
      ) : (
        notes.map((n) => (
          <Card key={n.id}>
            <Body style={{ fontWeight: "700" }}>
              {fullDateLabel(n.dateKey)}
              {showName ? ` · ${n.staffName}` : ""}
            </Body>
            <Muted>
              {n.sectionLabel} · {hwSubjectLabel(n.subject)} {n.tracker === "HOMEWORK" ? STR.msgHomework : STR.msgAssignment} ({n.itemCode})
            </Muted>
            {n.students.map((s) => (
              <Body key={s.studentId} style={{ marginTop: space(1) }}>
                • {s.studentName} — {s.via === "UNDO" ? STR.msgViaUndo : STR.msgViaFlip} ({dhakaClock(s.chasedAt)} → {dhakaClock(s.correctedAt)})
                {s.correctedByName && s.correctedByName !== n.staffName ? ` · ${STR.msgCorrectedBy}: ${s.correctedByName}` : ""}
              </Body>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}
