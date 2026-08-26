/**
 * WorkClaimBlock (GC-3, D-#551) — the guardian's "বাড়িতে সম্পন্ন হয়েছে" control
 * and the three states a claim can be in afterwards.
 *
 * Used on BOTH guardian record cards (homework and assignment): the two record
 * models are symmetric, so one component serves both and the family sees the
 * same thing either way.
 *
 * The parent is never asked to fill anything in — the only input is an optional
 * note. The claim's job is to START a conversation the teacher finishes, and
 * asking for a form would reduce how often it is used.
 */
import React, { useState } from "react";
import { View, TextInput, Modal, Pressable } from "react-native";
import { useMutation } from "urql";
import { Body, Muted, Badge, Button, Notice, Card } from "./ui";
import { space } from "../theme/tokens";
import { useColors } from "../theme";
import { STR } from "../lib/labels";
import { FILE_CHILD_WORK_CLAIM, type GuardianWorkClaimT } from "../graphql/operations";

const MAX_NOTE = 200;

export interface WorkClaimBlockProps {
  studentId: string;
  tracker: "HOMEWORK" | "ASSIGNMENT";
  recordId: string;
  /** Server-computed (D-#553) — the app never re-implements the eligibility rule. */
  canClaim: boolean;
  claim: GuardianWorkClaimT | null;
  /** Label for the work, shown in the confirmation sheet. */
  subjectLabel: string;
  workId: string;
  onChanged?: () => void;
}

export function WorkClaimBlock({
  studentId,
  tracker,
  recordId,
  canClaim,
  claim,
  subjectLabel,
  workId,
  onChanged,
}: WorkClaimBlockProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, fileClaim] = useMutation(FILE_CHILD_WORK_CLAIM);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fileClaim({ studentId, tracker, recordId, note: note.trim() || null });
    setBusy(false);
    if (res.error) {
      // The server's refusals are Bangla sentences written for the parent —
      // render the reason rather than a generic failure (the D-#536 lesson).
      setError(res.error.graphQLErrors?.[0]?.message ?? res.error.message);
      return;
    }
    setOpen(false);
    setNote("");
    onChanged?.();
  };

  const status = claim?.status;

  return (
    <View style={{ marginTop: space(2), gap: space(2) }}>
      {/* --- the current claim, if any ----------------------------------- */}
      {claim ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: space(3),
            gap: space(1),
            backgroundColor: colors.surfaceAlt,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
            <Badge
              text={claim.statusLabelBn}
              tone={status === "ACCEPTED" ? "ok" : status === "PENDING" ? "warn" : "info"}
            />
            <Muted>{claim.claimedAt.slice(0, 10)}</Muted>
          </View>

          {status === "PENDING" ? (
            <>
              <Muted>{STR.wcPendingLine}</Muted>
              <Muted>{STR.wcPendingHint}</Muted>
            </>
          ) : null}

          {status === "ACCEPTED" ? <Muted>{STR.wcAcceptedLine}</Muted> : null}

          {status === "REJECTED" ? (
            <Muted>
              {STR.wcRejectedPrefix} {claim.rejectReasonLabelBn ?? ""}
              {claim.rejectNote ? ` — ${claim.rejectNote}` : ""}
            </Muted>
          ) : null}
        </View>
      ) : null}

      {/* --- the button ---------------------------------------------------
          `canClaim` comes from the server, so the D-#553 rule lives in exactly
          one place. A rejected claim with a retry left shows the reclaim wording. */}
      {canClaim ? (
        <View style={{ gap: space(1) }}>
          <Button
            title={claim?.canReclaim ? STR.wcReclaim : STR.wcButton}
            onPress={() => setOpen(true)}
            variant={claim?.canReclaim ? "secondary" : "primary"}
          />
          <Muted style={{ textAlign: "center" }}>
            {claim?.canReclaim ? STR.wcReclaimHint : STR.wcButtonHint}
          </Muted>
        </View>
      ) : null}

      {/* --- the confirmation sheet --------------------------------------- */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => (busy ? null : setOpen(false))}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: space(4),
          }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.wcSheetTitle}</Body>
              <Muted>
                {subjectLabel} · {workId}
              </Muted>

              <Body style={{ marginTop: space(2) }}>{STR.wcSheetLine1}</Body>
              <Body>{STR.wcSheetLine2}</Body>

              <Muted style={{ marginTop: space(2) }}>{STR.wcNoteLabel}</Muted>
              <TextInput
                value={note}
                onChangeText={(v) => setNote(v.slice(0, MAX_NOTE))}
                placeholder={STR.wcNotePlaceholder}
                placeholderTextColor={colors.textDisabled}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: space(3),
                  minHeight: 64,
                  color: colors.textPrimary,
                  backgroundColor: colors.surface,
                }}
              />
              <Muted style={{ textAlign: "right" }}>{STR.wcMaxChars}</Muted>

              {error ? (
                <View style={{ marginTop: space(2) }}>
                  <Notice tone="danger" message={error} />
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(3) }}>
                <Button
                  title={STR.wcCancel}
                  variant="secondary"
                  onPress={() => setOpen(false)}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title={STR.wcSubmit}
                  onPress={submit}
                  loading={busy}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
