/**
 * LeaveCoverScreen — the cover slots of one leave application (prd-hr §3.5, D-#22;
 * per-meeting redesign PXG-1/PXG-2, D-#268). Each slot is now ONE class meeting
 * (date × period), not a whole-leave subject grant. Reused two ways via the
 * `manage` route param:
 *   - applicant (manage=false): propose a covering teacher per slot, free-first via
 *     `AvailableTeacherSelect` (own-row; the proposal does NOT grant write access).
 *   - Principal/Office (manage=true): approve a proposed slot → mints a one-day
 *     D-#20 proxy grant (write access begins), reject it back to needs-cover, or
 *     "অন্য কাউকে দিন" (assign someone else) to override the proposal — also how a
 *     no-proposal needs-cover slot gets direct-assigned.
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
  SUBJECT_GROUPS_QUERY,
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
import { AvailableTeacherSelect } from "../../components/selects";
import { STR, coverSlotStatusLabel, dateHeaderLabel, bnNum } from "../../lib/labels";
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
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [showOverride, setShowOverride] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [slotsQ, refetch] = useQuery({ query: STAFF_COVER_SLOTS_QUERY, variables: { leaveApplicationId } });
  const [subjectsQ] = useQuery({ query: SUBJECTS_QUERY });
  const [groupsQ] = useQuery({ query: SUBJECT_GROUPS_QUERY, variables: {} });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });

  const [, propose] = useMutation(PROPOSE_STAFF_COVER);
  const [, decide] = useMutation(DECIDE_STAFF_COVER_SLOT);

  const slots = slotsQ.data?.staffCoverSlots ?? [];
  const subjectName = new Map((subjectsQ.data?.subjects ?? []).map((s) => [s.id, s.nameBn]));
  const groupName = new Map((groupsQ.data?.subjectGroups ?? []).map((g) => [g.id, g.nameBn]));
  const teacherName = new Map((teachersQ.data?.teachers ?? []).map((t) => [t.id, t.name]));

  /** The human name of what this slot covers: the Quran/Arabic group, else the
   *  general subject, else a generic class fallback. */
  function slotLabel(slot: (typeof slots)[number]): string {
    if (slot.subjectGroupId) return groupName.get(slot.subjectGroupId) ?? STR.hrCoverClass;
    if (slot.subjectId) return subjectName.get(slot.subjectId) ?? STR.hrCoverSubject;
    return STR.hrCoverClass;
  }

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

  async function runDecide(slotId: string, approve: boolean, overrideCoverTeacherUserId?: string): Promise<void> {
    if (!approve && !(await confirmAction({ confirmLabel: STR.hrCoverReject }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await decide({ slotId, approve, overrideCoverTeacherUserId: overrideCoverTeacherUserId ?? undefined });
    setBusy(false);
    if (res.error || !res.data?.decideStaffCoverSlot) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(approve ? STR.hrCoverApproved : STR.hrCoverRejected);
    setOverrides((o) => {
      const next = { ...o };
      delete next[slotId];
      return next;
    });
    setShowOverride((s) => {
      const next = { ...s };
      delete next[slotId];
      return next;
    });
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
              <Body style={{ fontWeight: "700", flex: 1 }}>{slotLabel(slot)}</Body>
              <Badge text={coverSlotStatusLabel(slot.status)} tone={statusTone(slot.status)} />
            </View>
            <Muted style={{ marginTop: 2 }}>
              {dateHeaderLabel(slot.dateKey)} · {STR.rtPeriodN} {bnNum(slot.periodNumber)}
            </Muted>
            {slot.proposedCoverTeacherId ? (
              <Row label={STR.hrCoverProposed} value={teacherName.get(slot.proposedCoverTeacherId) ?? "—"} />
            ) : null}
            {slot.finalCoverTeacherUserId && slot.finalCoverTeacherUserId !== slot.proposedCoverTeacherId ? (
              <Row label={STR.hrCoverAssignOther} value={teacherName.get(slot.finalCoverTeacherUserId) ?? "—"} />
            ) : null}
            {slot.proxyGrantId ? <Badge text={STR.hrCoverProxyActive} tone="ok" /> : null}

            {/* Applicant: propose a teacher (until approved). Free-first per this slot's own period. */}
            {!manage && slot.status !== "approved" ? (
              <>
                <Divider />
                <AvailableTeacherSelect
                  label={STR.hrCoverPropose}
                  date={slot.dateKey}
                  periodNumber={slot.periodNumber}
                  absentTeacherUserId={slot.absentTeacherUserId}
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

            {/* Admin: approve / reject a proposed slot, or override with someone else. */}
            {manage && slot.status === "proposed" ? (
              <>
                <Divider />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={STR.hrCoverApprove} onPress={() => runDecide(slot.id, true)} disabled={busy} />
                  <Button title={STR.hrCoverReject} variant="danger" onPress={() => runDecide(slot.id, false)} disabled={busy} />
                  <Button
                    title={STR.hrCoverAssignOther}
                    variant="secondary"
                    onPress={() => setShowOverride((s) => ({ ...s, [slot.id]: !s[slot.id] }))}
                    disabled={busy}
                  />
                </View>
                {showOverride[slot.id] ? (
                  <View style={{ marginTop: space(2) }}>
                    <AvailableTeacherSelect
                      date={slot.dateKey}
                      periodNumber={slot.periodNumber}
                      absentTeacherUserId={slot.absentTeacherUserId}
                      value={overrides[slot.id] ?? ""}
                      onChange={(v) => setOverrides((o) => ({ ...o, [slot.id]: v }))}
                    />
                    <Button
                      title={STR.hrCoverApprove}
                      onPress={() => runDecide(slot.id, true, overrides[slot.id])}
                      loading={busy}
                      disabled={busy || !overrides[slot.id]}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            {/* Admin: direct-assign a needs_cover slot — no proposal to wait for. */}
            {manage && slot.status === "needs_cover" ? (
              <>
                <Divider />
                <AvailableTeacherSelect
                  label={STR.hrCoverAssignOther}
                  date={slot.dateKey}
                  periodNumber={slot.periodNumber}
                  absentTeacherUserId={slot.absentTeacherUserId}
                  value={overrides[slot.id] ?? ""}
                  onChange={(v) => setOverrides((o) => ({ ...o, [slot.id]: v }))}
                />
                <Button
                  title={STR.hrCoverApprove}
                  onPress={() => runDecide(slot.id, true, overrides[slot.id])}
                  loading={busy}
                  disabled={busy || !overrides[slot.id]}
                />
              </>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
