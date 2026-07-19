/**
 * CreateSetSheet (ux-audit F6/F10) — the one-step create flow: reorder (▲/▼) and
 * prune the selected questions, name the set, pick HW/AS/CT, confirm the section
 * (prefilled from SectionContext), set the due date (HW/AS) or duration (CT),
 * then ONE transactional createSetWithQuestions mutation → SetDetail. Replaces
 * the old 4-screen Basket → AssembleSet path (which stays for draft edits).
 *
 * The mutation result is always handled (F-finding): error → danger toast, sheet
 * stays open, selection intact; success → clear basket, ok toast, navigate.
 * Class-mismatch guard ported from BasketScreen: a Class-5 selection cannot land
 * on a Class-3 section.
 */
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "urql";
import { SET_TYPES } from "@scd/shared";
import { CREATE_SET_WITH_QUESTIONS } from "../../graphql/operations";
import { OutcomeSegment } from "../../components/OutcomeSegment";
import { DateField } from "../../components/DateField";
import { Button, Field, H2, Muted, Notice } from "../../components/ui";
import {
  STR,
  setTypeLabel,
  bnNum,
  classLevelLabel,
  getActiveLang,
  selectionSummaryLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useBasket } from "../../state/BasketContext";
import { useSectionContext } from "../../state/SectionContext";
import { useToast } from "../../state/ToastContext";
import { makeStyles, radius, space, typeScale } from "../../theme";

export function CreateSetSheet({
  visible,
  onClose,
  onPickSection,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  /** Close the sheet and open the SectionPicker. */
  onPickSection: () => void;
  /** Navigate to the created set's detail (basket already cleared). */
  onCreated: (setId: string) => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const basket = useBasket();
  const { selection, hasSection } = useSectionContext();
  const toast = useToast();
  const lang = getActiveLang();

  const [setType, setSetType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [, createMut] = useMutation(CREATE_SET_WITH_QUESTIONS);

  const isCt = setType === "CT";

  // Guard (ported from BasketScreen): the selection's class level must match the
  // target section's class — a set targets exactly one section.
  const basketLevels = Array.from(new Set(basket.items.map((i) => i.classLevel)));
  const classMismatch =
    hasSection &&
    selection.classLevel != null &&
    basketLevels.some((l) => l !== selection.classLevel);

  const canSubmit = !!setType && hasSection && basket.count > 0 && !classMismatch && !busy;

  async function onCreate(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);

    let dueIso: string | null = null;
    if (!isCt && dueDate.trim()) {
      const d = new Date(dueDate.trim());
      if (Number.isNaN(d.getTime())) {
        toast.show(STR.invalidDate, "danger");
        setBusy(false);
        return;
      }
      dueIso = d.toISOString();
    }

    const res = await createMut({
      setType: setType!,
      sectionId: selection.sectionId!,
      classId: selection.classId!,
      name: name.trim() || null,
      artifactIds: basket.items.map((i) => i.artifactId),
      dueDate: dueIso,
      durationMinutes: isCt && duration.trim() ? Number(duration) : null,
    });
    setBusy(false);

    if (res.error || !res.data?.createSetWithQuestions) {
      // Never discard the result: the sheet stays open with the selection intact
      // so a flaky connection costs a retry, not the whole set (F10).
      toast.show(friendlyError(res.error), "danger");
      return;
    }

    const setId = res.data.createSetWithQuestions.id;
    basket.clear();
    setName("");
    setSetType(null);
    setDueDate("");
    setDuration("");
    toast.show(STR.qbSetCreated, "ok");
    onCreated(setId);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={STR.close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />
          <H2>{STR.qbCreateSet}</H2>
          <Muted>{selectionSummaryLabel(basket.count, basket.totalMarks)}</Muted>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {basket.items.map((item, idx) => (
              <View key={item.artifactId} style={styles.itemRow}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemHead} numberOfLines={1}>
                    {item.qid} · {bnNum(item.marks)} {STR.marks}
                  </Text>
                  <Text style={styles.itemLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                </View>
                <Pressable
                  onPress={() => basket.move(item.artifactId, -1)}
                  disabled={idx === 0}
                  style={[styles.iconBtn, idx === 0 && styles.iconBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel={STR.qbMoveUp}
                  accessibilityState={{ disabled: idx === 0 }}
                >
                  <Text style={styles.iconGlyph}>▲</Text>
                </Pressable>
                <Pressable
                  onPress={() => basket.move(item.artifactId, 1)}
                  disabled={idx === basket.items.length - 1}
                  style={[styles.iconBtn, idx === basket.items.length - 1 && styles.iconBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel={STR.qbMoveDown}
                  accessibilityState={{ disabled: idx === basket.items.length - 1 }}
                >
                  <Text style={styles.iconGlyph}>▼</Text>
                </Pressable>
                <Pressable
                  onPress={() => basket.remove(item.artifactId)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={STR.remove}
                >
                  <Text style={styles.iconGlyph}>✕</Text>
                </Pressable>
              </View>
            ))}

            <View style={styles.groupGap}>
              <Field label={STR.setName} value={name} onChangeText={setName} placeholder={STR.setNamePlaceholder} />
            </View>

            <Muted>{STR.setType}</Muted>
            <OutcomeSegment
              options={SET_TYPES.map((t) => ({ value: t, label: setTypeLabel(t), tone: "ok" as const }))}
              value={setType}
              onChange={(v) => setSetType(v)}
            />

            <View style={styles.groupGap}>
              {hasSection ? (
                <View style={styles.sectionRow}>
                  <Muted>
                    {STR.section}:{" "}
                    {lang === "en" ? classLevelLabel(selection.classLevel ?? 0) : selection.classNameBn} ·{" "}
                    {lang === "en" ? selection.sectionCode ?? selection.sectionNameBn : selection.sectionNameBn}
                  </Muted>
                  <Button title={STR.changeSection} variant="ghost" onPress={onPickSection} />
                </View>
              ) : (
                <View>
                  <Notice message={STR.noSectionSelected} tone="warn" />
                  <Button title={STR.pickSection} variant="secondary" onPress={onPickSection} />
                </View>
              )}

              {classMismatch ? (
                <Notice
                  message={`${STR.classMismatchWarn} (${basketLevels.map(classLevelLabel).join(", ")} → ${classLevelLabel(selection.classLevel!)})`}
                  tone="danger"
                />
              ) : null}
            </View>

            <View style={styles.groupGap}>
              {isCt ? (
                <Field
                  label={STR.durationMinutes}
                  value={duration}
                  onChangeText={setDuration}
                  keyboardType="numeric"
                  placeholder="60"
                />
              ) : (
                <DateField label={STR.dueDate} value={dueDate} onChange={setDueDate} />
              )}
            </View>
          </ScrollView>

          <Button
            title={busy ? STR.saving : STR.create}
            onPress={() => void onCreate()}
            loading={busy}
            disabled={!canSubmit}
          />
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
    gap: space(3),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    maxHeight: "92%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: "center",
  },
  scroll: { flexGrow: 0 },
  groupGap: { marginTop: space(3), marginBottom: space(3) },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingVertical: space(1),
    paddingLeft: space(3),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: space(2),
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemHead: { ...typeScale.caption, color: colors.textSecondary },
  itemLabel: { ...typeScale.secondary, color: colors.textPrimary },
  iconBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDisabled: { opacity: 0.3 },
  iconGlyph: { ...typeScale.body, color: colors.textSecondary },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
}));
