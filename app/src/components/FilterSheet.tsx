/**
 * FilterSheet (ux-audit F4/F5) — bottom-sheet filter grid for the question bank:
 * every server-side filter group, INCLUDING টপিক ট্যাগ (distinct values from the
 * server) and review status, which the API always supported but the old screen
 * never surfaced. Edits go to a DRAFT copied from the applied filters when the
 * sheet opens; [দেখুন] commits, [সব ফিল্টার মুছুন] resets the draft (prototype
 * behavior). Same Modal scaffold as ScoreSheet/ConfirmSheet (top radius 12,
 * maxWidth 520, safe-area bottom pad).
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import {
  SUBJECTS,
  CLASS_LEVELS,
  QUESTION_TYPES,
  PAPER_ROLES,
  DIFFICULTIES,
  BLOOM_LEVELS,
  REVIEW_STATUSES,
} from "@scd/shared";
import {
  QUESTION_TOPIC_TAGS_QUERY,
  QUESTION_CATEGORIES_QUERY,
  QUESTION_CHAPTERS_QUERY,
} from "../graphql/operations";
import { EMPTY_FILTERS, type QbFilters } from "../state/QuestionBankContext";
import { Chip, ChipRow, Field, Muted, H2, Button } from "./ui";
import {
  STR,
  subjectLabel,
  difficultyLabel,
  paperRoleLabel,
  reviewStatusLabel,
  questionCategoryLabel,
  bnNum,
} from "../lib/labels";
import { prettyCode } from "../lib/question";
import { makeStyles, radius, space } from "../theme";

export function FilterSheet({
  visible,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  /** The currently APPLIED filters — copied into the draft each time the sheet opens. */
  filters: QbFilters;
  onApply: (next: QbFilters) => void;
  onClose: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<QbFilters>(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  // Distinct topic tags, narrowed by the draft's subject/class so the list stays
  // relevant. Paused while hidden — no fetch until the teacher opens the sheet.
  const [tagsQ] = useQuery({
    query: QUESTION_TOPIC_TAGS_QUERY,
    variables: { subject: draft.subject, classLevel: draft.classLevel },
    pause: !visible,
  });
  const topicTags = tagsQ.data?.questionTopicTags ?? [];

  // Categories present in the chosen subject/class (D-#511). The group is rendered
  // ONLY when this comes back non-empty — the axis exists for the C5 Bangla bank and
  // for nothing else yet, and a row of chips that match zero questions is worse than
  // no row at all. Narrowed by the DRAFT, so picking বাংলা / ৫ reveals it immediately.
  const [catsQ] = useQuery({
    query: QUESTION_CATEGORIES_QUERY,
    variables: { subject: draft.subject, classLevel: draft.classLevel },
    pause: !visible,
  });
  const categories = catsQ.data?.questionCategories ?? [];

  // A category selected earlier must not become unclearable when the subject moves to
  // one that has no categories: drop it with the group that offered it.
  useEffect(() => {
    if (!visible || catsQ.fetching) return;
    if (draft.category && !categories.includes(draft.category)) {
      setDraft((prev) => ({ ...prev, category: null }));
    }
  }, [visible, catsQ.fetching, categories, draft.category]);

  // Chapters present in the chosen subject/class (D-#524) — same data-driven rule as
  // the category group: no chapters, no group.
  const [chaptersQ] = useQuery({
    query: QUESTION_CHAPTERS_QUERY,
    variables: { subject: draft.subject, classLevel: draft.classLevel },
    pause: !visible,
  });
  const chapters = chaptersQ.data?.questionChapters ?? [];

  /** Toggle one value in a multi-select axis. Order is preserved so the chip row and
   *  the applied-filter bar read the same way twice running. */
  function toggleIn<K extends "topicTags" | "questionTypes">(key: K, value: string): void {
    setDraft((prev) => {
      const cur = prev[key];
      return { ...prev, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function toggleChapter(n: number): void {
    setDraft((prev) => ({
      ...prev,
      chapters: prev.chapters.includes(n)
        ? prev.chapters.filter((c) => c !== n)
        : [...prev.chapters, n].sort((a, b) => a - b),
    }));
  }

  function set<K extends keyof QbFilters>(key: K, value: QbFilters[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function toggle<K extends keyof QbFilters>(key: K, value: QbFilters[K]): void {
    setDraft((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }) as QbFilters);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={STR.close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />
          <H2>{STR.filters}</H2>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Muted>{STR.subject}</Muted>
            <ChipRow>
              {SUBJECTS.map((s) => (
                <Chip key={s} label={subjectLabel(s)} selected={draft.subject === s} onPress={() => toggle("subject", s)} />
              ))}
            </ChipRow>

            <Muted style={styles.groupGap}>{STR.classLevel}</Muted>
            <ChipRow>
              {CLASS_LEVELS.map((c) => (
                <Chip key={c} label={bnNum(c)} selected={draft.classLevel === c} onPress={() => toggle("classLevel", c)} />
              ))}
            </ChipRow>

            {chapters.length > 0 ? (
              <>
                <Muted style={styles.groupGap}>{STR.qbChapter}</Muted>
                <ChipRow>
                  {chapters.map((c) => (
                    <Chip
                      key={c}
                      label={bnNum(c)}
                      selected={draft.chapters.includes(c)}
                      onPress={() => toggleChapter(c)}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            {topicTags.length > 0 ? (
              <>
                <Muted style={styles.groupGap}>{STR.qbTopicTag}</Muted>
                <ChipRow>
                  {topicTags.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      selected={draft.topicTags.includes(t)}
                      onPress={() => toggleIn("topicTags", t)}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            {/* The IMPORTANT lens (QR-9, D-#550). One chip, because the mark is binary and
                the useful question is “only the marked ones” — nobody asks for only the
                unmarked. `toggle` already turns a second tap back into “no constraint”. */}
            <Muted style={styles.groupGap}>{STR.qImportant}</Muted>
            <ChipRow>
              <Chip
                label={STR.qImportantOnly}
                selected={draft.important === true}
                onPress={() => toggle("important", true)}
              />
            </ChipRow>

            <Muted style={styles.groupGap}>{STR.reviewStatus}</Muted>
            <ChipRow>
              {REVIEW_STATUSES.map((r) => (
                <Chip key={r} label={reviewStatusLabel(r)} selected={draft.reviewStatus === r} onPress={() => toggle("reviewStatus", r)} />
              ))}
            </ChipRow>

            <Muted style={styles.groupGap}>{STR.questionType}</Muted>
            <ChipRow>
              {QUESTION_TYPES.map((q) => (
                <Chip
                  key={q}
                  label={prettyCode(q)}
                  selected={draft.questionTypes.includes(q)}
                  onPress={() => toggleIn("questionTypes", q)}
                />
              ))}
            </ChipRow>

            {categories.length > 0 ? (
              <>
                <Muted style={styles.groupGap}>{STR.qbCategory}</Muted>
                <ChipRow>
                  {categories.map((c) => (
                    <Chip
                      key={c}
                      label={questionCategoryLabel(c)}
                      selected={draft.category === c}
                      onPress={() => toggle("category", c)}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            <Muted style={styles.groupGap}>{STR.paperRole}</Muted>
            <ChipRow>
              {PAPER_ROLES.map((p) => (
                <Chip key={p} label={paperRoleLabel(p)} selected={draft.paperRole === p} onPress={() => toggle("paperRole", p)} />
              ))}
            </ChipRow>

            <Muted style={styles.groupGap}>{STR.difficulty}</Muted>
            <ChipRow>
              {DIFFICULTIES.map((d) => (
                <Chip key={d} label={difficultyLabel(d)} selected={draft.difficulty === d} onPress={() => toggle("difficulty", d)} />
              ))}
            </ChipRow>

            <Muted style={styles.groupGap}>{STR.bloom}</Muted>
            <ChipRow>
              {BLOOM_LEVELS.map((b) => (
                <Chip key={b} label={b} selected={draft.bloomLevel === b} onPress={() => toggle("bloomLevel", b)} />
              ))}
            </ChipRow>

            <View style={[styles.marksRow, styles.groupGap]}>
              <View style={styles.marksCell}>
                <Field label={STR.marksMin} value={draft.marksMin} onChangeText={(t) => set("marksMin", t)} keyboardType="numeric" placeholder="0" />
              </View>
              <View style={styles.marksCell}>
                <Field label={STR.marksMax} value={draft.marksMax} onChangeText={(t) => set("marksMax", t)} keyboardType="numeric" placeholder="100" />
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerCell}>
              <Button title={STR.qbClearFilters} variant="ghost" onPress={() => setDraft(EMPTY_FILTERS)} />
            </View>
            <View style={styles.footerCell}>
              <Button
                title={STR.qbApplyFilters}
                onPress={() => {
                  onApply(draft);
                  onClose();
                }}
              />
            </View>
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
    gap: space(3),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    maxHeight: "88%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: "center",
  },
  scroll: { flexGrow: 0 },
  groupGap: { marginTop: space(3) },
  marksRow: { flexDirection: "row", gap: space(3) },
  marksCell: { flex: 1 },
  footer: { flexDirection: "row", gap: space(2) },
  footerCell: { flex: 1 },
}));
