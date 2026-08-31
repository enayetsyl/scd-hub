/**
 * QuestionBankScreen — "প্রশ্ন খুঁজুন ও বাছাই করুন" (ux-audit F4/F5/F6/F15/F16).
 *
 * Sticky SearchField (text + qid, Bangla digits match) and FilterBar of active
 * chips + FilterSheet with EVERY server filter group (incl. টপিক ট্যাগ + review
 * status). Filters/search/pagination live in QuestionBankContext (survive
 * navigation; filters+search survive restarts). Cards are SelectableCards —
 * checkbox = select into the basket, card tap = preview — with a grapheme-safe
 * 2-line clamp (numberOfLines, never substring). A sticky SelectionTray opens
 * the one-step CreateSetSheet. Cursor pagination appends pages ("আরও দেখুন").
 *
 * Add-to-set mode (route.params.addToSetId, from SetDetail's draft edit) keeps
 * the old per-row add button and skips selection/tray entirely.
 */
import React, { useMemo, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { QUESTIONS_QUERY, ADD_QUESTION_TO_SET, type QuestionListItem } from "../../graphql/operations";
import type { QuestionsStackParamList, TabParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { SearchField } from "../../components/SearchField";
import { FilterBar, type FilterChip } from "../../components/FilterBar";
import { useAuth } from "../../auth/AuthContext";
import { QUESTION_USAGE_COUNTS } from "../../graphql/operations";
import { FilterSheet } from "../../components/FilterSheet";
import { SelectableCard } from "../../components/SelectableCard";
import { SelectionTray } from "../../components/SelectionTray";
import { CreateSetSheet } from "./CreateSetSheet";
import {
  STR,
  subjectLabel,
  difficultyLabel,
  paperRoleLabel,
  reviewStatusLabel,
  classLevelLabel,
  bnNum,
  questionCategoryLabel,
} from "../../lib/labels";
import { useBasket } from "../../state/BasketContext";
import { useQuestionBank, type QbFilters } from "../../state/QuestionBankContext";
import { questionText, prettyCode } from "../../lib/question";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<QuestionsStackParamList, "QuestionBank">;

const PAGE = 40;

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && !Number.isNaN(n) ? n : null;
}

/** Review-status badge tone: gold → gold, reviewed → ok, draft → muted. */
function reviewTone(status: string): "gold" | "ok" | "muted" {
  if (status === "gold") return "gold";
  if (status === "reviewed") return "ok";
  return "muted";
}

export default function QuestionBankScreen({ navigation, route }: Props): React.ReactElement {
  const basket = useBasket();
  const qb = useQuestionBank();
  const tabNav = useNavigation<NavigationProp<TabParamList>>();

  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Add-to-set mode: rows push straight into the given draft set (addQuestionToSet)
  // rather than the basket. `addedIds` tracks what this session already added so the
  // row flips to "Added" (server dedupes too). See SetDetail's "Add questions".
  const addToSetId = route.params?.addToSetId;
  const [, addToSetMut] = useMutation(ADD_QUESTION_TO_SET);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Clear the add-mode param when leaving the screen so a later drawer visit to
  // Questions opens the normal basket mode (route params otherwise persist, incl. in
  // the restored web nav state).
  useEffect(() => {
    const unsub = navigation.addListener("blur", () => {
      if (route.params?.addToSetId) navigation.setParams({ addToSetId: undefined });
    });
    return unsub;
  }, [navigation, route.params?.addToSetId]);

  async function onAddToSet(artifactId: string): Promise<void> {
    if (!addToSetId || addedIds.has(artifactId)) return;
    const res = await addToSetMut({ setId: addToSetId, artifactId });
    if (!res.error) setAddedIds((prev) => new Set(prev).add(artifactId));
  }

  // One query per (filters, search, cursor) triple. `pause` until the persisted
  // filters hydrate — otherwise the first render fires a default-filter query
  // that immediately gets replaced (F5). Each distinct `after` is its own cache
  // key, so "আরও দেখুন" fetches ONLY the new page (F16) and back-navigation
  // replays earlier pages from the document cache.
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: QUESTIONS_QUERY,
    variables: {
      subject: qb.filters.subject,
      classLevel: qb.filters.classLevel,
      topicTags: qb.filters.topicTags,
      questionTypes: qb.filters.questionTypes,
      chapters: qb.filters.chapters,
      category: qb.filters.category,
      paperRole: qb.filters.paperRole,
      difficulty: qb.filters.difficulty,
      bloomLevel: qb.filters.bloomLevel,
      reviewStatus: qb.filters.reviewStatus,
      important: qb.filters.important,
      retired: qb.filters.retired,
      marksMin: num(qb.filters.marksMin),
      marksMax: num(qb.filters.marksMax),
      search: qb.search.trim() || null,
      limit: PAGE,
      after: qb.after,
    },
    pause: !qb.loaded,
  });

  const { appendPage, after: currentAfter } = qb;
  useEffect(() => {
    if (data?.questions) appendPage(data.questions, currentAfter, PAGE);
    // `currentAfter` is read, not depended on: appendPage dedupes by id, so a
    // transient data/cursor mismatch is a harmless no-op append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, appendPage]);

  // Active-filter chips for the FilterBar.
  const chips: FilterChip[] = [];
  const f = qb.filters;
  if (f.subject) chips.push({ key: "subject", label: subjectLabel(f.subject) });
  if (f.classLevel != null) chips.push({ key: "classLevel", label: classLevelLabel(f.classLevel) });
  // One chip per multi-select axis, not one per value: a 23-chapter pick would
  // otherwise push 23 chips and bury the rest of the bar (D-#524).
  if (f.chapters.length > 0) {
    chips.push({
      key: "chapters",
      label: `${STR.qbChapter}: ${f.chapters.map((c) => bnNum(c)).join(", ")}`,
    });
  }
  if (f.topicTags.length > 0) {
    chips.push({
      key: "topicTags",
      label: f.topicTags.length === 1 ? f.topicTags[0] : `${STR.qbTopicTag} (${bnNum(f.topicTags.length)})`,
    });
  }
  if (f.reviewStatus) chips.push({ key: "reviewStatus", label: reviewStatusLabel(f.reviewStatus) });
  if (f.important) chips.push({ key: "important", label: STR.qImportantOnly });
  if (f.retired) chips.push({ key: "retired", label: STR.qbShowRetired });
  if (f.questionTypes.length > 0) {
    chips.push({
      key: "questionTypes",
      label: f.questionTypes.map((q) => prettyCode(q)).join(", "),
    });
  }
  if (f.category) chips.push({ key: "category", label: questionCategoryLabel(f.category) });
  if (f.paperRole) chips.push({ key: "paperRole", label: paperRoleLabel(f.paperRole) });
  if (f.difficulty) chips.push({ key: "difficulty", label: difficultyLabel(f.difficulty) });
  if (f.bloomLevel) chips.push({ key: "bloomLevel", label: f.bloomLevel });
  if (f.marksMin.trim()) chips.push({ key: "marksMin", label: `${STR.marks} ≥ ${bnNum(f.marksMin)}` });
  if (f.marksMax.trim()) chips.push({ key: "marksMax", label: `${STR.marks} ≤ ${bnNum(f.marksMax)}` });

  const isEmpty =
    !fetching && !error && qb.items.length === 0 && (data?.questions?.length ?? 0) === 0;

  // Q3.7 (D-#508): with no filters applied, an empty bank is NOT a filter problem — the
  // shelf only ever shows PUBLISHED questions, and telling the teacher to change filters
  // they never set would send them hunting for something that isn't there.
  const { can } = useAuth();
  /**
   * A SEARCH counts as narrowing (D-#570). It did not, so an unmatched search fell into the
   * “nothing here at all” branch and answered a search with “only published questions are
   * shown here” — which sent the reader looking in the wrong place for a question that was
   * simply retired.
   */
  const nothingNarrowed = chips.length === 0 && qb.search.trim() === "";
  /** That note is only TRUE for a caller the publish gate actually applies to. */
  const gatedToPublished = !can("question:manage");
  const loadingMore = fetching && qb.after !== null;

  /**
   * How many sets each visible question is already in (QU-1, D-#608).
   *
   * ONE batched query for the whole loaded window, not one per row. Keyed on the qid, so a
   * question re-imported since it was used still shows its history. `pause` on an empty
   * list keeps a fresh bank from firing a query with no ids.
   */
  const usageQids = useMemo(
    () => qb.items.map((q) => q.qid).filter((q): q is string => !!q),
    [qb.items],
  );
  const [usageQ] = useQuery({
    query: QUESTION_USAGE_COUNTS,
    variables: { qids: usageQids },
    pause: usageQids.length === 0,
  });
  const usageByQid = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of usageQ.data?.questionUsageCounts ?? []) m.set(r.qid, r.count);
    return m;
  }, [usageQ.data]);

  function renderCardBody(q: QuestionListItem): React.ReactElement {
    const text = questionText(q.payloadJson);
    return (
      <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <Muted style={{ fontWeight: "700" }}>
            {q.qid ?? q.id.slice(-6)} · {bnNum(q.marks ?? 0)} {STR.marks}
          </Muted>
          <Badge text={reviewStatusLabel(q.reviewStatus)} tone={reviewTone(q.reviewStatus)} />
          {/* The IMPORTANT mark (QR-9, D-#550). Gold, and placed beside the status badge so
              a marked question is identifiable while scanning the list, not only on open. */}
          {q.important ? <Badge text={STR.qImportant} tone="gold" /> : null}
          {/* A retired row can only appear under the retired lens, so the badge is not
              redundant with the filter chip — it is what marks the list as NOT the bank. */}
          {q.retired ? <Badge text={STR.qeRetired} tone="danger" /> : null}
          {/* Already in a set (QU-1) — the count is the warning; the WHERE is on the
              preview, because a date and a section are what decide whether reuse matters. */}
          {(usageByQid.get(q.qid ?? "") ?? 0) > 0 ? (
            <Badge text={`${bnNum(usageByQid.get(q.qid ?? "") ?? 0)} ${STR.quUsedIn}`} tone="info" />
          ) : null}
        </View>
        {/* Grapheme-safe clamp (F15): numberOfLines, NEVER a substring — a
            code-unit slice can cut a Bangla conjunct mid-cluster. */}
        <Body style={{ marginTop: space(1) }} numberOfLines={2}>
          {text || "—"}
        </Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {q.topicTag ? <Badge text={q.topicTag} tone="muted" /> : null}
          {q.questionType ? <Badge text={prettyCode(q.questionType)} tone="muted" /> : null}
          {q.category ? <Badge text={questionCategoryLabel(q.category)} tone="muted" /> : null}
          {q.paperRole ? <Badge text={paperRoleLabel(q.paperRole)} tone="muted" /> : null}
          {q.difficulty ? <Badge text={difficultyLabel(q.difficulty)} tone="muted" /> : null}
        </View>
      </>
    );
  }

  function renderItem({ item: q }: { item: QuestionListItem }): React.ReactElement {
    if (addToSetId) {
      return (
        <Card>
          {renderCardBody(q)}
          <Button
            title={addedIds.has(q.id) ? STR.addedToSet : STR.addToSet}
            variant={addedIds.has(q.id) ? "secondary" : "primary"}
            disabled={addedIds.has(q.id)}
            onPress={() => void onAddToSet(q.id)}
            style={{ marginTop: space(2) }}
          />
        </Card>
      );
    }
    const text = questionText(q.payloadJson);
    return (
      <SelectableCard
        selected={basket.has(q.id)}
        onToggle={() =>
          basket.has(q.id)
            ? basket.remove(q.id)
            : basket.add({
                artifactId: q.id,
                qid: q.qid ?? q.id,
                marks: q.marks ?? 0,
                label: text || q.qid || q.id,
                subject: q.subject,
                questionType: q.questionType,
                classLevel: q.classLevel,
              })
        }
        onPress={() => navigation.navigate("QuestionPreview", { id: q.id })}
      >
        {renderCardBody(q)}
      </SelectableCard>
    );
  }

  return (
    <Screen padded={false} bleed>
      {/* Sticky header — a SIBLING of the list, so it never scrolls away. */}
      <View style={{ paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(2), gap: space(2) }}>
        {addToSetId ? (
          <Card>
            <Muted>{STR.addingToSet}</Muted>
          </Card>
        ) : null}
        <SearchField value={qb.search} onSearch={qb.setSearch} />
        <FilterBar
          chips={chips}
          count={qb.activeCount}
          onRemove={(key) => qb.clearFilter(key as keyof QbFilters)}
          onOpen={() => setFilterOpen(true)}
        />
      </View>

      <QueryGate
        // While the accumulated window is empty and a fetch is in flight, force
        // the loader: urql keeps the PREVIOUS operation's data during the next
        // fetch, which would otherwise suppress the loader and render a blank
        // list for the whole flight after a search/filter reset.
        result={{
          data: qb.items.length > 0 ? qb.items : fetching ? undefined : data,
          fetching,
          error,
        }}
        onRetry={() => reexecute({ requestPolicy: "network-only" })}
        isEmpty={isEmpty}
        empty={
          nothingNarrowed && gatedToPublished ? (
            <EmptyState message={STR.qrUnpublishedBankNote} />
          ) : (
            <EmptyState
              message={STR.qbEmptyFiltered}
              action={<Button title={STR.qbClearFilters} variant="secondary" onPress={qb.clearAll} />}
            />
          )
        }
        loaderLabel={STR.loading}
      >
        <FlatList
          data={qb.items}
          keyExtractor={(q) => q.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space(4), paddingTop: space(2) }}
          ListFooterComponent={
            !qb.exhausted && qb.items.length > 0 ? (
              <Button
                title={STR.loadMore}
                variant="secondary"
                loading={loadingMore}
                onPress={qb.requestNextPage}
                style={{ marginTop: space(2) }}
              />
            ) : null
          }
        />
      </QueryGate>

      {!addToSetId ? (
        <SelectionTray
          count={basket.count}
          totalMarks={basket.totalMarks}
          examMinutes={basket.examMinutes}
          onCreate={() => setCreateOpen(true)}
          onClear={basket.clear}
        />
      ) : null}

      <FilterSheet
        visible={filterOpen}
        filters={qb.filters}
        onApply={qb.setFilters}
        onClose={() => setFilterOpen(false)}
      />

      <CreateSetSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onPickSection={() => {
          setCreateOpen(false);
          navigation.navigate("SectionPicker");
        }}
        onCreated={(setId) => {
          setCreateOpen(false);
          // initial: false puts SetList beneath SetDetail in the Sets stack, so
          // back returns to the list rather than escaping to the drawer.
          tabNav.navigate("SetsTab", { screen: "SetDetail", params: { setId }, initial: false });
        }}
      />
    </Screen>
  );
}
