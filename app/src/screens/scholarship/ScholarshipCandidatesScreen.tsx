/**
 * ScholarshipCandidatesScreen (SC-9, D-#697) — who is sitting the scholarship exam.
 *
 * The primary scholarship examination is sat by SOME of class five, not all of it, and
 * until now the module assumed the whole section. A child the school never entered sat
 * in the heat-map as a column of em dashes, inside the "of N" every rank was counted
 * out of, and on every mark grid as a row to remember to skip.
 *
 * This is the one screen that shows the WHOLE roster — it is where the distinction is
 * made, so it is the one read that must not apply it.
 *
 * Removing someone never deletes a mark (the flag is a scope, not a purge), which is why
 * the row prints how many papers she already has: it makes the consequence visible
 * BEFORE the tap, and it makes putting her back a safe thing to do.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  SCHOLARSHIP_CANDIDATES_QUERY,
  SET_SCHOLARSHIP_CANDIDATE,
} from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  Badge,
  Chip,
  ChipRow,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipCandidates">;

interface Candidate {
  studentId: string;
  nameBn: string;
  rollNumber: string | null;
  sitting: boolean;
  scoredPapers: number;
}

export default function ScholarshipCandidatesScreen({ route }: Props): React.ReactElement {
  const { sectionId } = route.params;
  const toast = useToast();
  const { can } = useAuth();
  const [busy, setBusy] = React.useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: SCHOLARSHIP_CANDIDATES_QUERY,
    variables: { sectionId },
  });
  const [, setSitting] = useMutation(SET_SCHOLARSHIP_CANDIDATE);

  const rows = (data?.scholarshipCandidates ?? []) as Candidate[];
  const sitting = rows.filter((r) => r.sitting).length;
  const editable = can("scholarship:manage");

  async function toggle(row: Candidate): Promise<void> {
    // `Chip` has no disabled state, so the guard lives here: a double tap would
    // otherwise fire two mutations and land on whichever answered last.
    if (busy) return;
    setBusy(row.studentId);
    const res = await setSitting({ studentId: row.studentId, sitting: !row.sitting });
    setBusy(null);
    if (res.error) {
      toast.show(friendlyError(res.error));
      return;
    }
    toast.show(row.sitting ? STR.scCandidateRemoved : STR.scCandidateAdded);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.scCandidates}</Body>
        <Muted>{STR.scCandidatesNote}</Muted>
        {rows.length > 0 ? (
          <Muted>
            {bnNum(sitting)} / {bnNum(rows.length)} {STR.scCandidatesSitting}
          </Muted>
        ) : null}
      </Card>

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching ? <Loader /> : null}
      {!fetching && rows.length === 0 ? <EmptyState message={STR.scNoStudents} /> : null}

      {rows.map((r) => (
        <Card key={r.studentId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(3) }}>
            <View style={{ flexShrink: 1 }}>
              <Body style={{ fontWeight: "700" }}>{r.nameBn}</Body>
              <Muted>
                {r.rollNumber ? `${STR.scRollNo} ${r.rollNumber} · ` : ""}
                {r.scoredPapers > 0
                  ? `${bnNum(r.scoredPapers)} ${STR.scCandidateScored}`
                  : STR.scCandidateNoMarks}
              </Muted>
            </View>
            {editable ? (
              <ChipRow>
                <Chip
                  label={r.sitting ? STR.scCandidateSitting : STR.scCandidateNotSitting}
                  selected={r.sitting}
                  onPress={() => void toggle(r)}
                />
              </ChipRow>
            ) : (
              <Badge
                text={r.sitting ? STR.scCandidateSitting : STR.scCandidateNotSitting}
                tone={r.sitting ? "ok" : "muted"}
              />
            )}
          </View>
          {/* Said on the row rather than in a confirm dialog: the fact that matters is
              that the marks SURVIVE, and a dialog that appears after the tap is the
              wrong moment to learn it. */}
          {!r.sitting && r.scoredPapers > 0 ? <Muted>{STR.scCandidateKeptMarks}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}
