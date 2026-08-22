/**
 * AssignQuestionsScreen (QR-4, Q4.2) — Principal/Office pick unpublished questions and
 * send them to one reviewer in a single call.
 *
 * Mirrors AssignReviewsScreen's shape (filter → multi-select → pick a reviewer → assign),
 * but over `assignableQuestions`, which returns only NOT-yet-published questions — a
 * published question is done and is never assignable.
 *
 * Bulk is the normal path here: the Principal slices a subject/class and sends the lot.
 * Per-question failures come back collected rather than aborting the batch.
 */
import React, { useState, useMemo, useCallback } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { SUBJECTS, CLASS_LEVELS } from "@scd/shared";
import {
  ASSIGNABLE_QUESTIONS,
  ASSIGN_QUESTION_REVIEW_BULK,
  ASSIGN_QUESTION_REVIEW_BY_CHAPTER,
  QUESTION_CHAPTERS_QUERY,
  TEACHERS_QUERY,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, reviewStatusLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "AssignQuestions">;

export default function AssignQuestionsScreen({ navigation }: Props): React.ReactElement {
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSIGNABLE_QUESTIONS,
    variables: { subject, classLevel, search: search.trim() === "" ? null : search.trim(), limit: 300 },
  });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const [, assignBulk] = useMutation(ASSIGN_QUESTION_REVIEW_BULK);
  const [, assignByChapter] = useMutation(ASSIGN_QUESTION_REVIEW_BY_CHAPTER);

  // Chapter-wise assign (D-#525): the Principal's normal path is a whole chapter at a
  // time, not 240 checkboxes. Offered only once a subject AND class are chosen, because
  // a chapter number means nothing without them.
  const [chapters, setChapters] = useState<number[]>([]);
  const [{ data: chapterData }] = useQuery({
    query: QUESTION_CHAPTERS_QUERY,
    variables: { subject, classLevel },
    pause: !subject || classLevel == null,
  });
  const chapterOptions = chapterData?.questionChapters ?? [];

  async function assignChapters(): Promise<void> {
    if (!reviewerId || !subject || classLevel == null || chapters.length === 0) return;
    setBusy(true);
    setFailure(null);
    const res = await assignByChapter({ subject, classLevel, chapters, reviewerId });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    const r = res.data.assignQuestionReviewByChapter;
    const skipped = r.skippedPublished + r.skippedReviewed + r.skippedOpenRound;
    // Always report the skips: "42 assigned" out of a 240-question chapter is
    // indistinguishable from a bug unless the other 198 are accounted for.
    setNotice(
      `${STR.qrChapterAssigned}: ${bnNum(r.assigned)}/${bnNum(r.total)}` +
        (skipped > 0 ? ` · ${STR.qrChapterSkipped}: ${bnNum(skipped)}` : ""),
    );
    setChapters([]);
    refetch({ requestPolicy: "network-only" });
  }

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const rows = data?.assignableQuestions ?? [];
  const teachers = teacherData?.teachers ?? [];

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.artifactId)),
    [rows, selected],
  );

  async function assign(): Promise<void> {
    if (!reviewerId || selected.size === 0) return;
    setBusy(true);
    setFailure(null);
    const res = await assignBulk({ artifactIds: [...selected], reviewerId });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    const r = res.data?.assignQuestionReviewBulk;
    // Report the failures rather than claiming a clean run — the batch is not atomic.
    setNotice(
      r && r.failedCount > 0
        ? `${STR.qrAssigned} (${bnNum(r.okCount)} ✓, ${bnNum(r.failedCount)} ✗)`
        : STR.qrAssigned,
    );
    setSelected(new Set());
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && rows.length === 0) return <Loader />;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl refreshing={fetching} onRefresh={() => refetch({ requestPolicy: "network-only" })} />
        }
      >
        <H2>{STR.qrAssignTitle}</H2>
        {error ? <ErrorBanner message={friendlyError(error)} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        <ChipRow>
          {SUBJECTS.map((s) => (
            <Chip
              key={s}
              label={subjectLabel(s)}
              selected={subject === s}
              onPress={() => setSubject(subject === s ? null : s)}
            />
          ))}
        </ChipRow>
        <ChipRow>
          {CLASS_LEVELS.map((c) => (
            <Chip
              key={c}
              label={classLevelLabel(c)}
              selected={classLevel === c}
              onPress={() => setClassLevel(classLevel === c ? null : c)}
            />
          ))}
        </ChipRow>
        <Field label={STR.qbSearchPlaceholder} value={search} onChangeText={setSearch} />

        <Divider />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
          <Muted>{`${bnNum(selected.size)} ${STR.qrSelected}`}</Muted>
          <Button
            title={allSelected ? STR.rvClear : STR.rvSelectAll}
            variant="ghost"
            onPress={() =>
              setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.artifactId)))
            }
          />
        </View>

        <Muted>{STR.rvPickReviewer}</Muted>
        <ChipRow>
          {teachers.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={reviewerId === t.id}
              onPress={() => setReviewerId(reviewerId === t.id ? null : t.id)}
            />
          ))}
        </ChipRow>

        <Button
          title={STR.rvAssign}
          loading={busy}
          disabled={!reviewerId || selected.size === 0}
          onPress={() => void assign()}
        />

        {chapterOptions.length > 0 ? (
          <>
            <Divider />
            <Muted>{STR.qrChapterAssign}</Muted>
            <ChipRow>
              {chapterOptions.map((c) => (
                <Chip
                  key={c}
                  label={bnNum(c)}
                  selected={chapters.includes(c)}
                  onPress={() =>
                    setChapters((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c].sort((a, b) => a - b),
                    )
                  }
                />
              ))}
            </ChipRow>
            <Button
              title={STR.qrChapterAssign}
              loading={busy}
              disabled={!reviewerId || chapters.length === 0}
              onPress={() => void assignChapters()}
            />
          </>
        ) : null}

        <Divider />

        {rows.length === 0 ? (
          <EmptyState message={STR.qrNoAssignable} />
        ) : (
          rows.map((q) => (
            <Pressable key={q.artifactId} onPress={() => toggle(q.artifactId)}>
              <Card style={{ marginBottom: space(2) }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                  <Badge text={selected.has(q.artifactId) ? "✓" : "○"} tone={selected.has(q.artifactId) ? "ok" : "muted"} />
                  <Badge text={subjectLabel(q.subject)} />
                  <Badge text={classLevelLabel(q.classLevel)} />
                  <Badge text={reviewStatusLabel(q.reviewStatus)} />
                  {q.currentReviewerName ? (
                    <Badge text={`${STR.rvAssignedTo}: ${q.currentReviewerName}`} tone="warn" />
                  ) : null}
                </View>
                <Body>{q.questionText ?? q.qid ?? "—"}</Body>
                {q.qid ? <Muted>{q.qid}</Muted> : null}
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
