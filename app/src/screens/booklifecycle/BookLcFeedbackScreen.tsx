/**
 * S5 মতামত বাছাই — the one feedback inbox for a book (docs/prd-book-lifecycle.md §8, §9.2). Triage per
 * item or in bulk: পর্যালোচকের কাছে · সরাসরি সংশোধন · মুখে জানানো (ভুল-সংশোধনী) · বাতিল (reason shown to
 * the reporter) · একই · সিদ্ধান্তে নিন. Reporter names only to manage holders (the server decides).
 */
import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_FEEDBACK_CATEGORIES, BOOK_FEEDBACK_CATEGORY_BN, BOOK_FEEDBACK_STATUS_BN, type BookFeedbackCategory, type BookFeedbackStatus } from "@scd/shared";
import { BL_FEEDBACK, BL_FILE_FEEDBACK, BL_OPEN_DECISION, BL_TRIAGE } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { openStoredFile } from "../../lib/files";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL, SOURCE_LABEL, VIA_LABEL } from "./blStrings";
import { useMsg, ymd } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcFeedback">;
const FILTERS: (string | null)[] = ["open", "with_reviewer", "accepted", "applied", "rejected", null];

export default function BookLcFeedbackScreen({ route }: Props): React.ReactElement {
  const { bookId } = route.params;
  const { can } = useAuth();
  const manage = can("book_lifecycle:manage");
  const [status, setStatus] = useState<string | null>("open");
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: BL_FEEDBACK, variables: { bookId, status, page, pageSize: 30 }, requestPolicy: "cache-and-network" });
  const [, triage] = useMutation(BL_TRIAGE);
  const [, file] = useMutation(BL_FILE_FEEDBACK);
  const [, openDecision] = useMutation(BL_OPEN_DECISION);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [dupOf, setDupOf] = useState("");
  const [msg, setMsg] = useMsg();
  const [form, setForm] = useState({ source: "school", chapterKey: "", page: "", quote: "", textBn: "", category: "spelling" as BookFeedbackCategory });
  const pull = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const rows = q.data?.bookLcFeedbackPage.rows ?? [];

  const act = async (ids: string[], action: string): Promise<void> => {
    const res = await triage({ ids, action, reasonBn: reason || null, duplicateOfCode: dupOf || null });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setSelected([]);
    setMsg({ tone: "ok", text: BL.done });
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <ChipRow>
        {FILTERS.map((s) => (
          <Chip key={s ?? "all"} label={s ? BOOK_FEEDBACK_STATUS_BN[s as BookFeedbackStatus] : BL.all} selected={status === s} onPress={() => (setStatus(s), setPage(1))} />
        ))}
      </ChipRow>
      {msg}
      {manage && selected.length ? (
        <Card style={{ marginBottom: space(3) }}>
          <Muted>{selected.length}</Muted>
          <Field label={BL.rejectReason} value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          <Field label={BL.duplicateOf} value={dupOf} onChangeText={setDupOf} autoCapitalize="characters" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button title={BL.toReviewer} onPress={() => void act(selected, "needs_reviewer")} />
            <Button title={BL.directFix} variant="secondary" onPress={() => void act(selected, "direct_fix")} />
            <Button title={BL.verbalErrata} variant="secondary" onPress={() => void act(selected, "verbal_errata")} />
            <Button title={BL.reject} variant="danger" onPress={() => void act(selected, "reject")} />
            <Button title={BL.duplicate} variant="ghost" onPress={() => void act(selected, "duplicate")} />
          </View>
        </Card>
      ) : null}
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={!rows.length} empty={<EmptyState message={BL.noFeedback} />}>
        {rows.map((f) => (
          <Card key={f.id} onPress={manage && f.status === "open" ? () => setSelected(selected.includes(f.id) ? selected.filter((x) => x !== f.id) : [...selected, f.id]) : undefined} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {selected.includes(f.id) ? "☑ " : ""}
                {f.code}
              </Body>
              <Badge text={SOURCE_LABEL(f.source)} tone="muted" />
              <Badge text={BOOK_FEEDBACK_STATUS_BN[f.status as BookFeedbackStatus] ?? f.status} tone="info" />
              <Badge text={BOOK_FEEDBACK_CATEGORY_BN[f.category as BookFeedbackCategory] ?? f.category} tone="muted" />
              {f.via ? <Badge text={VIA_LABEL(f.via)} tone="muted" /> : null}
            </View>
            <Muted>
              {f.chapterKey ?? "—"} {f.page ? `· পৃ. ${f.page}` : ""} {f.reporterName ? `· ${f.reporterName}` : ""} · {ymd(f.createdAt)}
            </Muted>
            {f.quote ? <Muted>«{f.quote}»</Muted> : null}
            <Body>{f.textBn}</Body>
            {f.rulingVerdict ? <Muted>{`${BL.ruledBy}: ${f.rulingVerdict}${f.rulingNoteBn ? ` — ${f.rulingNoteBn}` : ""}${f.rulingFromPaper ? ` · ${BL.stampPaper}` : ""}`}</Muted> : null}
            {f.rejectReasonBn ? <Muted>{`${BL.reject}: ${f.rejectReasonBn}`}</Muted> : null}
            {f.duplicateOfCode ? <Muted>{`${BL.duplicate}: ${f.duplicateOfCode}`}</Muted> : null}
            {f.scanFileId ? <Button title={BL.scans} variant="ghost" onPress={() => void openStoredFile(f.scanFileId!)} /> : null}
            {manage && f.status === "open" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                <Button title={BL.toReviewer} variant="secondary" onPress={() => void act([f.id], "needs_reviewer")} />
                <Button title={BL.directFix} variant="ghost" onPress={() => void act([f.id], "direct_fix")} />
                <Button title={BL.verbalErrata} variant="ghost" onPress={() => void act([f.id], "verbal_errata")} />
                <Button
                  title={BL.toDecision}
                  variant="ghost"
                  onPress={() =>
                    void openDecision({ bookId, questionBn: f.textBn, options: ["হ্যাঁ", "না"], fromFeedbackId: f.id }).then((res) => setMsg(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: res.data!.openBookLcDecision.code }))
                  }
                />
              </View>
            ) : null}
          </Card>
        ))}
        {q.data ? <Pager {...q.data.bookLcFeedbackPage} onPage={setPage} /> : null}
      </QueryGate>

      {manage ? (
        <Card style={{ marginTop: space(4) }}>
          <Body style={{ fontWeight: "700" }}>{BL.newFeedback}</Body>
          <ChipRow>
            {(["school", "print_error", "proof_read"] as const).map((s) => (
              <Chip key={s} label={SOURCE_LABEL(s)} selected={form.source === s} onPress={() => setForm({ ...form, source: s })} />
            ))}
          </ChipRow>
          <Field label={BL.chapterKey} value={form.chapterKey} onChangeText={(t) => setForm({ ...form, chapterKey: t })} />
          <Field label={BL.page} value={form.page} onChangeText={(t) => setForm({ ...form, page: t })} />
          <Field label={BL.quote} value={form.quote} onChangeText={(t) => setForm({ ...form, quote: t })} multiline autoCapitalize="sentences" />
          <Field label={BL.pointText} value={form.textBn} onChangeText={(t) => setForm({ ...form, textBn: t })} multiline autoCapitalize="sentences" />
          <ChipRow>
            {BOOK_FEEDBACK_CATEGORIES.map((c) => (
              <Chip key={c} label={BOOK_FEEDBACK_CATEGORY_BN[c]} selected={form.category === c} onPress={() => setForm({ ...form, category: c })} />
            ))}
          </ChipRow>
          <Button
            title={BL.file}
            onPress={() =>
              void file({ bookId, source: form.source, input: { chapterKey: form.chapterKey || null, page: form.page || null, quote: form.quote || null, textBn: form.textBn, category: form.category } }).then((res) => {
                if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                setForm({ ...form, quote: "", textBn: "", page: "" });
                refetch({ requestPolicy: "network-only" });
              })
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}
