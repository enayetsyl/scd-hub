/**
 * ReviewChapterScreen (.claude/plans/review-next-chunk.md) - one chapter of the reviewer's ordered
 * path: the chapter plan, then the session plans, then "এই অধ্যায়ের প্রশ্ন". Each row opens the
 * EXISTING screen where that review is done (the plan form, or the question queue already narrowed to
 * this chapter); nothing here changes how a review is done. "পরের কাজ ▶" opens the first item of this
 * chapter that still needs a verdict.
 */
import React, { useCallback, useMemo, useRef } from "react";
import { RefreshControl, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StackActions, useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_REVIEW_PATH, type ReviewPathItemT } from "../../graphql/reviewHub";
import type { ReviewStackParamList } from "../../navigation/types";
import { Badge, Body, Button, Card, EmptyState, H2, Muted, Screen, wrapRowText } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { itemParams, openItemAction } from "../../lib/reviewPath";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewChapter">;

export default function ReviewChapterScreen({ navigation, route }: Props): React.ReactElement {
  const { bookKey, chapterKey } = route.params;
  const [q, refetch] = useQuery({ query: MY_REVIEW_PATH, requestPolicy: "cache-and-network" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));

  // Coming back from a review the counts must drop without a reload (skip the first focus: the query is already fetching).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const book = q.data?.myReviewPath?.books.find((b) => b.key === bookKey) ?? null;
  const chapter = book?.chapters.find((c) => c.key === chapterKey) ?? null;
  const nextItem = useMemo(() => chapter?.items.find((i) => i.left > 0) ?? null, [chapter]);

  const open = (item: ReviewPathItemT): void => {
    // Keep this chapter on the Back path: PUSH, never navigate().
    navigation.dispatch(StackActions.push(item.screen, itemParams(item)));
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate
        result={q}
        onRetry={() => refetch({ requestPolicy: "network-only" })}
        isEmpty={!chapter}
        empty={<EmptyState message={STR.rpChapterGone} />}
      >
        {book && chapter ? (
          <>
            <H2>{chapter.labelBn}</H2>
            <Muted style={{ marginBottom: space(2) }}>{book.titleBn}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginBottom: space(3) }}>
              <Badge
                text={chapter.decided ? STR.rpChapterDone : `${STR.rhLeft} ${bnNum(chapter.left)} / ${STR.rhOf} ${bnNum(chapter.total)}`}
                tone={chapter.decided ? "ok" : "warn"}
              />
              {chapter.dueKey ? <Badge text={`${STR.rhDue}: ${fullDateLabel(chapter.dueKey)}`} tone="muted" /> : null}
            </View>
            {nextItem ? (
              <View style={{ marginBottom: space(3) }}>
                <Button title={STR.rpNext} onPress={() => navigation.dispatch(openItemAction(nextItem, "push"))} />
              </View>
            ) : null}
            {chapter.items.map((item) => (
              <Card key={item.key} onPress={() => open(item)}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                  <Body style={[wrapRowText, { fontWeight: "700" }]}>{item.titleBn}</Body>
                  <Badge
                    text={item.decided ? STR.rpReviewed : `${STR.rhLeft} ${bnNum(item.left)}${item.total > item.left ? ` / ${STR.rhOf} ${bnNum(item.total)}` : ""}`}
                    tone={item.decided ? "ok" : "warn"}
                  />
                </View>
              </Card>
            ))}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
