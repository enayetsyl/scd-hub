/**
 * CtScriptReminderSheet (CT-RC, owner 2026-11-10) — the pop-up a teacher must
 * acknowledge when submitting class-test results: the scripts go to the Office first,
 * not to the students. The submit runs only from "বুঝেছি, জমা দিন"; the tap is sent
 * as `scriptReminderAck` and lands in the audit log. Modal, like ConfirmSheet, so it
 * renders the same on web and native.
 */
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export function CtScriptReminderSheet({
  visible,
  busy,
  onBack,
  onConfirm,
}: {
  visible: boolean;
  busy?: boolean;
  onBack: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const steps = [STR.ctrcPopupStep1, STR.ctrcPopupStep2, STR.ctrcPopupStep3, STR.ctrcPopupStep4];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onBack}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={onBack} accessibilityLabel={STR.ctrcPopupBack} />
        <View style={[styles.sheet, { marginBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {STR.ctrcPopupTitle}
          </Text>
          {steps.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.num}>
                <Text style={styles.numText}>{bnNum(i + 1)}</Text>
              </View>
              <Text style={[styles.stepText, i === 1 && styles.stepStrong]}>{s}</Text>
            </View>
          ))}
          <Text style={styles.foot}>{STR.ctrcPopupFoot}</Text>
          <Button title={STR.ctrcPopupOk} onPress={onConfirm} loading={busy} disabled={busy} />
          <Button title={STR.ctrcPopupBack} variant="ghost" onPress={onBack} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "center", padding: space(4) },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(6),
    gap: space(3),
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  title: { ...typeScale.pageTitle, color: colors.textPrimary },
  step: { flexDirection: "row", gap: space(3), alignItems: "flex-start" },
  num: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  numText: { ...typeScale.chip, color: colors.textPrimary },
  stepText: { ...typeScale.body, color: colors.textPrimary, flex: 1 },
  stepStrong: { ...typeScale.bodyStrong },
  foot: { ...typeScale.secondary, color: colors.textSecondary },
}));
