/**
 * PublishQuestionsScreen (QR-4, Q4.3/Q4.4) — the Principal's two lists.
 *
 *   Accepted (verdict=APPROVE)          → multi-select → Publish. This is the normal path.
 *   Rejected (verdict=CHANGES_REQUESTED) → each with the reviewer's reason (often absent,
 *                                          since it is optional) → "Publish anyway", which
 *                                          opens a MANDATORY reason box.
 *
 * The two paths differ on purpose: bulk publish carries no override reason, because an
 * override is a per-question judgement and must be written down each time (Q2.9/Q2.10).
 * Publishing is Principal-locked server-side (content:promote_gold); Office reaching this
 * screen simply gets a denial, which the ErrorBanner shows in Bangla.
 */
import React, { useState, useCallback } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  QUESTION_REVIEW_INBOX,
  PUBLISH_QUESTION,
  PUBLISH_QUESTION_BULK,
  type QuestionReviewRoundT,
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
import { STR, subjectLabel, classLevelLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "PublishQuestions">;
type Tab = "APPROVE" | "CHANGES_REQUESTED";

export default function PublishQuestionsScreen({ navigation }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>("APPROVE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTION_REVIEW_INBOX,
    variables: { verdict: tab },
  });
  const [, publishOne] = useMutation(PUBLISH_QUESTION);
  const [, publishBulk] = useMutation(PUBLISH_QUESTION_BULK);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const rounds = data?.questionReviewInbox ?? [];

  function switchTab(next: Tab): void {
    setTab(next);
    setSelected(new Set());
    setOverrideFor(null);
    setOverrideReason("");
    setNotice(null);
    setFailure(null);
  }

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function publishSelected(): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setFailure(null);
    const res = await publishBulk({ artifactIds: [...selected] });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    const r = res.data?.publishQuestionBulk;
    setNotice(
      r && r.failedCount > 0
        ? `${STR.qrPublished} (${bnNum(r.okCount)} ✓, ${bnNum(r.failedCount)} ✗)`
        : STR.qrPublished,
    );
    setSelected(new Set());
    refetch({ requestPolicy: "network-only" });
  }

  async function publishWithOverride(round: QuestionReviewRoundT): Promise<void> {
    const trimmed = overrideReason.trim();
    if (trimmed === "") {
      setFailure(STR.qrOverrideRequired);
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await publishOne({ artifactId: round.artifactId, overrideReason: trimmed });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setOverrideFor(null);
    setOverrideReason("");
    setNotice(STR.qrPublished);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && rounds.length === 0) return <Loader />;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl refreshing={fetching} onRefresh={() => refetch({ requestPolicy: "network-only" })} />
        }
      >
        <H2>{STR.qrPublishTitle}</H2>
        {error ? <ErrorBanner message={friendlyError(error)} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        <ChipRow>
          <Chip label={STR.qrAccepted} selected={tab === "APPROVE"} onPress={() => switchTab("APPROVE")} />
          <Chip
            label={STR.qrRejected}
            selected={tab === "CHANGES_REQUESTED"}
            onPress={() => switchTab("CHANGES_REQUESTED")}
          />
        </ChipRow>

        {tab === "APPROVE" && rounds.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
            <Muted>{`${bnNum(selected.size)} ${STR.qrSelected}`}</Muted>
            <Button
              title={STR.qrPublishSelected}
              loading={busy}
              disabled={selected.size === 0}
              onPress={() => void publishSelected()}
            />
          </View>
        ) : null}

        <Divider />

        {rounds.length === 0 ? (
          <EmptyState message={tab === "APPROVE" ? STR.qrNoAccepted : STR.qrNoRejected} />
        ) : (
          rounds.map((round) => {
            const isSelected = selected.has(round.artifactId);
            const overrideOpen = overrideFor === round.id;
            return (
              <Card key={round.id} style={{ marginBottom: space(3) }}>
                <Pressable
                  onPress={() => (tab === "APPROVE" ? toggle(round.artifactId) : undefined)}
                  disabled={tab !== "APPROVE"}
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                    {tab === "APPROVE" ? (
                      <Badge text={isSelected ? "✓" : "○"} tone={isSelected ? "ok" : "muted"} />
                    ) : null}
                    <Badge text={subjectLabel(round.subject)} />
                    <Badge text={classLevelLabel(round.classLevel)} />
                    {round.reviewerName ? <Badge text={round.reviewerName} /> : null}
                  </View>
                  <Body>{round.questionText ?? round.qid ?? "—"}</Body>
                  {round.qid ? <Muted>{round.qid}</Muted> : null}
                </Pressable>

                {tab === "CHANGES_REQUESTED" ? (
                  <>
                    {/* The reason is optional, so its absence is normal and must read as
                        "none given" rather than looking like a loading state. */}
                    <Muted>
                      {STR.qrReason}: {round.reason && round.reason.trim() !== "" ? round.reason : "—"}
                    </Muted>
                    <Divider />
                    {overrideOpen ? (
                      <View>
                        <Field
                          label={STR.qrOverrideReason}
                          value={overrideReason}
                          onChangeText={setOverrideReason}
                          multiline
                        />
                        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                          <Button
                            title={STR.qrPublish}
                            loading={busy}
                            disabled={overrideReason.trim() === ""}
                            onPress={() => void publishWithOverride(round)}
                          />
                          <Button
                            title={STR.cancel}
                            variant="ghost"
                            onPress={() => {
                              setOverrideFor(null);
                              setOverrideReason("");
                            }}
                          />
                        </View>
                      </View>
                    ) : (
                      <Button
                        title={STR.qrPublishAnyway}
                        variant="secondary"
                        onPress={() => {
                          setOverrideFor(round.id);
                          setOverrideReason("");
                        }}
                      />
                    )}
                  </>
                ) : null}

                <Button
                  title={STR.reviewThread}
                  variant="ghost"
                  onPress={() => navigation.navigate("QuestionReviewThread", { artifactId: round.artifactId })}
                />
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
