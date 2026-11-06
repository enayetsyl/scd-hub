/**
 * MistakeReasonSheet (D-#937, docs/prd-staff-mistakes.md §3) — "কী হয়েছিল?": the reason
 * buttons for a caught mistake plus free text, as a bottom sheet like ConfirmSheet. Used
 * on the submit pass before a same-day correction, and from আমার ভুল ও ব্যাখ্যা to explain
 * an entry later. The buttons come from the shared list, so the code the server stores is
 * the button the person tapped.
 */
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STAFF_MISTAKE_REASONS, staffMistakeReason, type StaffMistakeKind } from "@scd/shared";
import { Button, Field } from "./ui";
import { STR, getActiveLang } from "../lib/labels";
import { fonts, makeStyles, radius, space, typeScale } from "../theme";

export interface MistakeReasonPick {
  code: string;
  text: string;
}

export interface MistakeReasonRequest {
  kind: StaffMistakeKind;
  title?: string;
  /** What happened, above the buttons. */
  message?: string;
  /** Show what the guardian will receive for the picked reason (the submit pass). */
  guardianPreview?: boolean;
  submitLabel?: string;
  /** D-#1020: the person is not told about mistakes — no "counts / who reviews" hint. */
  hideHint?: boolean;
  /** Pre-select (re-explaining an entry). */
  initial?: MistakeReasonPick | null;
}

/** A per-kind string when one exists (placeholder, hint), else undefined. */
const kindStr = (key: string): string | undefined => (STR as unknown as Record<string, string | undefined>)[key];

export function reasonLabel(kind: StaffMistakeKind, code: string | null | undefined): string {
  if (!code) return "";
  const r = staffMistakeReason(kind, code);
  if (!r) return code;
  return getActiveLang() === "en" ? r.en : r.bn;
}

export function MistakeReasonSheet({
  request,
  onCancel,
  onSubmit,
}: {
  request: MistakeReasonRequest | null;
  onCancel: () => void;
  onSubmit: (pick: MistakeReasonPick) => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [code, setCode] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");

  // Every new request starts from its own initial pick.
  React.useEffect(() => {
    setCode(request?.initial?.code ?? null);
    setText(request?.initial?.text ?? "");
  }, [request]);

  const kind = request?.kind ?? "MARK_CORRECTION";
  const reasons = STAFF_MISTAKE_REASONS[kind];
  const picked = code ? staffMistakeReason(kind, code) : undefined;
  const needsText = !!picked?.needsText;
  const ready = !!picked && (!needsText || text.trim().length > 0);
  const en = getActiveLang() === "en";

  return (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={STR.cancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{request?.title ?? STR.smrSheetTitle}</Text>
            {request?.message ? <Text style={styles.message}>{request.message}</Text> : null}
            <Text style={styles.label}>{STR.smrSheetPick}</Text>
            {reasons.map((r) => {
              const on = r.code === code;
              return (
                <Pressable
                  key={r.code}
                  onPress={() => setCode(r.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.option, on && styles.optionOn]}
                >
                  <View style={[styles.radio, on && styles.radioOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{en ? r.en : r.bn}</Text>
                    {en ? null : <Text style={styles.optionHint}>{r.hintBn}</Text>}
                  </View>
                </Pressable>
              );
            })}
            <Field
              label={needsText ? STR.smrTextRequired : STR.smrTextOptional}
              value={text}
              onChangeText={setText}
              placeholder={kindStr(`smrTextPlaceholder_${kind}`) ?? STR.smrTextPlaceholder}
              multiline
              autoCapitalize="sentences"
            />
            {request?.guardianPreview && picked ? (
              <View style={styles.preview}>
                <Text style={styles.label}>{STR.smrGuardianPreview}</Text>
                <Text style={styles.message}>{picked.code === "LATE_DIRECT" ? STR.smrGuardianLate : STR.smrGuardianApology}</Text>
              </View>
            ) : null}
            {request?.hideHint ? null : <Text style={styles.hint}>{kindStr(`smrHint_${kind}`) ?? STR.smrSelfCountsHint}</Text>}
            <View style={styles.buttons}>
              <Button title={STR.cancel} variant="secondary" onPress={onCancel} style={styles.button} />
              <Button
                title={!picked ? STR.smrPickFirst : !ready ? STR.smrTextFirst : (request?.submitLabel ?? STR.smrSend)}
                disabled={!ready}
                onPress={() => picked && onSubmit({ code: picked.code, text: text.trim() })}
                style={styles.button}
              />
            </View>
          </ScrollView>
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
    width: "100%",
    maxWidth: 520,
    maxHeight: "92%",
    alignSelf: "center",
  },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(2) },
  message: { ...typeScale.body, color: colors.textSecondary, marginBottom: space(2) },
  label: { ...typeScale.caption, fontFamily: fonts.medium, color: colors.textSecondary, marginBottom: space(1) },
  option: {
    flexDirection: "row",
    gap: space(3),
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space(3),
    marginBottom: space(2),
    minHeight: 48,
  },
  optionOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryContainer },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.textSecondary, marginTop: 2 },
  radioOn: { borderWidth: 5, borderColor: colors.primary, backgroundColor: colors.surface },
  optionTitle: { ...typeScale.bodyStrong, color: colors.textPrimary },
  optionHint: { ...typeScale.caption, color: colors.textSecondary },
  preview: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: space(3), marginBottom: space(2) },
  hint: { ...typeScale.caption, color: colors.textSecondary, marginBottom: space(1) },
  buttons: { flexDirection: "row", gap: space(3), marginTop: space(3) },
  button: { flex: 1 },
}));
