/**
 * ReviewSelfServeScreen (.claude/plans/review-next-chunk.md, Slice B) - the Principal's settings for
 * "আরও কাজ দিন": how many chapters a request gives, when a reviewer may ask (plans left / percent of
 * questions left), how many requests a day, and each reviewer's LADDER - the books they walk through,
 * in order (reorder / add / remove). Reads need review_program:supervise; every write needs
 * review_program:manage and is re-gated on the server, so the edit controls are a courtesy.
 *
 * Mobile width: every row wraps, nothing is a fixed-width line, so it holds at ~360 dp.
 */
import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  REVIEW_SELF_SERVE_QUERY,
  SET_REVIEW_LADDER,
  UPDATE_REVIEW_SELF_SERVE,
  type ReviewLadderBookT,
  type ReviewSelfServeT,
} from "../../graphql/reviewHub";
import type { ReviewStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, H2, Muted, Screen, wrapRowText } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSelfServe">;
type LadderRow = ReviewSelfServeT["ladders"][number];

const bookKey = (b: Pick<ReviewLadderBookT, "subject" | "classLevel" | "anchorWord">): string => `${b.subject}|${b.classLevel}|${b.anchorWord}`;
const toInput = (b: ReviewLadderBookT) => ({ subject: b.subject, classLevel: b.classLevel, anchorWord: b.anchorWord });

/** A small text action (up / down / remove) with a real touch target that still wraps on a narrow row. */
function MiniAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{ paddingVertical: space(1), paddingHorizontal: space(2), opacity: disabled ? 0.35 : 1 }}
    >
      <Body style={{ color: colors.primary, fontWeight: "700" }}>{label}</Body>
    </Pressable>
  );
}

export default function ReviewSelfServeScreen({ route }: Props): React.ReactElement {
  const { programId } = route.params;
  const { can } = useAuth();
  const canManage = can("review_program:manage");
  const toast = useToast();

  const [q, refetch] = useQuery({ query: REVIEW_SELF_SERVE_QUERY, variables: { programId }, requestPolicy: "cache-and-network" });
  const [, updateSettings] = useMutation(UPDATE_REVIEW_SELF_SERVE);
  const [, setLadder] = useMutation(SET_REVIEW_LADDER);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const data = q.data?.reviewSelfServe ?? null;

  // The four numbers are edited as text and sent on Save.
  const [enabled, setEnabled] = useState(true);
  const [chunk, setChunk] = useState("");
  const [plansLeft, setPlansLeft] = useState("");
  const [pct, setPct] = useState("");
  const [perDay, setPerDay] = useState("");
  const [saving, setSaving] = useState(false);
  const s = data?.settings;
  useEffect(() => {
    if (!s) return;
    setEnabled(s.enabled);
    setChunk(String(s.chunkChapters));
    setPlansLeft(String(s.releasePlansLeft));
    setPct(String(s.releaseQuestionsPct));
    setPerDay(String(s.maxRequestsPerDay));
  }, [s?.enabled, s?.chunkChapters, s?.releasePlansLeft, s?.releaseQuestionsPct, s?.maxRequestsPerDay]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSettings(): Promise<void> {
    if (saving) return;
    setSaving(true);
    const res = await updateSettings({
      programId,
      enabled,
      chunkChapters: Number(chunk),
      releasePlansLeft: Number(plansLeft),
      releaseQuestionsPct: Number(pct),
      maxRequestsPerDay: Number(perDay),
    });
    setSaving(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rssSaved, "ok");
    refetch({ requestPolicy: "network-only" });
  }

  async function saveLadder(reviewerId: string, books: ReviewLadderBookT[] | null): Promise<void> {
    const res = await setLadder({ programId, reviewerId, books: books ? books.map(toInput) : null });
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.rssLadderSaved, "ok");
    refetch({ requestPolicy: "network-only" });
  }

  const [pickFor, setPickFor] = useState<string | null>(null);

  function move(row: LadderRow, index: number, by: -1 | 1): void {
    const next = [...row.books];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as ReviewLadderBookT, next[index] as ReviewLadderBookT];
    void saveLadder(row.reviewerId, next);
  }

  function candidatesFor(row: LadderRow): ReviewLadderBookT[] {
    const have = new Set(row.books.map(bookKey));
    const subject = row.books[0]?.subject;
    // The same subject first-class: a ladder is "this subject, class after class".
    return (data?.availableBooks ?? []).filter((b) => !have.has(bookKey(b)) && (!subject || b.subject === subject)).slice(0, 40);
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={!data} empty={<EmptyState message={STR.rspNoProgram} />}>
        {data ? (
          <>
            <Muted style={{ marginBottom: space(3) }}>{STR.rssSubtitle}</Muted>
            <Card>
              <ChipRow>
                <Chip label={STR.rssEnabled} selected={enabled} onPress={() => canManage && setEnabled(!enabled)} />
              </ChipRow>
              <Field label={STR.rssChunk} value={chunk} onChangeText={setChunk} keyboardType="number-pad" editable={canManage} />
              <Field label={STR.rssPlansLeft} value={plansLeft} onChangeText={setPlansLeft} keyboardType="number-pad" editable={canManage} />
              <Field label={STR.rssQuestionsPct} value={pct} onChangeText={setPct} keyboardType="number-pad" editable={canManage} />
              <Field label={STR.rssPerDay} value={perDay} onChangeText={setPerDay} keyboardType="number-pad" editable={canManage} />
              {canManage ? <Button title={STR.rssSave} onPress={() => void saveSettings()} loading={saving} /> : null}
            </Card>

            <H2>{STR.rssLadders}</H2>
            <Muted style={{ marginBottom: space(2) }}>{STR.rssLaddersHint}</Muted>
            {data.ladders.length === 0 ? <EmptyState message={STR.rspNoReviewers} /> : null}
            {data.ladders.map((row) => (
              <Card key={row.reviewerId}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                  <Body style={[wrapRowText, { fontWeight: "700" }]}>{row.reviewerName ?? "-"}</Body>
                  <Badge text={row.custom ? STR.rssCustom : STR.rssDefault} tone={row.custom ? "info" : "muted"} />
                </View>
                {row.books.length === 0 ? <Muted style={{ marginTop: space(2) }}>{STR.rssNoBooks}</Muted> : null}
                {row.books.map((b, i) => (
                  <View key={bookKey(b)} style={{ marginTop: space(2) }}>
                    <Body>
                      {bnNum(i + 1)}. {b.labelBn}
                    </Body>
                    {canManage ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                        <MiniAction label={`↑ ${STR.rssUp}`} onPress={() => move(row, i, -1)} disabled={i === 0} />
                        <MiniAction label={`↓ ${STR.rssDown}`} onPress={() => move(row, i, 1)} disabled={i === row.books.length - 1} />
                        <MiniAction label={`✕ ${STR.rssRemove}`} onPress={() => void saveLadder(row.reviewerId, row.books.filter((x) => bookKey(x) !== bookKey(b)))} />
                      </View>
                    ) : null}
                  </View>
                ))}
                {canManage ? (
                  <View style={{ marginTop: space(2) }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                      <Button
                        title={STR.rssAddBook}
                        variant="secondary"
                        onPress={() => setPickFor(pickFor === row.reviewerId ? null : row.reviewerId)}
                      />
                      {row.custom ? <Button title={STR.rssReset} variant="ghost" onPress={() => void saveLadder(row.reviewerId, null)} /> : null}
                    </View>
                    {pickFor === row.reviewerId ? (
                      <View style={{ marginTop: space(2) }}>
                        <Muted>{STR.rssBookPick}</Muted>
                        {candidatesFor(row).length === 0 ? <Muted>{STR.rssNoMoreBooks}</Muted> : null}
                        {candidatesFor(row).map((b) => (
                          <Pressable
                            key={bookKey(b)}
                            accessibilityRole="button"
                            style={{ paddingVertical: space(2) }}
                            onPress={() => {
                              setPickFor(null);
                              void saveLadder(row.reviewerId, [...row.books, b]);
                            }}
                          >
                            <Body>+ {b.labelBn}</Body>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
