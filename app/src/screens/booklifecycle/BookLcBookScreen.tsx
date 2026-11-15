/**
 * S2 বই — the book page (docs/prd-book-lifecycle.md §8): header, reviewer's name (text; she has no
 * login), tabs সংস্করণ · মতামত · পর্যালোচনা · সিদ্ধান্ত · খসড়া · ইতিহাস. Actions per permission.
 */
import React, { useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BL_BOOK, BL_DECISIONS, BL_DRAFTS, BL_EVENTS, BL_OPEN_DECISION, BL_OPEN_ROUND, BL_ROUNDS, BL_RULE_DECISION, BL_UPDATE_BOOK, BL_VERSIONS } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { openStoredFile } from "../../lib/files";
import { pickBookLcFile, postBookLc } from "../../lib/bookLcFiles";
import { bnNum, classLevelLabel, subjectLabel } from "../../lib/labels";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL, LIST_STATUS_LABEL } from "./blStrings";
import { Line, SectionTitle, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcBook">;
type Tab = "versions" | "rounds" | "decisions" | "drafts" | "history";

export default function BookLcBookScreen({ navigation, route }: Props): React.ReactElement {
  const { bookId } = route.params;
  const { can } = useAuth();
  const manage = can("book_lifecycle:manage");
  const finalize = can("book_lifecycle:finalize");
  const aiEdit = can("book_lifecycle:ai_edit");
  const [tab, setTab] = useState<Tab>("versions");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tab]);
  const [bq, refetchBook] = useQuery({ query: BL_BOOK, variables: { id: bookId }, requestPolicy: "cache-and-network" });
  const [vq, refetchV] = useQuery({ query: BL_VERSIONS, variables: { bookId, page, pageSize: 20 }, pause: tab !== "versions" });
  const [rq, refetchR] = useQuery({ query: BL_ROUNDS, variables: { bookId, page, pageSize: 20 }, pause: tab !== "rounds" });
  const [dq, refetchD] = useQuery({ query: BL_DECISIONS, variables: { bookId, page, pageSize: 30 }, pause: tab !== "decisions" });
  const [drq, refetchDr] = useQuery({ query: BL_DRAFTS, variables: { bookId, page, pageSize: 20 }, pause: tab !== "drafts" });
  const [eq] = useQuery({ query: BL_EVENTS, variables: { bookId, page, pageSize: 40 }, pause: tab !== "history" });
  const [, updateBook] = useMutation(BL_UPDATE_BOOK);
  const [{ fetching: opening }, openRound] = useMutation(BL_OPEN_ROUND);
  const [, openDecision] = useMutation(BL_OPEN_DECISION);
  const [, ruleDecision] = useMutation(BL_RULE_DECISION);
  const [msg, setMsg] = useMsg();
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [recommended, setRecommended] = useState("");
  const refresh = (): void => {
    refetchBook({ requestPolicy: "network-only" });
    refetchV({ requestPolicy: "network-only" });
    refetchR({ requestPolicy: "network-only" });
    refetchD({ requestPolicy: "network-only" });
    refetchDr({ requestPolicy: "network-only" });
  };
  const pull = usePullRefresh(bq.fetching, refresh);
  const book = bq.data?.bookLcBook;

  const uploadVersion = async (): Promise<void> => {
    const master = await pickBookLcFile("md");
    if (!master) return;
    setBusy(true);
    try {
      const r = await postBookLc<{ draftId: string }>("upload-version", { bookId }, { master });
      navigation.navigate("BookLcDraft", { draftId: r.draftId });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <QueryGate result={bq} onRetry={refresh}>
        {book ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {book.titleBn} · {book.code}
              </Body>
              <Muted>
                {classLevelLabel(book.classLevel)} · {subjectLabel(book.subject)} · {book.editions.join(", ")}
              </Muted>
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                <Badge text={LIST_STATUS_LABEL(book.listStatus)} tone="info" />
                {book.roundOverdue ? <Badge text={BL.overdue} tone="danger" /> : null}
              </View>
              {manage ? (
                <View style={{ marginTop: space(3) }}>
                  <Field label={BL.reviewerName} value={reviewer ?? book.reviewerName ?? ""} onChangeText={setReviewer} autoCapitalize="words" helper={BL.reviewerNoLogin} />
                  {reviewer !== null ? (
                    <Button
                      title={BL.saveReviewer}
                      variant="secondary"
                      onPress={() =>
                        void updateBook({ id: bookId, reviewerName: reviewer }).then((r) => (r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : (setReviewer(null), setMsg({ tone: "ok", text: BL.saved }))))
                      }
                    />
                  ) : null}
                </View>
              ) : (
                <Line label={BL.reviewerName} value={book.reviewerName ?? "—"} />
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
                <Button title={`${BL.tabFeedback} (${bnNum(book.openFeedback)})`} variant="secondary" onPress={() => navigation.navigate("BookLcFeedback", { bookId })} />
                <Button title={BL.printTitle} variant="secondary" onPress={() => navigation.navigate("BookLcRelease", { bookId })} />
                {manage ? <Button title={BL.uploadNewVersion} variant="secondary" loading={busy} onPress={() => void uploadVersion()} /> : null}
                {manage ? <Button title={BL.bundleOpen} variant="secondary" onPress={() => navigation.navigate("BookLcBundle", { bookId })} /> : null}
                {aiEdit && manage ? <Button title={BL.aiEditOpen} variant="secondary" onPress={() => navigation.navigate("BookLcAiEdit", { bookId })} /> : null}
                {manage && book.openRoundId ? <Button title={`${BL.openRound} ${bnNum(book.openRoundMemoNo ?? 0)}`} onPress={() => navigation.navigate("BookLcRound", { roundId: book.openRoundId! })} /> : null}
                {manage && !book.openRoundId && book.latest?.status === "draft" ? (
                  <Button
                    title={BL.openNewRound}
                    loading={opening}
                    onPress={() =>
                      void openRound({ bookId }).then((r) =>
                        r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : navigation.navigate("BookLcRound", { roundId: r.data!.openBookLcRound.id }),
                      )
                    }
                  />
                ) : null}
              </View>
              {book.historyFiles.length ? (
                <View style={{ marginTop: space(3) }}>
                  <Muted>{BL.historyFiles}</Muted>
                  {book.historyFiles.map((h) => (
                    <Button key={h.fileId} title={h.label} variant="ghost" onPress={() => void openStoredFile(h.fileId)} />
                  ))}
                </View>
              ) : null}
            </Card>
            {msg}
            <ChipRow>
              {(
                [
                  ["versions", BL.tabVersions],
                  ["rounds", BL.tabRounds],
                  ["decisions", BL.tabDecisions],
                  ["drafts", BL.tabDrafts],
                  ["history", BL.tabHistory],
                ] as [Tab, string][]
              ).map(([k, l]) => (
                <Chip key={k} label={l} selected={tab === k} onPress={() => setTab(k)} />
              ))}
            </ChipRow>

            {tab === "versions" ? (
              <QueryGate result={vq} onRetry={refresh} isEmpty={!vq.data?.bookLcVersionsPage.rows.length} empty={<EmptyState message="—" />}>
                {vq.data?.bookLcVersionsPage.rows.map((v) => (
                  <Card key={v.id} onPress={() => navigation.navigate("BookLcVersion", { versionId: v.id })} style={{ marginTop: space(2) }}>
                    <Body style={{ fontWeight: "700" }}>
                      {v.labelBn} — {v.statusBn}
                    </Body>
                    <Muted>{v.changeSummaryBn || "—"}</Muted>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
                      {v.reviewSkippedAt ? <Badge text={BL.stampSkipped} tone="warn" /> : null}
                      {v.selfReviewed ? <Badge text={BL.stampSelf} tone="muted" /> : null}
                      {v.importedAt ? <Badge text={BL.stampImported} tone="muted" /> : null}
                      {v.recordedFromPaperName ? <Badge text={`${BL.stampPaper} — ${v.recordedFromPaperName}`} tone="info" /> : null}
                      <Muted>{ymd(v.createdAt)}</Muted>
                    </View>
                  </Card>
                ))}
                {vq.data ? <Pager {...vq.data.bookLcVersionsPage} onPage={setPage} /> : null}
              </QueryGate>
            ) : null}

            {tab === "rounds" ? (
              <QueryGate result={rq} onRetry={refresh} isEmpty={!rq.data?.bookLcRoundsPage.rows.length} empty={<EmptyState message={BL.noRounds} />}>
                {rq.data?.bookLcRoundsPage.rows.map((r) => (
                  <Card key={r.id} onPress={() => navigation.navigate("BookLcRound", { roundId: r.id })} style={{ marginTop: space(2) }}>
                    <Body style={{ fontWeight: "700" }}>
                      {BL.memo} {bnNum(r.memoNo)} · {r.versionLabel} · {r.reviewerName}
                    </Body>
                    <Muted>
                      {r.status} {r.sentOnPaperAt ? `· ${ymd(r.sentOnPaperAt)}` : ""} {r.verdict ? `· ${r.verdict === "approve" ? BL.verdictApprove : BL.verdictChanges}` : ""}
                    </Muted>
                    {r.overdue ? <Badge text={BL.overdue} tone="danger" /> : null}
                  </Card>
                ))}
                {rq.data ? <Pager {...rq.data.bookLcRoundsPage} onPage={setPage} /> : null}
              </QueryGate>
            ) : null}

            {tab === "decisions" ? (
              <View>
                {manage ? (
                  <Card style={{ marginTop: space(2) }}>
                    <Field label={BL.question} value={question} onChangeText={setQuestion} multiline autoCapitalize="sentences" />
                    <Field label={BL.options} value={options} onChangeText={setOptions} multiline autoCapitalize="sentences" />
                    <Field label={BL.recommended} value={recommended} onChangeText={setRecommended} keyboardType="number-pad" />
                    <Button
                      title={BL.openDecision}
                      onPress={() =>
                        void openDecision({ bookId, questionBn: question, options: options.split("\n").map((o) => o.trim()).filter(Boolean), recommendedIndex: recommended ? Number(recommended) - 1 : null }).then((r) =>
                          r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : (setQuestion(""), setOptions(""), setRecommended(""), refetchD({ requestPolicy: "network-only" })),
                        )
                      }
                    />
                  </Card>
                ) : null}
                <QueryGate result={dq} onRetry={refresh} isEmpty={!dq.data?.bookLcDecisionsPage.rows.length} empty={<EmptyState message={BL.noDecisions} />}>
                  {dq.data?.bookLcDecisionsPage.rows.map((d) => (
                    <Card key={d.id} style={{ marginTop: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>
                        {d.code} — {d.questionBn}
                      </Body>
                      {d.options.map((o) => (
                        <Muted key={o.key}>
                          {d.rulingOptionKey === o.key ? "☑" : "☐"} {o.key}) {o.textBn} {d.recommendedKey === o.key ? "★" : ""}
                        </Muted>
                      ))}
                      {d.status === "ruled" ? (
                        <Line label={BL.ruledBy} value={`${d.rulingBy ?? ""}${d.rulingFromPaper ? ` · ${BL.stampPaper}` : ""}${d.selfRuled ? ` · ${BL.stampSelf}` : ""} · ${ymd(d.rulingAt)}`} />
                      ) : finalize ? (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                          {d.options.map((o) => (
                            <Button key={o.key} title={`${BL.ruleSelf}: ${o.key}`} variant="ghost" onPress={() => void ruleDecision({ decisionId: d.id, optionKey: o.key }).then(() => refetchD({ requestPolicy: "network-only" }))} />
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  ))}
                  {dq.data ? <Pager {...dq.data.bookLcDecisionsPage} onPage={setPage} /> : null}
                </QueryGate>
              </View>
            ) : null}

            {tab === "drafts" ? (
              <QueryGate result={drq} onRetry={refresh} isEmpty={!drq.data?.bookLcDraftsPage.rows.length} empty={<EmptyState message={BL.noDrafts} />}>
                {drq.data?.bookLcDraftsPage.rows.map((d) => (
                  <Card key={d.id} onPress={() => navigation.navigate("BookLcDraft", { draftId: d.id })} style={{ marginTop: space(2) }}>
                    <Body style={{ fontWeight: "700" }}>
                      {d.baseLabel} · {d.source} · {d.status}
                    </Body>
                    <Muted>{ymd(d.createdAt)}</Muted>
                  </Card>
                ))}
                {drq.data ? <Pager {...drq.data.bookLcDraftsPage} onPage={setPage} /> : null}
              </QueryGate>
            ) : null}

            {tab === "history" ? (
              <QueryGate result={eq} onRetry={refresh} isEmpty={!eq.data?.bookLcEventsPage.rows.length} empty={<EmptyState message={BL.noEvents} />}>
                <SectionTitle>{BL.tabHistory}</SectionTitle>
                {eq.data?.bookLcEventsPage.rows.map((e, i) => (
                  <Muted key={i}>
                    {ymd(e.at)} · {e.actorName ?? "—"}
                    {e.origin === "claude" ? " (Claude)" : ""} · {e.summary}
                  </Muted>
                ))}
                {eq.data ? <Pager {...eq.data.bookLcEventsPage} onPage={setPage} /> : null}
              </QueryGate>
            ) : null}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
