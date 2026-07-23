/**
 * AssignmentEditSheet (D-#352) — edit a delivered assignment.
 *
 * Tier rule mirrors the server (and the D-#336 homework twin):
 *   DRAFT  → time (minutes) + total marks editable
 *   ISSUED → total marks only; the TIME is frozen (the week's load was already
 *            confirmed against the ceiling) and the delivery/due dates never move.
 * Same Modal scaffold as FilterSheet/HwPendingSheet.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "urql";
import { UPDATE_ASSIGNMENT_ITEM } from "../graphql/operations";
import { Body, Button, Field, H2, Muted, Notice } from "./ui";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { makeStyles, radius, space } from "../theme";

export interface AssignmentEditTarget {
  itemId: string;
  asId: string;
  label: string;
  issued: boolean;
  estMinutes: number | null;
  totalMarks: number | null;
}

export function AssignmentEditSheet({
  visible,
  target,
  onClose,
  onSaved,
}: {
  visible: boolean;
  target: AssignmentEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [, update] = useMutation(UPDATE_ASSIGNMENT_ITEM);

  const [minutes, setMinutes] = useState("");
  const [marks, setMarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && target) {
      setMinutes(target.estMinutes == null ? "" : String(target.estMinutes));
      setMarks(target.totalMarks == null ? "" : String(target.totalMarks));
      setErr(null);
    }
  }, [visible, target]);

  const save = async (): Promise<void> => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    const vars: { itemId: string; estMinutes?: number | null; totalMarks?: number | null } = {
      itemId: target.itemId,
    };
    // Only send what changed — an untouched field must stay untouched server-side.
    if (!target.issued && minutes.trim() !== "" && Number(minutes) !== target.estMinutes) {
      vars.estMinutes = Number(minutes);
    }
    if (marks.trim() !== "" && Number(marks) !== target.totalMarks) {
      vars.totalMarks = Number(marks);
    }
    const res = await update(vars);
    setBusy(false);
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={STR.close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />
          <H2>{STR.asEditTitle}</H2>
          {target ? (
            <Muted>
              {target.label} · {target.asId}
            </Muted>
          ) : null}

          {target?.issued ? <Notice message={STR.asMinutesFrozen} tone="info" /> : null}
          {err ? <Notice message={err} tone="danger" /> : null}

          <Field
            label={STR.asEditMinutes}
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="numeric"
            editable={!target?.issued}
            helper={target?.issued ? STR.asMinutesFrozen : undefined}
          />
          <Field label={STR.asEditMarks} value={marks} onChangeText={setMarks} keyboardType="numeric" />

          <View style={styles.footer}>
            <View style={styles.cell}>
              <Button title={STR.close} variant="ghost" onPress={onClose} />
            </View>
            <View style={styles.cell}>
              <Button title={busy ? "…" : STR.save} onPress={save} disabled={busy} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(2),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: "center" },
  footer: { flexDirection: "row", gap: space(2), marginTop: space(2) },
  cell: { flex: 1 },
}));
