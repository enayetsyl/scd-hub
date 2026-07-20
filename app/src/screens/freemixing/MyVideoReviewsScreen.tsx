/**
 * MyVideoReviewsScreen (owner ask 2026-07-20) — the teacher's assigned class-video
 * list. Each card: session context + the YouTube link, then the verdict — ঠিক আছে
 * (one confirmed tap, nothing else to do) or সমস্যা আছে (opens a mandatory comment
 * box). Completed cards show the verdict read-only. Server re-gates everything
 * (observation:review + assigned-teacher row gate).
 */
import React, { useState } from "react";
import { Linking, ScrollView, View, RefreshControl } from "react-native";
import { useQuery, useMutation } from "urql";
import { MY_VIDEO_REVIEWS, REVIEW_VIDEO } from "../../graphql/videoReview";
import { Screen, Body, Muted, Card, Badge, Button, Field, Notice, Loader, EmptyState } from "../../components/ui";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

function statusBadge(status: string): { text: string; tone: "warn" | "ok" | "danger" } {
  if (status === "PENDING") return { text: STR.vrStatusPending, tone: "warn" };
  if (status === "OK") return { text: STR.vrStatusOk, tone: "ok" };
  return { text: STR.vrStatusNotOk, tone: "danger" };
}

export default function MyVideoReviewsScreen(): React.ReactElement {
  const [{ data, fetching }, refetch] = useQuery({ query: MY_VIDEO_REVIEWS });
  const [, review] = useMutation(REVIEW_VIDEO);
  const { confirmAction } = useConfirm();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rows = data?.myVideoReviews ?? [];
  const { refreshing, onRefresh } = usePullRefresh(fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );

  async function submit(id: string, verdictOk: boolean, text?: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await review({ id, ok: verdictOk, comment: text ?? null });
    setBusyId(null);
    if (res.error || !res.data?.reviewVideo) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(verdictOk ? STR.vrStatusOk : STR.vrStatusNotOk);
    setCommentFor(null);
    setComment("");
    refetch({ requestPolicy: "network-only" });
  }

  async function onOk(id: string): Promise<void> {
    if (!(await confirmAction({ title: STR.vrOkConfirmTitle, message: STR.vrOkConfirmBody, confirmLabel: STR.vrOk }))) {
      return;
    }
    await submit(id, true);
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {fetching && rows.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.vrNoVideos} />
        ) : (
          rows.map((r) => {
            const badge = statusBadge(r.status);
            const commenting = commentFor === r.id;
            return (
              <Card key={r.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                    {bnNum(r.classDate)} · {r.classLabel}
                  </Body>
                  <Badge text={badge.text} tone={badge.tone} />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {STR.vrTime}: {r.timeLabel} · {STR.vrRoom}: {r.room}
                </Muted>
                <View style={{ marginTop: space(2) }}>
                  <Button title={`▶ ${STR.vrOpenVideo}`} variant="secondary" onPress={() => Linking.openURL(r.youtubeUrl)} />
                </View>

                {r.status === "PENDING" ? (
                  <>
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={STR.vrOk}
                          onPress={() => void onOk(r.id)}
                          loading={busyId === r.id && !commenting}
                          disabled={busyId !== null}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={STR.vrNotOk}
                          variant="danger"
                          onPress={() => {
                            setCommentFor(commenting ? null : r.id);
                            setComment("");
                          }}
                          disabled={busyId !== null}
                        />
                      </View>
                    </View>
                    {commenting ? (
                      <View style={{ marginTop: space(2) }}>
                        <Field label={STR.vrCommentLabel} value={comment} onChangeText={setComment} multiline />
                        <Button
                          title={STR.vrSubmitComment}
                          onPress={() => void submit(r.id, false, comment)}
                          loading={busyId === r.id}
                          disabled={busyId !== null || comment.trim() === ""}
                          style={{ marginTop: space(1) }}
                        />
                      </View>
                    ) : null}
                  </>
                ) : r.comment ? (
                  <Muted style={{ marginTop: space(2) }}>💬 {r.comment}</Muted>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
