/**
 * S4 স্মারক ও ছাপার প্যাকেট + S7 ফেরত কপি লিপিবদ্ধ (docs/prd-book-lifecycle.md §8, §10; owner Q1).
 *
 * The reviewer works ON PAPER: build the memo → confirm chapter start pages → make the packet (memo
 * PDF + book PDF) → print → "কাগজে পাঠানো হয়েছে". When her marked copy returns: scans (≥ 1), her marks
 * and new points with the scan page, a "স্ক্যানের সাথে মিলিয়েছি" tick on every row, then her verdict
 * recorded on her behalf (finalize). Everything is stamped "কাগজের কপি থেকে লেখা".
 */
import React, { useMemo, useState } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_FEEDBACK_CATEGORIES, BOOK_FEEDBACK_CATEGORY_BN, type BookFeedbackCategory } from "@scd/shared";
import {
  BL_ADD_POINTS,
  BL_CHECK_ROW,
  BL_DECISIONS,
  BL_DECISION_MARKS,
  BL_DETECT_PAGES,
  BL_FEEDBACK,
  BL_ITEM_MARKS,
  BL_MAKE_PACKET,
  BL_MARK_SENT,
  BL_RECORD_RETURN,
  BL_ROUND,
  BL_SET_PAGES,
  BL_UPDATE_ROUND,
  BL_WITHDRAW,
  type BlMarkT,
  type BlRoundT,
} from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Screen } from "../../components/ui";
import Markdown from "../../components/Markdown";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { downloadBookLcMemo, pickBookLcFile, postBookLc } from "../../lib/bookLcFiles";
import { usePullRefresh } from "../../lib/useRefresh";
import { bnNum } from "../../lib/labels";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL, VIA_LABEL } from "./blStrings";
import { Line, SectionTitle, dateArg, useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcRound">;

function CheckRow({ mark, onCheck, canCheck }: { mark: BlMarkT | { checkedAt: string | null; via: string | null; checkedByName?: string | null }; onCheck: () => void; canCheck: boolean }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center", marginTop: space(1) }}>
      <Badge text={`${BL.via}: ${VIA_LABEL(mark.via)}`} tone="muted" />
      {mark.checkedAt ? <Badge text={`✓ ${BL.checked}${mark.checkedByName ? ` — ${mark.checkedByName}` : ""}`} tone="info" /> : canCheck ? <Button title={BL.check} variant="ghost" onPress={onCheck} /> : null}
    </View>
  );
}

export default function BookLcRoundScreen({ route }: Props): React.ReactElement {
  const { roundId } = route.params;
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const manage = can("book_lifecycle:manage");
  const finalize = can("book_lifecycle:finalize");
  const [q, refetch] = useQuery({ query: BL_ROUND, variables: { id: roundId }, requestPolicy: "cache-and-network" });
  const r = q.data?.bookLcRound;
  const [fq, refetchF] = useQuery({ query: BL_FEEDBACK, variables: { bookId: r?.bookId ?? "", page: 1, pageSize: 200 }, pause: !r });
  const [dq] = useQuery({ query: BL_DECISIONS, variables: { bookId: r?.bookId ?? "", page: 1, pageSize: 200 }, pause: !r });
  const [, updateRound] = useMutation(BL_UPDATE_ROUND);
  const [{ fetching: detecting }, detect] = useMutation(BL_DETECT_PAGES);
  const [, setPages] = useMutation(BL_SET_PAGES);
  const [{ fetching: making }, makePacket] = useMutation(BL_MAKE_PACKET);
  const [, markSent] = useMutation(BL_MARK_SENT);
  const [, withdraw] = useMutation(BL_WITHDRAW);
  const [, itemMarks] = useMutation(BL_ITEM_MARKS);
  const [, decisionMarks] = useMutation(BL_DECISION_MARKS);
  const [, addPoints] = useMutation(BL_ADD_POINTS);
  const [, checkRow] = useMutation(BL_CHECK_ROW);
  const [{ fetching: recording }, recordReturn] = useMutation(BL_RECORD_RETURN);
  const [msg, setMsg] = useMsg();
  const pull = usePullRefresh(q.fetching, () => (refetch({ requestPolicy: "network-only" }), refetchF({ requestPolicy: "network-only" })));

  const [extra, setExtra] = useState<string | null>(null);
  const [due, setDue] = useState("");
  const [pageEdits, setPageEdits] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<"whole" | "changed">("whole");
  const [sentDate, setSentDate] = useState("");
  const [returned, setReturned] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pagesOf, setPagesOf] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<"approve" | "changes" | null>(null);
  const [generalNote, setGeneralNote] = useState("");
  const [point, setPoint] = useState({ chapterKey: "", page: "", quote: "", textBn: "", category: "other" as BookFeedbackCategory, scanPage: "" });

  const after = (res: { error?: Parameters<typeof friendlyError>[0] }, ok?: string): void => {
    if (res.error) setMsg({ tone: "danger", text: friendlyError(res.error) });
    else {
      if (ok) setMsg({ tone: "ok", text: ok });
      refetch({ requestPolicy: "network-only" });
      refetchF({ requestPolicy: "network-only" });
    }
  };

  const feedback = fq.data?.bookLcFeedbackPage.rows ?? [];
  const decisions = dq.data?.bookLcDecisionsPage.rows ?? [];
  const asked = useMemo(() => (r ? feedback.filter((f) => r.feedbackIds.includes(f.id)) : []), [r, feedback]);
  const askedD = useMemo(() => (r ? decisions.filter((d) => r.decisionIds.includes(d.id)) : []), [r, decisions]);
  const offerable = feedback.filter((f) => f.status === "with_reviewer");
  const openDecisions = decisions.filter((d) => d.status === "open");
  const points = r ? feedback.filter((f) => f.roundId === r.id && f.source === "reviewer") : [];

  const toggle = (round: BlRoundT, kind: "feedbackIds" | "decisionIds", id: string): void => {
    const cur = round[kind];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    void updateRound({ id: round.id, [kind]: next }).then((res) => after(res));
  };

  const uploadScan = async (): Promise<void> => {
    const f = await pickBookLcFile("scan");
    if (!f) return;
    try {
      await postBookLc("round-scan", { roundId, returnedAt: dateArg(returned) }, { file: f });
      after({}, BL.done);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {r ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {BL.memo} {bnNum(r.memoNo)} · {r.versionLabel}
                {r.baseLabel ? ` (← ${r.baseLabel})` : ""}
              </Body>
              <Line label={BL.reviewerName} value={`${r.reviewerName}${r.selfReviewed ? ` · ${BL.stampSelf}` : ""}`} />
              <Line label={BL.status} value={r.status} />
              {r.sentOnPaperAt ? <Line label={BL.markSent} value={ymd(r.sentOnPaperAt)} /> : null}
              {r.dueBy ? <Line label={BL.dueBy} value={ymd(r.dueBy)} /> : null}
              {r.overdue ? <Badge text={BL.overdue} tone="danger" /> : null}
              {r.recordedFromPaper ? <Badge text={`${BL.recordedStamp} — ${r.recordedByName ?? ""}, ${ymd(r.recordedAt)}`} tone="info" /> : null}
              <Muted style={{ marginTop: space(2) }}>{BL.reviewerNoLogin}</Muted>
            </Card>
            {msg}

            {/* ---------------- S4: build the memo and the packet ---------------- */}
            {r.status === "draft" && manage ? (
              <>
                <SectionTitle>{BL.askedItems}</SectionTitle>
                {offerable.length ? null : <Muted>—</Muted>}
                <ChipRow>
                  {offerable.map((f) => (
                    <Chip key={f.id} label={`${f.code} ${f.textBn.slice(0, 30)}`} selected={r.feedbackIds.includes(f.id)} onPress={() => toggle(r, "feedbackIds", f.id)} />
                  ))}
                </ChipRow>
                <SectionTitle>{BL.askedDecisions}</SectionTitle>
                <ChipRow>
                  {openDecisions.map((d) => (
                    <Chip key={d.id} label={`${d.code} ${d.questionBn.slice(0, 30)}`} selected={r.decisionIds.includes(d.id)} onPress={() => toggle(r, "decisionIds", d.id)} />
                  ))}
                </ChipRow>
                <Card style={{ marginTop: space(2) }}>
                  <Field label={BL.extraNotes} value={extra ?? r.extraNotesBn ?? ""} onChangeText={setExtra} multiline autoCapitalize="sentences" />
                  <Field label={BL.dueBy} value={due} onChangeText={setDue} placeholder="2026-12-01" />
                  <Button title={BL.saveRound} variant="secondary" onPress={() => void updateRound({ id: r.id, extraNotesBn: extra ?? r.extraNotesBn ?? "", dueBy: dateArg(due) ?? undefined }).then((res) => after(res, BL.saved))} />
                </Card>

                <SectionTitle>{BL.pageMap}</SectionTitle>
                <Button title={BL.detectPages} variant="secondary" loading={detecting} onPress={() => void detect({ roundId: r.id }).then((res) => after(res))} />
                {r.pageMapSource === "hand" ? <Muted>{BL.pageMapHand}</Muted> : null}
                {r.pageMap.map((p) => (
                  <View key={p.chapterKey} style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={`${p.chapterKey} — ${p.title}${p.confirmed ? " ✓" : ""}`}
                        value={pageEdits[p.chapterKey] ?? (p.startPage != null ? String(p.startPage) : "")}
                        onChangeText={(t) => setPageEdits({ ...pageEdits, [p.chapterKey]: t })}
                        keyboardType="number-pad"
                        placeholder={BL.notFound}
                      />
                    </View>
                  </View>
                ))}
                {r.pageMap.length ? (
                  <Button
                    title={BL.confirmPages}
                    onPress={() =>
                      void setPages({
                        roundId: r.id,
                        entries: r.pageMap
                          .map((p) => ({ chapterKey: p.chapterKey, startPage: Number(pageEdits[p.chapterKey] ?? p.startPage) }))
                          .filter((e) => Number.isInteger(e.startPage) && e.startPage > 0),
                      }).then((res) => after(res, BL.saved))
                    }
                  />
                ) : null}
                <ChipRow>
                  <Chip label={BL.scopeWhole} selected={scope === "whole"} onPress={() => setScope("whole")} />
                  <Chip label={BL.scopeChanged} selected={scope === "changed"} onPress={() => setScope("changed")} />
                </ChipRow>
                <Button title={BL.makePacket} loading={making} onPress={() => void makePacket({ roundId: r.id, scope }).then((res) => after(res, BL.done))} />
              </>
            ) : null}

            {/* Packet files (once made) */}
            {r.memoPdfFileId ? (
              <Card style={{ marginTop: space(3) }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title={BL.memoPdf} variant="secondary" onPress={() => void openStoredFile(r.memoPdfFileId!)} />
                  {r.bookPdfFileId ? <Button title={`${BL.bookPdf} (${r.packetScope === "changed" ? BL.scopeChanged : BL.scopeWhole})`} variant="secondary" onPress={() => void openStoredFile(r.bookPdfFileId!)} /> : null}
                  {Platform.OS === "web" ? <Button title={`${BL.memo} .md`} variant="ghost" onPress={() => void downloadBookLcMemo(r.id, `memo-${r.memoNo}.md`)} /> : null}
                </View>
              </Card>
            ) : null}

            {r.status === "packet_ready" && manage ? (
              <Card style={{ marginTop: space(3) }}>
                <Field label={BL.sentDate} value={sentDate} onChangeText={setSentDate} placeholder="2026-11-13" />
                <Field label={BL.dueBy} value={due} onChangeText={setDue} placeholder="2026-12-01" />
                <Button title={BL.markSent} onPress={() => void markSent({ roundId: r.id, sentAt: dateArg(sentDate), dueBy: dateArg(due) ?? undefined }).then((res) => after(res, BL.done))} />
              </Card>
            ) : null}
            {["draft", "packet_ready", "sent_on_paper"].includes(r.status) && manage ? (
              <Button title={BL.withdraw} variant="danger" onPress={() => void confirmAction({ title: BL.withdraw, message: BL.withdraw, confirmLabel: BL.withdraw }).then((ok) => { if (ok) void withdraw({ roundId: r.id }).then((res) => after(res)); })} style={{ marginTop: space(2) }} />
            ) : null}

            {/* ---------------- S7: record the returned paper copy ---------------- */}
            {r.status === "sent_on_paper" ? (
              <>
                <SectionTitle>{BL.recordTitle}</SectionTitle>
                {manage ? (
                  <Card>
                    <Field label={BL.returnedDate} value={returned} onChangeText={setReturned} placeholder="2026-11-20" />
                    <Button title={BL.uploadScan} variant="secondary" onPress={() => void uploadScan()} />
                  </Card>
                ) : null}
                {r.scanFileIds.length ? (
                  <ChipRow>
                    {r.scanFileIds.map((s, i) => (
                      <Chip key={s} label={`${BL.scans} ${bnNum(i + 1)}`} onPress={() => void openStoredFile(s)} />
                    ))}
                  </ChipRow>
                ) : (
                  <Muted>{BL.noScan}</Muted>
                )}
                {r.scanFileIds.length ? (
                  <>
                    {asked.map((f) => {
                      const mark = r.itemMarks.find((m) => m.targetId === f.id);
                      return (
                        <Card key={f.id} style={{ marginTop: space(2) }}>
                          <Body style={{ fontWeight: "700" }}>{f.code}</Body>
                          <Muted>{f.textBn}</Muted>
                          {manage ? (
                            <>
                              <ChipRow>
                                {(["agree", "disagree", "modify"] as const).map((vv) => (
                                  <Chip
                                    key={vv}
                                    label={vv === "agree" ? BL.agree : vv === "disagree" ? BL.disagree : BL.modify}
                                    selected={mark?.value === vv}
                                    onPress={() =>
                                      void itemMarks({ roundId: r.id, marks: [{ feedbackId: f.id, verdict: vv, noteBn: notes[f.id] ?? mark?.noteBn ?? null, scanPage: Number(pagesOf[f.id] ?? mark?.scanPage) || null }] }).then((res) => after(res))
                                    }
                                  />
                                ))}
                              </ChipRow>
                              <Field label={BL.note} value={notes[f.id] ?? mark?.noteBn ?? ""} onChangeText={(t) => setNotes({ ...notes, [f.id]: t })} autoCapitalize="sentences" />
                              <Field label={BL.scanPage} value={pagesOf[f.id] ?? (mark?.scanPage ? String(mark.scanPage) : "")} onChangeText={(t) => setPagesOf({ ...pagesOf, [f.id]: t })} keyboardType="number-pad" />
                            </>
                          ) : null}
                          {mark ? <CheckRow mark={mark} canCheck={manage} onCheck={() => void checkRow({ roundId: r.id, kind: "item", id: f.id }).then((res) => after(res))} /> : null}
                        </Card>
                      );
                    })}
                    {askedD.map((d) => {
                      const mark = r.decisionMarks.find((m) => m.targetId === d.id);
                      return (
                        <Card key={d.id} style={{ marginTop: space(2) }}>
                          <Body style={{ fontWeight: "700" }}>
                            {d.code} — {d.questionBn}
                          </Body>
                          {manage ? (
                            <ChipRow>
                              {[...d.options.map((o) => ({ key: o.key as string | null, label: `${o.key}) ${o.textBn}` })), { key: null, label: BL.later }].map((o) => (
                                <Chip
                                  key={o.key ?? "later"}
                                  label={o.label}
                                  selected={!!mark && (mark.value ?? null) === o.key}
                                  onPress={() => void decisionMarks({ roundId: r.id, marks: [{ decisionId: d.id, optionKey: o.key, noteBn: notes[d.id] ?? null, scanPage: Number(pagesOf[d.id]) || null }] }).then((res) => after(res))}
                                />
                              ))}
                            </ChipRow>
                          ) : null}
                          {manage ? <Field label={BL.scanPage} value={pagesOf[d.id] ?? ""} onChangeText={(t) => setPagesOf({ ...pagesOf, [d.id]: t })} keyboardType="number-pad" /> : null}
                          {mark ? <CheckRow mark={mark} canCheck={manage} onCheck={() => void checkRow({ roundId: r.id, kind: "decision", id: d.id }).then((res) => after(res))} /> : null}
                        </Card>
                      );
                    })}

                    <SectionTitle>{BL.newPoints}</SectionTitle>
                    <Muted>{BL.claudeRoute}</Muted>
                    {points.map((p) => (
                      <Card key={p.id} style={{ marginTop: space(2) }}>
                        <Body>
                          {p.code} · {p.chapterKey ?? "—"} {p.page ? `· পৃ. ${p.page}` : ""} {p.scanPage ? `· ${BL.scanPage} ${bnNum(p.scanPage)}` : ""}
                        </Body>
                        <Muted>{p.textBn}</Muted>
                        <CheckRow mark={{ checkedAt: p.checkedAt, via: p.via }} canCheck={manage} onCheck={() => void checkRow({ roundId: r.id, kind: "point", id: p.id }).then((res) => after(res))} />
                      </Card>
                    ))}
                    {manage ? (
                      <Card style={{ marginTop: space(2) }}>
                        <Field label={BL.chapterKey} value={point.chapterKey} onChangeText={(t) => setPoint({ ...point, chapterKey: t })} />
                        <Field label={BL.page} value={point.page} onChangeText={(t) => setPoint({ ...point, page: t })} />
                        <Field label={BL.quote} value={point.quote} onChangeText={(t) => setPoint({ ...point, quote: t })} multiline autoCapitalize="sentences" />
                        <Field label={BL.pointText} value={point.textBn} onChangeText={(t) => setPoint({ ...point, textBn: t })} multiline autoCapitalize="sentences" />
                        <ChipRow>
                          {BOOK_FEEDBACK_CATEGORIES.map((c) => (
                            <Chip key={c} label={BOOK_FEEDBACK_CATEGORY_BN[c]} selected={point.category === c} onPress={() => setPoint({ ...point, category: c })} />
                          ))}
                        </ChipRow>
                        <Field label={BL.scanPage} value={point.scanPage} onChangeText={(t) => setPoint({ ...point, scanPage: t })} keyboardType="number-pad" />
                        <Button
                          title={BL.addPoint}
                          variant="secondary"
                          onPress={() =>
                            void addPoints({
                              roundId: r.id,
                              items: [{ chapterKey: point.chapterKey || null, page: point.page || null, quote: point.quote || null, textBn: point.textBn, category: point.category, scanPage: Number(point.scanPage) || null }],
                            }).then((res) => (after(res), !res.error && setPoint({ ...point, quote: "", textBn: "", page: "", scanPage: "" })))
                          }
                        />
                      </Card>
                    ) : null}

                    <SectionTitle>{BL.verdict}</SectionTitle>
                    {r.uncheckedCount ? <Badge text={`${bnNum(r.uncheckedCount)} ${BL.unchecked}`} tone="warn" /> : null}
                    {finalize ? (
                      <Card style={{ marginTop: space(2) }}>
                        <Field label={BL.generalNote} value={generalNote} onChangeText={setGeneralNote} multiline autoCapitalize="sentences" />
                        <ChipRow>
                          <Chip label={BL.verdictApprove} selected={verdict === "approve"} onPress={() => setVerdict("approve")} />
                          <Chip label={BL.verdictChanges} selected={verdict === "changes"} onPress={() => setVerdict("changes")} />
                        </ChipRow>
                        <Button
                          title={BL.recordNow}
                          loading={recording}
                          disabled={!verdict}
                          onPress={() =>
                            void (async () => {
                              if (!(await confirmAction({ title: BL.recordNow, message: BL.confirmRecord, confirmLabel: BL.recordNow }))) return;
                              const res = await recordReturn({ roundId: r.id, verdict: verdict!, returnedAt: dateArg(returned), reviewerNoteBn: generalNote || null });
                              after(res, BL.done);
                            })()
                          }
                        />
                      </Card>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {r.status === "returned" ? (
              <Card style={{ marginTop: space(3) }}>
                <Line label={BL.verdict} value={r.verdict === "approve" ? BL.verdictApprove : BL.verdictChanges} />
                {r.reviewerNoteBn ? <Line label={BL.generalNote} value={r.reviewerNoteBn} /> : null}
                <Line label={BL.returnedDate} value={ymd(r.returnedAt)} />
              </Card>
            ) : null}

            <SectionTitle>{BL.memo}</SectionTitle>
            <Card>
              <Markdown source={r.memoMarkdown} />
            </Card>
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
