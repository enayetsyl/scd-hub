/**
 * ReviewChangesList (RS-4) - the rounds where a reviewer asked for changes or approved with a
 * condition: a day picker (today / yesterday / 7 days), grouped by reviewer on the main screen and
 * flat on one reviewer's page. A row opens the existing plan review thread or question review
 * thread by the version's artifactId, when the caller may open that screen.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { REVIEW_CHANGES_QUERY, type ReviewChangeRoundT } from "../graphql/reviewSupervision";
import { useAuth } from "../auth/AuthContext";
import { Body, Muted, Card, Chip, ChipRow, Badge, EmptyState, H2, wrapRowText } from "./ui";
import { QueryGate } from "./QueryGate";
import { STR, bnNum, subjectLabel, classLevelLabel } from "../lib/labels";
import { addDaysKey, dateKey } from "../lib/dates";
import { hasRoute } from "../lib/hasRoute";
import { usePagedRows } from "../lib/paging";
import { Pager } from "./Pager";
import { fill } from "../lib/reviewSupervision";
import { space } from "../theme/tokens";

/** The server returns at most this many rounds (ReviewProgressService CHANGE_ROWS_MAX). */
const SERVER_CAP = 500;

type Range = "today" | "yesterday" | "week";

function rangeKeys(r: Range): { fromKey: string; toKey: string } {
  const today = dateKey();
  if (r === "today") return { fromKey: today, toKey: today };
  if (r === "yesterday") {
    const y = addDaysKey(today, -1);
    return { fromKey: y, toKey: y };
  }
  return { fromKey: addDaysKey(today, -6), toKey: today };
}

function rowTitle(r: ReviewChangeRoundT): string {
  const book = `${subjectLabel(r.subject)} · ${classLevelLabel(r.classLevel)} · ${r.anchorWord} ${bnNum(r.chapter)}`;
  if (r.isQuestion) return `${book} · ${STR.rspQuestions}`;
  return r.sessionIndex != null ? `${book} · ${STR.rspSession} ${bnNum(r.sessionIndex)}` : `${book} · ${STR.rspPlans}`;
}

export function ReviewChangesList({
  programId,
  batch,
  reviewerId,
  reloadKey = 0,
}: {
  programId: string;
  batch: number;
  /** Bump to refetch (the screen's pull-to-refresh). */
  reloadKey?: number;
  /** One reviewer's page passes her id (flat list); the main screen omits it (grouped by reviewer). */
  reviewerId?: string;
}): React.ReactElement {
  const { can } = useAuth();
  // The thread screens live in the Review stack; navigation here is the Review stack's own.
  const navigation = useNavigation<{ navigate: (route: string, params: unknown) => void; getState: () => { routeNames?: readonly string[] } | undefined }>();
  const [range, setRange] = useState<Range>("today");
  const keys = rangeKeys(range);
  const [q, refetch] = useQuery({
    query: REVIEW_CHANGES_QUERY,
    variables: { programId, batch, reviewerId: reviewerId ?? null, ...keys },
    requestPolicy: "cache-and-network",
  });
  const rows = q.data?.reviewChangeRounds ?? [];
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }, [reloadKey, refetch]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const canOpen = (r: ReviewChangeRoundT): boolean =>
    r.isQuestion
      ? can("question_review:view_all") && hasRoute(navigation, "QuestionReviewThread")
      : can("plan_review:assign") && hasRoute(navigation, "ReviewThread");
  const openRound = (r: ReviewChangeRoundT): void =>
    navigation.navigate(r.isQuestion ? "QuestionReviewThread" : "ReviewThread", { artifactId: r.artifactId });

  const groups = new Map<string, { name: string; rows: ReviewChangeRoundT[] }>();
  for (const r of rows) {
    const g = groups.get(r.reviewerId) ?? { name: r.reviewerName ?? "-", rows: [] };
    g.rows.push(r);
    groups.set(r.reviewerId, g);
  }

  const row = (r: ReviewChangeRoundT): React.ReactElement => {
    const body = (
      <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
          <Body style={[wrapRowText, { fontWeight: "700" }]}>{rowTitle(r)}</Body>
          <Badge
            text={r.verdict === "CHANGES_REQUESTED" ? STR.rspVerdictChanges : STR.rspVerdictCond}
            tone={r.verdict === "CHANGES_REQUESTED" ? "warn" : "info"}
          />
        </View>
        <Muted style={{ marginTop: 2 }}>{bnNum(r.dateKey)}</Muted>
        {r.feedback ? <Muted style={{ marginTop: 2 }}>{r.feedback}</Muted> : null}
      </>
    );
    return canOpen(r) ? (
      <Card key={r.assignmentId} onPress={() => openRound(r)}>{body}</Card>
    ) : (
      <Card key={r.assignmentId}>{body}</Card>
    );
  };

  const capped = rows.length >= SERVER_CAP;
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      <H2>{STR.rspChgSection}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rspChgHint}</Muted>
      <ChipRow>
        <Chip label={STR.rspChgToday} selected={range === "today"} onPress={() => setRange("today")} />
        <Chip label={STR.rspChgYesterday} selected={range === "yesterday"} onPress={() => setRange("yesterday")} />
        <Chip label={STR.rspChg7} selected={range === "week"} onPress={() => setRange("week")} />
      </ChipRow>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {rows.length === 0 ? (
          <EmptyState message={STR.rspChgNone} />
        ) : (
          <>
            {capped ? <Muted>{fill(STR.rspChgCap, { n: bnNum(SERVER_CAP) })}</Muted> : null}
            {reviewerId ? (
              <PagedRows rows={rows} render={row} resetKey={range} />
            ) : (
              [...groups.entries()].map(([id, g]) => (
                <View key={id} style={{ marginTop: space(2) }}>
                  <Pressable
                    onPress={() => toggle(id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open.has(id) }}
                    style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}
                  >
                    <Body style={[wrapRowText, { fontWeight: "700" }]}>
                      {g.name} ({bnNum(g.rows.length)})
                    </Body>
                    <Body style={{ fontWeight: "700" }}>{open.has(id) ? "▾" : "▸"}</Body>
                  </Pressable>
                  {open.has(id) ? <PagedRows rows={g.rows} render={row} resetKey={range} /> : null}
                </View>
              ))
            )}
          </>
        )}
      </QueryGate>
    </View>
  );
}

function PagedRows({
  rows,
  render,
  resetKey,
}: {
  rows: ReviewChangeRoundT[];
  render: (r: ReviewChangeRoundT) => React.ReactElement;
  resetKey: string;
}): React.ReactElement {
  const { shown, pager } = usePagedRows(rows, { resetKey });
  return (
    <>
      {shown.map(render)}
      <Pager {...pager} />
    </>
  );
}
