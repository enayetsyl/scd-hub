/**
 * WorkClaimTeacherCard (GC-4, D-#552/#554) — "অভিভাবকের জানানো" on Today.
 *
 * The card makes the notification visible, but the roster pass is where the work
 * actually gets done: marking the student submitted there closes the claim with
 * no second tap. So the only action offered HERE is the one the roster pass
 * cannot express — rejecting with a reason.
 *
 * The amber "অফিসকে জানানো হয়েছে" chip is the teacher's one signal that the
 * ladder has moved past them. It is information, not a reprimand, and it appears
 * before the Principal is involved — which is the point.
 */
import React, { useState } from "react";
import { View, Modal, Pressable, TextInput } from "react-native";
import { useMutation } from "urql";
import { WORK_CLAIM_REJECT_REASONS, WORK_CLAIM_REJECT_REASON_LABELS_BN } from "@scd/shared";
import type { WorkClaimRejectReason } from "@scd/shared";
import { Body, Muted, Card, Badge, Button, Notice, Divider } from "./ui";
import { space } from "../theme/tokens";
import { useColors } from "../theme";
import { STR } from "../lib/labels";
import { REJECT_WORK_CLAIM, type WorkClaimRowT } from "../graphql/operations";

export function WorkClaimTeacherCard({
  rows,
  onChanged,
}: {
  rows: WorkClaimRowT[];
  onChanged: () => void;
}): React.ReactElement | null {
  const colors = useColors();
  const [target, setTarget] = useState<WorkClaimRowT | null>(null);
  const [reason, setReason] = useState<WorkClaimRejectReason>("NOT_BROUGHT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, reject] = useMutation(REJECT_WORK_CLAIM);

  if (rows.length === 0) return null;

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await reject({ claimId: target.claimId, reason, note: note.trim() || null });
    setBusy(false);
    if (res.error) {
      setError(res.error.graphQLErrors?.[0]?.message ?? res.error.message);
      return;
    }
    setTarget(null);
    setNote("");
    setReason("NOT_BROUGHT");
    onChanged();
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{STR.wcTeacherCardTitle}</Body>
        <Badge text={String(rows.length)} tone="warn" />
      </View>

      {rows.map((r, i) => (
        <View key={r.claimId}>
          {i > 0 ? <Divider /> : null}
          <View style={{ marginTop: space(2), gap: space(1) }}>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), alignItems: "center" }}
            >
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                {r.studentNameBn} · {r.sectionNameBn}
              </Body>
              {r.checkpoint === "OFFICE_TOLD" || r.checkpoint === "PRINCIPAL_TOLD" ? (
                <Badge
                  text={r.checkpoint === "PRINCIPAL_TOLD" ? STR.wcPrincipalTold : STR.wcOfficeTold}
                  tone={r.checkpoint === "PRINCIPAL_TOLD" ? "danger" : "warn"}
                />
              ) : null}
            </View>
            <Muted>
              “{STR.wcButton}” · {r.claimedAt.slice(0, 10)} · {r.checkpointLabelBn}
            </Muted>
            <Muted>{r.workId}</Muted>
            {r.note ? <Body>{r.note}</Body> : null}
            <Muted>{STR.wcTeacherHint}</Muted>
            <Button title={STR.wcReject} variant="secondary" onPress={() => setTarget(r)} />
          </View>
        </View>
      ))}

      {/* --- the reject sheet ------------------------------------------- */}
      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <Pressable
          onPress={() => (busy ? null : setTarget(null))}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: space(4) }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.wcRejectTitle}</Body>
              <Muted>
                {target?.studentNameBn} · {target?.workId}
              </Muted>

              <View style={{ marginTop: space(2) }}>
                {WORK_CLAIM_REJECT_REASONS.map((code) => (
                  <Pressable
                    key={code}
                    onPress={() => setReason(code)}
                    style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 1.5,
                        borderColor: reason === code ? colors.primary : colors.textDisabled,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {reason === code ? (
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />
                      ) : null}
                    </View>
                    <Body>{WORK_CLAIM_REJECT_REASON_LABELS_BN[code]}</Body>
                  </Pressable>
                ))}
              </View>

              {reason === "OTHER" ? (
                <TextInput
                  value={note}
                  onChangeText={(v) => setNote(v.slice(0, 200))}
                  placeholder={STR.wcRejectNotePlaceholder}
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    padding: space(3),
                    minHeight: 56,
                    color: colors.textPrimary,
                    backgroundColor: colors.surface,
                  }}
                />
              ) : null}

              <Muted style={{ marginTop: space(2) }}>{STR.wcRejectSeenByGuardian}</Muted>

              {error ? (
                <View style={{ marginTop: space(2) }}>
                  <Notice tone="danger" message={error} />
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(3) }}>
                <Button
                  title={STR.wcCancel}
                  variant="secondary"
                  onPress={() => setTarget(null)}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button title={STR.wcRejectConfirm} onPress={submit} loading={busy} disabled={busy} style={{ flex: 1 }} />
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}
