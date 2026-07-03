/**
 * ConfirmSheet (UX-1, house rule R-Confirm — docs/prd-ux-improvements.md §3/§4.1):
 * the Modal-based bottom sheet behind `useConfirm()`. A `Modal` (not `Alert.alert`,
 * which is inconsistent on web) renders identically on web + native. Cancel is the
 * backdrop tap, the Android back button, or the secondary button; confirm is the
 * danger variant when tone="danger". 48dp targets via the shared Button.
 */
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./ui";
import { STR } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export type ConfirmTone = "danger" | "primary";

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  tone = "danger",
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  tone?: ConfirmTone;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={STR.cancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <Text style={styles.title}>{title ?? STR.confirmTitle}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttons}>
            <Button title={STR.cancel} variant="secondary" onPress={onCancel} style={styles.button} />
            <Button
              title={confirmLabel ?? STR.confirmTitle}
              variant={tone === "primary" ? "primary" : "danger"}
              onPress={onConfirm}
              style={styles.button}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    // §6 web/desktop: cap the sheet like the content frame so it doesn't span a
    // full laptop window.
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(2) },
  message: { ...typeScale.body, color: colors.textSecondary, marginBottom: space(2) },
  buttons: { flexDirection: "row", gap: space(3), marginTop: space(3) },
  button: { flex: 1 },
}));
