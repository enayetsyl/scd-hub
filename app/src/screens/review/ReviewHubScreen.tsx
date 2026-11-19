/**
 * ReviewHubScreen (H-1, .claude/plans/review-hub-and-quality.md) — "আমার পর্যালোচনা".
 *
 * ONE list of every review the caller still owes — plans, questions, exam papers, syllabus
 * sign-offs, objective lists, observations, class videos, class-test question requests, support
 * books, winter booklets and review cards on the work board — with the বাকি count and the due date
 * on each row. A tap opens the EXISTING screen where that review is done; nothing here changes how a
 * review is done. The server shows each group only when the caller holds that review's permission,
 * so this screen needs no permission checks of its own (apart from the two review buttons).
 *
 * Plans and questions are NOT listed as two flat groups any more (owner 19 Nov 2026,
 * .claude/plans/review-next-chunk.md). They are one ordered path: a card per BOOK, the chapters in
 * number order inside it (finished ones at the bottom), and a "পরের কাজ ▶" button at the top that
 * opens the first undecided item. "আরও কাজ দিন" takes the next chapters when the work is done.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import {
  MY_REVIEW_HUB,
  MY_REVIEW_MORE_STATUS,
  MY_REVIEW_PATH,
  REQUEST_MORE_REVIEW,
  type ReviewHubRowT,
  type ReviewMoreStatusT,
  type ReviewPathBookT,
} from "../../graphql/reviewHub";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Body, Button, Card, EmptyState, H2, Muted, Notice, Screen, wrapRowText } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum, dhakaDateKey, fullDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { chaptersLabel, openItemAction } from "../../lib/reviewPath";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme";

type LabelKey = keyof typeof STR;

/** The order the groups appear in: the long-running work first, the small desks after. PLAN and QUESTION
 *  are listed here only as a fallback — while the ordered path is available they are shown as book cards. */
const KIND_ORDER = [
  "PLAN",
  "QUESTION",
  "EXAM_PAPER",
  "SYLLABUS",
  "MASTERY",
  "OBSERVATION",
  "VIDEO",
  "CT_QUESTION",
  "BOOK",
  "WINTER",
  "TASK",
] as const;

const kindTitle = (kind: string): string => (STR[`rhKind${kind}` as LabelKey] as string | undefined) ?? kind;

type DueState = "overdue" | "today" | "later";
export function dueState(dueKey: string, todayKey: string): DueState {
  if (dueKey < todayKey) return "overdue";
  return dueKey === todayKey ? "today" : "later";
}

/** The one-line reason the "আরও কাজ দিন" button is off, or null when it is live. */
export function moreReasonText(s: ReviewMoreStatusT): string | null {
  if (s.canRequest) return null;
  if (s.reason === "STILL_OPEN") return STR.rpMoreStillOpen.replace("{n}", bnNum(s.leftPlans + s.leftQuestions));
  if (s.reason === "DAILY_CAP") return STR.rpMoreDailyCap;
  return STR.rpMoreNotEnabled;
}

/** Opens the screen a row names, the way a notification link does: root → tab → screen. */
function useOpenRow(): (row: ReviewHubRowT) => void {
  const nav = useNavigation();
  return useCallback(
    (row: ReviewHubRowT): void => {
      let params: Record<string, unknown> | undefined;
      try {
        params = row.paramsJson ? (JSON.parse(row.paramsJson) as Record<string, unknown>) : undefined;
      } catch {
        params = undefined;
      }
      // A row of the hub's OWN stack (ReviewHome, a queue) is PUSHED: navigate() would pop back down to
      // ReviewHome at index 0 and the hub would vanish from the Back path.
      if (row.tab === "ReviewTab") {
        nav.dispatch(StackActions.push(row.screen, params));
        return;
      }
      (nav as unknown as { navigate: (n: string, p?: object) => void }).navigate("App", {
        screen: row.tab,
        params: params ? { screen: row.screen, params, initial: false } : { screen: row.screen, initial: false },
      });
    },
    [nav],
  );
}

function HubRow({ row, todayKey, onOpen }: { row: ReviewHubRowT; todayKey: string; onOpen: (r: ReviewHubRowT) => void }): React.ReactElement {
  const due = row.dueKey ? dueState(row.dueKey, todayKey) : null;
  return (
    <Card onPress={() => onOpen(row)}>
      <Body style={{ fontWeight: "700" }}>{row.titleBn}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) }}>
        <Badge text={`${STR.rhLeft} ${bnNum(row.left)}${row.total > row.left ? ` / ${STR.rhOf} ${bnNum(row.total)}` : ""}`} tone="warn" />
        {row.dueKey && due ? (
          <Badge
            text={due === "overdue" ? STR.rhOverdue : due === "today" ? STR.rhDueToday : STR.rhDue}
            tone={due === "overdue" ? "danger" : due === "today" ? "warn" : "muted"}
          />
        ) : null}
      </View>
      {row.dueKey ? (
        <Muted style={{ marginTop: space(1) }}>
          {STR.rhDue}: {fullDateLabel(row.dueKey)}
        </Muted>
      ) : null}
    </Card>
  );
}

/** One book: its chapters in number order, the finished ones at the bottom. A chapter opens its own screen. */
function BookCard({
  book,
  todayKey,
  onOpenChapter,
}: {
  book: ReviewPathBookT;
  todayKey: string;
  onOpenChapter: (book: ReviewPathBookT, chapterKey: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <Body style={[wrapRowText, { fontWeight: "700" }]}>{book.titleBn}</Body>
        <Badge
          text={book.left === 0 ? STR.rpChapterDone : `${STR.rhLeft} ${bnNum(book.left)} / ${STR.rhOf} ${bnNum(book.total)}`}
          tone={book.left === 0 ? "ok" : "warn"}
        />
      </View>
      {book.chapters.map((c) => {
        const due = c.dueKey && !c.decided ? dueState(c.dueKey, todayKey) : null;
        return (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            onPress={() => onOpenChapter(book, c.key)}
            style={{ marginTop: space(2), paddingVertical: space(1) }}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
              <Body style={[wrapRowText, c.decided ? { opacity: 0.6 } : { fontWeight: "600" }]}>{c.labelBn} ›</Body>
              <Badge
                text={c.decided ? STR.rpChapterDone : `${STR.rhLeft} ${bnNum(c.left)} / ${STR.rhOf} ${bnNum(c.total)}`}
                tone={c.decided ? "ok" : "warn"}
              />
              {due ? (
                <Badge
                  text={due === "overdue" ? STR.rhOverdue : due === "today" ? STR.rhDueToday : STR.rhDue}
                  tone={due === "overdue" ? "danger" : due === "today" ? "warn" : "muted"}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}

export default function ReviewHubScreen(): React.ReactElement {
  const nav = useNavigation();
  const { can } = useAuth();
  const toast = useToast();
  const canPath = can("plan_review:review") || can("question_review:review");

  const [q, refetch] = useQuery({ query: MY_REVIEW_HUB, requestPolicy: "cache-and-network" });
  const [pathQ, refetchPath] = useQuery({ query: MY_REVIEW_PATH, requestPolicy: "cache-and-network", pause: !canPath });
  const [moreQ, refetchMore] = useQuery({ query: MY_REVIEW_MORE_STATUS, requestPolicy: "cache-and-network", pause: !canPath });
  const [moreRes, requestMore] = useMutation(REQUEST_MORE_REVIEW);
  const [moreMsg, setMoreMsg] = useState<{ text: string; tone: "ok" | "warn" | "danger" } | null>(null);
  const open = useOpenRow();

  const reloadAll = useCallback((): void => {
    refetch({ requestPolicy: "network-only" });
    if (canPath) {
      refetchPath({ requestPolicy: "network-only" });
      refetchMore({ requestPolicy: "network-only" });
    }
  }, [refetch, refetchPath, refetchMore, canPath]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reloadAll);

  // Coming back from a review: the counts must drop without a reload. Skip the first focus
  // (the queries above are already fetching).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reloadAll();
    }, [reloadAll]),
  );

  const rows = q.data?.myReviewHub.rows ?? [];
  const totalLeft = q.data?.myReviewHub.totalLeft ?? 0;
  const path = pathQ.data?.myReviewPath ?? null;
  const books = path?.books ?? [];
  const more = moreQ.data?.myReviewMoreStatus ?? null;
  const todayKey = dhakaDateKey();
  // While the ordered path is there, plans and questions are the book cards; without it (it failed to
  // load) the two flat groups stay as the fallback, so the hub never loses them.
  const pathShown = path != null;
  const groups = useMemo(
    () =>
      KIND_ORDER.filter((kind) => !(pathShown && (kind === "PLAN" || kind === "QUESTION")))
        .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
        .filter((g) => g.rows.length > 0),
    [rows, pathShown],
  );

  const openChapter = (book: ReviewPathBookT, chapterKey: string): void => {
    nav.dispatch(StackActions.push("ReviewChapter", { bookKey: book.key, chapterKey }));
  };

  async function onMore(): Promise<void> {
    if (moreRes.fetching) return;
    setMoreMsg(null);
    const res = await requestMore({});
    if (res.error) {
      setMoreMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    const r = res.data?.requestMoreReview;
    if (!r) return;
    if (r.outcome === "ADDED") {
      const text = STR.rpMoreAdded.replace("{word}", r.anchorWord ?? "").replace("{chapters}", chaptersLabel(r.chapters)).trim();
      toast.show(text, "ok");
      setMoreMsg({ text, tone: "ok" });
    } else if (r.outcome === "NOTHING_LEFT") {
      setMoreMsg({ text: STR.rpMoreNothingLeft, tone: "warn" });
    } else {
      setMoreMsg({ text: moreReasonText(r.status) ?? STR.rpMoreNotEnabled, tone: "warn" });
    }
    reloadAll();
  }

  const reason = more ? moreReasonText(more) : null;
  const nothingToShow = rows.length === 0 && books.length === 0;

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate
        result={q}
        onRetry={reloadAll}
        isEmpty={nothingToShow && !more}
        empty={<EmptyState message={STR.rhEmpty} />}
      >
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>
          {STR.rhTodayCard}: {bnNum(totalLeft)}
        </Body>
        <Muted style={{ marginBottom: space(3) }}>{STR.rhSubtitle}</Muted>

        {/* The next thing to do, in path order: the first undecided plan, or the next chapter's questions. */}
        {path?.next ? (
          <View style={{ marginBottom: space(3) }}>
            <Button title={STR.rpNext} onPress={() => nav.dispatch(openItemAction(path.next!.item, "push"))} />
            <Muted style={{ marginTop: space(1) }}>
              {STR.rpUpNext}: {path.next.bookTitleBn} · {path.next.chapterLabelBn} · {path.next.item.titleBn}
            </Muted>
          </View>
        ) : null}

        {/* Self-serve: take the next chapters when the current work is done. */}
        {canPath && more ? (
          <View style={{ marginBottom: space(3) }}>
            <Button title={STR.rpMore} onPress={() => void onMore()} loading={moreRes.fetching} disabled={!more.canRequest} variant="secondary" />
            <Muted style={{ marginTop: space(1) }}>{reason ?? STR.rpMoreHint}</Muted>
            {moreMsg ? <Notice message={moreMsg.text} tone={moreMsg.tone} /> : null}
          </View>
        ) : null}

        {books.length > 0 ? (
          <View style={{ marginBottom: space(3) }}>
            <H2>{STR.rpBooksTitle}</H2>
            <Muted style={{ marginBottom: space(2) }}>{STR.rpBooksHint}</Muted>
            {books.map((b) => (
              <BookCard key={b.key} book={b} todayKey={todayKey} onOpenChapter={openChapter} />
            ))}
          </View>
        ) : null}

        {groups.map((g) => {
          const left = g.rows.reduce((n, r) => n + r.left, 0);
          return (
            <View key={g.kind} style={{ marginBottom: space(3) }}>
              <H2>
                {kindTitle(g.kind)} · {bnNum(left)}
              </H2>
              {g.rows.map((r) => (
                <HubRow key={r.key} row={r} todayKey={todayKey} onOpen={open} />
              ))}
            </View>
          );
        })}
        {nothingToShow ? <EmptyState message={STR.rhEmpty} /> : null}
      </QueryGate>
    </Screen>
  );
}
