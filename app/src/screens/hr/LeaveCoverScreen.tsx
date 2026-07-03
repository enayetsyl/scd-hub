/**
 * LeaveCoverScreen — the cover slots of one leave application (prd-hr §3.5, D-#22).
 * Reused two ways via the `manage` route param:
 *   - applicant (manage=false): propose a covering teacher per slot (own-row; the
 *     proposal does NOT grant write access).
 *   - Principal/Office (manage=true): approve a proposed slot → mints the D-#20
 *     proxy grant (write access begins), or reject it back to needs-cover.
 * The server enforces both gates; denials surface in-band.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  STAFF_COVER_SLOTS_QUERY,
  PROPOSE_STAFF_COVER,
  DECIDE_STAFF_COVER_SLOT,
  SUBJECTS_QUERY,
  TEACHERS_QUERY,
} from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Divider,
  Button,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { TeacherSelect } from "../../components/selects";
import { STR, coverSlotStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "LeaveCover">;

function statusTone(s: string): "info" | "ok" | "muted" {
  return s === "approved" ? "ok" : s === "proposed" ? "info" : "muted";
}

export default function LeaveCoverScreen({ route }: Props): React.ReactElement {
  const { leaveApplicationId, manage } = route.params;
  const { confirmAction } = useConfirm();
  const [proposals, setProposals] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [slotsQ, refetch] = useQuery({ query: STAFF_COVER_SLOTS_QUERY, variables: { leaveApplicationId } });
  const [subjectsQ] = useQuery({ query: SUBJECTS_QUERY });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });

  const [, propose] = useMutation(PROPOSE_STAFF_COVER);
  const [, decide] = useMutation(DECIDE_STAFF_COVER_SLOT);

  const slots = slotsQ.data?.staffCoverSlots ?? [];
  const subjectName = new Map((subjectsQ.data?.subjects ?? []).map((s) => [s.id, s.nameBn]));
  const teacherName = new Map((teachersQ.data?.teachers ?? []).map((t) => [t.id, t.name]));

  async function runPropose(slotId: string): Promise<void> {
    const teacherId = proposals[slotId];
    if (!teacherId) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await propose({ slotId, coverTeacherUserId: teacherId });
    setBusy(false);
    if (res.error || !res.data?.proposeStaffCover) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrCoverProposeSaved);
    setProposals((p) => ({ ...p, [slotId]: "" }));
    refetch({ requestPolicy: "network-only" });
  }

  async function runDecide(slotId: string, approve: boolean): Promise<void> {
    if (!approve && !(await confirmAction({ confirmLabel: STR.hrCoverReject }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await decide({ slotId, approve });
    setBusy(false);
    if (res.error || !res.data?.decideStaffCoverSlot) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(approve ? STR.hrCoverApproved : STR.hrCoverRejected);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrCoverTitle}</H2>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {slotsQ.fetching ? (
        <Loader label={STR.loading} />
      ) : slotsQ.error ? (
        <ErrorBanner message={friendlyError(slotsQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : slots.length === 0 ? (
        <EmptyState message={STR.hrCoverEmpty} />
      ) : (
        slots.map((slot) => (
          <Card key={slot.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>
                {slot.subjectId ? subjectName.get(slot.subjectId) ?? STR.hrCoverSubject : STR.hrCoverClass}
              </Body>
              <Badge text={coverSlotStatusLabel(slot.status)} tone={statusTone(slot.status)} />
            </View>
            {slot.proposedCoverTeacherId ? (
              <Row label={STR.hrCoverProposed} value={teacherName.get(slot.proposedCoverTeacherId) ?? "—"} />
            ) : null}
            {slot.proxyGrantId ? <Badge text={STR.hrCoverProxyActive} tone="ok" /> : null}

            {/* Applicant: propose a teacher (until approved). */}
            {!manage && slot.status !== "approved" ? (
              <>
                <Divider />
                <TeacherSelect
                  label={STR.hrCoverPropose}
                  value={proposals[slot.id] ?? ""}
                  onChange={(v) => setProposals((p) => ({ ...p, [slot.id]: v }))}
                />
                <Button
                  title={STR.hrCoverProposeBtn}
                  variant="secondary"
                  onPress={() => runPropose(slot.id)}
                  loading={busy}
                  disabled={busy || !proposals[slot.id]}
                />
              </>
            ) : null}

            {/* Admin: approve / reject a proposed slot. */}
            {manage && slot.status === "proposed" ? (
              <>
                <Divider />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={STR.hrCoverApprove} onPress={() => runDecide(slot.id, true)} disabled={busy} />
                  <Button title={STR.hrCoverReject} variant="danger" onPress={() => runDecide(slot.id, false)} disabled={busy} />
                </View>
              </>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
