/**
 * ExamPaperDraftScreen (D-#1031–#1033) — one draft paper, section by section, item by item.
 *
 * Every item shows where it came from (Mohammadpur 2026 as-is / adapted, another MP paper,
 * new from the book) and, for the paper's REVIEWER (or a manager), four actions:
 *   ✓ সিলেবাসের সাথে মিলেছে (toggle) · সম্পাদনার প্রস্তাব · মুছে ফেলার প্রস্তাব
 * and every section has "নতুন প্রশ্নের প্রস্তাব" + "এই অংশের সব প্রশ্ন মিলেছে".
 * A suggestion never changes the paper by itself: a manager (exam_papers:manage) accepts
 * it — optionally rewording — or rejects it with a note. The reviewer finishes with
 * "রিভিউ শেষ"; a manager marks the paper final (or reopens it).
 */
import React, { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  CONFIRM_EXAM_SECTION_SYLLABUS,
  EXAM_PAPER_DRAFT_QUERY,
  FINALIZE_EXAM_PAPER,
  RESOLVE_EXAM_PAPER_SUGGESTION,
  SET_EXAM_ITEM_SYLLABUS_MATCH,
  SUBMIT_EXAM_PAPER_REVIEW,
  SUGGEST_EXAM_PAPER_CHANGE,
  WITHDRAW_EXAM_PAPER_SUGGESTION,
  type ExamPaperDetailT,
  type ExamPaperItemT,
  type ExamPaperSectionT,
  type ExamPaperSuggestionT,
} from "../../graphql/examPapers";
import Markdown from "../../components/Markdown";
import { Badge, Body, Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { ExamPapersStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";
import { fill, paperStatus, sourceBadge, subjectLabel, suggestionKind, suggestionStatus } from "./common";

type Props = NativeStackScreenProps<ExamPapersStackParamList, "ExamPaperDraft">;

const OPTION_MARKS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

type Runner = (fn: () => Promise<{ data?: ExamPaperDetailT | null; error?: unknown } | null>) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Suggestion form (edit / delete / add)
// ---------------------------------------------------------------------------

function SuggestForm({
  mode,
  item,
  onSend,
  onCancel,
}: {
  mode: "EDIT" | "DELETE" | "ADD";
  item?: ExamPaperItemT;
  onSend: (v: { text: string; answer: string; options: string[]; reason: string }) => Promise<boolean>;
  onCancel: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [text, setText] = useState(mode === "EDIT" ? (item?.text ?? "") : "");
  const [answer, setAnswer] = useState(mode === "EDIT" ? (item?.answer ?? "") : "");
  const [options, setOptions] = useState(mode === "EDIT" ? (item?.options ?? []).join("\n") : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const title = mode === "EDIT" ? STR.epSuggestEdit : mode === "DELETE" ? STR.epSuggestDelete : STR.epSuggestAdd;
  const canSend = mode === "DELETE" ? reason.trim().length > 0 : text.trim().length > 0;
  return (
    <View
      style={{
        marginTop: space(2),
        padding: space(3),
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{title}</Body>
      {mode !== "DELETE" ? (
        <>
          <Field
            label={mode === "EDIT" ? STR.epNewTextEdit : STR.epNewText}
            value={text}
            onChangeText={setText}
            multiline
            autoCapitalize="sentences"
          />
          <Field label={STR.epNewOptions} value={options} onChangeText={setOptions} multiline autoCapitalize="sentences" />
          <Field label={STR.epNewAnswer} value={answer} onChangeText={setAnswer} autoCapitalize="sentences" />
        </>
      ) : null}
      <Field
        label={mode === "DELETE" ? STR.epReason : STR.epReasonOpt}
        value={reason}
        onChangeText={setReason}
        multiline
        autoCapitalize="sentences"
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button
          title={STR.epSend}
          disabled={!canSend}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            const ok = await onSend({
              text: text.trim(),
              answer: answer.trim(),
              options: options
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean),
              reason: reason.trim(),
            });
            setBusy(false);
            if (ok) onCancel();
          }}
        />
        <Button title={STR.cancel} variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// One suggestion row (status + withdraw / accept / reject)
// ---------------------------------------------------------------------------

function SuggestionRow({
  s,
  myId,
  canManage,
  canReview,
  run,
}: {
  s: ExamPaperSuggestionT;
  myId: string | null;
  canManage: boolean;
  canReview: boolean;
  run: Runner;
}): React.ReactElement {
  const colors = useColors();
  const [, withdraw] = useMutation(WITHDRAW_EXAM_PAPER_SUGGESTION);
  const [, resolve] = useMutation(RESOLVE_EXAM_PAPER_SUGGESTION);
  const [deciding, setDeciding] = useState(false);
  const [note, setNote] = useState("");
  const [text, setText] = useState(s.proposedText ?? "");
  const st = suggestionStatus(s.status);
  const open = s.status === "OPEN";
  return (
    <View
      style={{
        marginTop: space(2),
        padding: space(2),
        borderLeftWidth: 3,
        borderLeftColor: open ? colors.warning : colors.border,
        backgroundColor: colors.bg,
        borderRadius: radius.sm,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), alignItems: "center" }}>
        <Badge text={suggestionKind(s.kind)} tone="brand" />
        <Badge text={st.label} tone={st.tone} />
        <Muted>{s.createdByName}</Muted>
      </View>
      {s.proposedText ? <Body style={{ marginTop: space(1) }}>{s.proposedText}</Body> : null}
      {s.proposedOptions.length ? (
        <Muted>{s.proposedOptions.map((o, i) => `(${OPTION_MARKS[i] ?? i + 1}) ${o}`).join("   ")}</Muted>
      ) : null}
      {s.proposedAnswer ? <Muted>{fill(STR.epAnswer, { a: s.proposedAnswer })}</Muted> : null}
      {s.reason ? <Muted>“{s.reason}”</Muted> : null}
      {s.resolutionNote ? (
        <Muted>
          {s.resolvedByName ? `${s.resolvedByName}: ` : ""}
          {s.resolutionNote}
        </Muted>
      ) : null}
      {open ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
          {canReview && myId === s.createdById ? (
            <Button title={STR.epWithdraw} variant="ghost" onPress={() => void run(() => withdraw({ suggestionId: s.id }).then((r) => ({ data: r.data?.withdrawExamPaperSuggestion, error: r.error })))} />
          ) : null}
          {canManage && !deciding ? <Button title={`${STR.epAccept} / ${STR.epReject}`} variant="secondary" onPress={() => setDeciding(true)} /> : null}
        </View>
      ) : null}
      {open && canManage && deciding ? (
        <View style={{ marginTop: space(2) }}>
          {s.kind !== "DELETE" ? <Field label={STR.epResolveText} value={text} onChangeText={setText} multiline autoCapitalize="sentences" /> : null}
          <Field label={STR.epResolveNote} value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button
              title={STR.epAccept}
              onPress={() =>
                void run(() =>
                  resolve({
                    suggestionId: s.id,
                    accept: true,
                    note: note.trim() || null,
                    text: s.kind !== "DELETE" && text.trim() && text.trim() !== (s.proposedText ?? "") ? text.trim() : null,
                  }).then((r) => ({ data: r.data?.resolveExamPaperSuggestion, error: r.error })),
                )
              }
            />
            <Button
              title={STR.epReject}
              variant="danger"
              onPress={() =>
                void run(() =>
                  resolve({ suggestionId: s.id, accept: false, note: note.trim() || null }).then((r) => ({
                    data: r.data?.resolveExamPaperSuggestion,
                    error: r.error,
                  })),
                )
              }
            />
            <Button title={STR.cancel} variant="ghost" onPress={() => setDeciding(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

function ItemCard({
  paper,
  section,
  item,
  n,
  showAnswers,
  canReview,
  myId,
  run,
}: {
  paper: ExamPaperDetailT;
  section: ExamPaperSectionT;
  item: ExamPaperItemT;
  n: number;
  showAnswers: boolean;
  canReview: boolean;
  myId: string | null;
  run: Runner;
}): React.ReactElement {
  const colors = useColors();
  const [form, setForm] = useState<"EDIT" | "DELETE" | "ADD" | null>(null);
  const [, setMatch] = useMutation(SET_EXAM_ITEM_SYLLABUS_MATCH);
  const [, suggest] = useMutation(SUGGEST_EXAM_PAPER_CHANGE);
  const src = sourceBadge(item.source);
  const mine = paper.suggestions.filter((s) => s.itemKey === item.key);
  const send = (kind: "EDIT" | "DELETE" | "ADD") => (v: { text: string; answer: string; options: string[]; reason: string }) =>
    run(() =>
      suggest({
        paperId: paper.id,
        kind,
        sectionSeq: section.seq,
        itemKey: item.key,
        proposedText: v.text || null,
        proposedAnswer: v.answer || null,
        proposedOptions: v.options.length ? v.options : null,
        reason: v.reason || null,
      }).then((r) => ({ data: r.data?.suggestExamPaperChange, error: r.error })),
    );
  return (
    <View
      style={{
        paddingVertical: space(3),
        borderTopWidth: 1,
        borderTopColor: colors.border,
        opacity: item.removed ? 0.55 : 1,
      }}
    >
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, minWidth: 24 }}>{bnNum(n)}.</Text>
        <View style={{ flex: 1 }}>
          <View style={item.removed ? { textDecorationLine: "line-through" } as object : undefined}>
            <Markdown source={item.text} />
          </View>
          {item.options.length ? (
            <Text style={{ ...typeScale.body, color: colors.textPrimary, marginTop: space(1) }}>
              {item.options.map((o, i) => `(${OPTION_MARKS[i] ?? i + 1}) ${o}`).join("    ")}
            </Text>
          ) : null}
          {showAnswers && item.answer ? (
            <Text style={{ ...typeScale.body, color: colors.primary, marginTop: space(1) }}>{fill(STR.epAnswer, { a: item.answer })}</Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1), alignItems: "center" }}>
            <Badge text={src.label} tone={src.tone} />
            {item.marks != null && section.splitMarks ? <Badge text={`${bnNum(item.marks)}`} tone="muted" /> : null}
            {item.needsPicture ? <Badge text={`🖼 ${STR.epNeedsPicture}`} tone="gold" /> : null}
            {item.removed ? <Badge text={STR.epRemoved} tone="danger" /> : null}
            {item.editedCount > 0 ? <Badge text={STR.epEdited} tone="info" /> : null}
            {item.syllabusConfirmed ? <Badge text={STR.epConfirmed} tone="ok" /> : null}
          </View>
          {item.sourceRef ? <Muted style={{ marginTop: space(1) }}>{item.sourceRef}</Muted> : null}
          {item.note ? <Muted>✎ {item.note}</Muted> : null}
          {item.bookRef ? <Muted>{fill(STR.epBook, { ref: item.bookRef })}</Muted> : null}
          {item.syllabusConfirmed && item.syllabusConfirmedByName ? (
            <Muted>{fill(STR.epConfirmedBy, { name: item.syllabusConfirmedByName })}</Muted>
          ) : null}
          {canReview && !item.removed ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Button
                title={item.syllabusConfirmed ? STR.epUnconfirm : `✓ ${STR.epConfirm}`}
                variant={item.syllabusConfirmed ? "ghost" : "primary"}
                onPress={() =>
                  void run(() =>
                    setMatch({ paperId: paper.id, itemKey: item.key, confirmed: !item.syllabusConfirmed }).then((r) => ({
                      data: r.data?.setExamItemSyllabusMatch,
                      error: r.error,
                    })),
                  )
                }
              />
              <Button title={STR.epSuggestEdit} variant="secondary" onPress={() => setForm(form === "EDIT" ? null : "EDIT")} />
              <Button title={STR.epSuggestDelete} variant="secondary" onPress={() => setForm(form === "DELETE" ? null : "DELETE")} />
              <Button title={STR.epSuggestAdd} variant="ghost" onPress={() => setForm(form === "ADD" ? null : "ADD")} />
            </View>
          ) : null}
          {form ? <SuggestForm mode={form} item={item} onSend={send(form)} onCancel={() => setForm(null)} /> : null}
          {mine.map((s) => (
            <SuggestionRow key={s.id} s={s} myId={myId} canManage={paper.viewerCanManage && paper.status !== "FINAL"} canReview={canReview} run={run} />
          ))}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// One section
// ---------------------------------------------------------------------------

function SectionCard({
  paper,
  section,
  showAnswers,
  canReview,
  myId,
  run,
}: {
  paper: ExamPaperDetailT;
  section: ExamPaperSectionT;
  showAnswers: boolean;
  canReview: boolean;
  myId: string | null;
  run: Runner;
}): React.ReactElement {
  const colors = useColors();
  const [adding, setAdding] = useState(false);
  const [, confirmAll] = useMutation(CONFIRM_EXAM_SECTION_SYLLABUS);
  const [, suggest] = useMutation(SUGGEST_EXAM_PAPER_CHANGE);
  const marks =
    section.count != null && section.marksEach != null
      ? fill(STR.epMarks, { count: bnNum(section.count), each: bnNum(section.marksEach), total: bnNum(section.total) })
      : fill(STR.epTotal, { total: bnNum(section.total) });
  const sectionAdds = paper.suggestions.filter((s) => s.sectionSeq === section.seq && !s.itemKey);
  const pending = section.items.some((i) => !i.removed && !i.syllabusConfirmed);
  const countOff = section.kind === "WRITTEN" && !section.splitMarks && section.count != null && section.activeItemCount < section.count;
  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1 }}>
          {bnNum(section.seq)}. {section.instructionBn}
        </Text>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textSecondary }}>{marks}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
        {section.kind === "ORAL" ? <Badge text={STR.epOral} tone="info" /> : null}
        {section.choiceNoteBn ? <Badge text={section.choiceNoteBn} tone="muted" /> : null}
      </View>
      {section.syllabusLabel ? <Muted style={{ marginTop: space(1) }}>{fill(STR.epSyllabusRow, { label: section.syllabusLabel })}</Muted> : null}
      {countOff ? <Notice tone="warn" message={fill(STR.epCountWarn, { a: bnNum(section.activeItemCount), n: bnNum(section.count ?? 0) })} /> : null}
      {section.stimulusMd ? (
        <View style={{ marginTop: space(2), padding: space(2), backgroundColor: colors.bg, borderRadius: radius.sm }}>
          <Markdown source={section.stimulusMd} />
        </View>
      ) : null}
      {section.matchRight.length ? (
        <Muted style={{ marginTop: space(2) }}>
          {STR.epMatchRight}: {section.matchRight.join(" · ")}
        </Muted>
      ) : null}
      <View style={{ marginTop: space(2) }}>
        {section.items.map((item, i) => (
          <ItemCard
            key={item.key}
            paper={paper}
            section={section}
            item={item}
            n={i + 1}
            showAnswers={showAnswers}
            canReview={canReview}
            myId={myId}
            run={run}
          />
        ))}
      </View>
      {sectionAdds.map((s) => (
        <SuggestionRow key={s.id} s={s} myId={myId} canManage={paper.viewerCanManage && paper.status !== "FINAL"} canReview={canReview} run={run} />
      ))}
      {canReview ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
          {pending ? (
            <Button
              title={`✓ ${STR.epConfirmSection}`}
              variant="secondary"
              onPress={() =>
                void run(() =>
                  confirmAll({ paperId: paper.id, sectionSeq: section.seq }).then((r) => ({ data: r.data?.confirmExamSectionSyllabus, error: r.error })),
                )
              }
            />
          ) : null}
          <Button title={`＋ ${STR.epSuggestAdd}`} variant="ghost" onPress={() => setAdding(!adding)} />
        </View>
      ) : null}
      {adding ? (
        <SuggestForm
          mode="ADD"
          onCancel={() => setAdding(false)}
          onSend={(v) =>
            run(() =>
              suggest({
                paperId: paper.id,
                kind: "ADD",
                sectionSeq: section.seq,
                proposedText: v.text,
                proposedAnswer: v.answer || null,
                proposedOptions: v.options.length ? v.options : null,
                reason: v.reason || null,
              }).then((r) => ({ data: r.data?.suggestExamPaperChange, error: r.error })),
            )
          }
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ExamPaperDraftScreen({ route, navigation }: Props): React.ReactElement {
  const { paperId } = route.params;
  const colors = useColors();
  const { user } = useAuth();
  const myId = (user as { id?: string } | null)?.id ?? null;
  const { confirmAction } = useConfirm();
  const [q, refetchQ] = useQuery({ query: EXAM_PAPER_DRAFT_QUERY, variables: { id: paperId } });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const [local, setLocal] = useState<ExamPaperDetailT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [summary, setSummary] = useState("");
  const [, submit] = useMutation(SUBMIT_EXAM_PAPER_REVIEW);
  const [, finalize] = useMutation(FINALIZE_EXAM_PAPER);

  const fresh = q.data?.examPaperDraft ?? null;
  // A mutation's answer is the newest copy until the query catches up.
  const paper = local && fresh && local.updatedAt > fresh.updatedAt ? local : (fresh ?? local);

  React.useLayoutEffect(() => {
    if (paper) navigation.setOptions({ title: `${subjectLabel(paper.subject)} · ${paper.classLabelBn}` });
  }, [navigation, paper?.subject, paper?.classLabelBn]);

  const run: Runner = async (fn) => {
    setError(null);
    setNotice(null);
    const r = await fn();
    if (r?.error) {
      setError(friendlyError(r.error as never));
      return false;
    }
    if (r?.data) setLocal(r.data);
    return true;
  };

  const canReview = !!paper && (paper.viewerIsReviewer || paper.viewerCanManage) && paper.status !== "FINAL";
  const st = paper ? paperStatus(paper.status) : null;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <QueryGate result={q} onRetry={refetch} loaderLabel={STR.loading}>
          {paper && st ? (
            <View>
              <Card style={{ marginBottom: space(3) }}>
                <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary }}>{paper.titleBn}</Text>
                <Muted>
                  {fill(STR.epFullMarks, { m: bnNum(paper.fullMarks) })}
                  {paper.durationBn ? ` · ${fill(STR.epDuration, { d: paper.durationBn })}` : ""}
                </Muted>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                  <Badge text={st.label} tone={st.tone} />
                </View>
                <Muted style={{ marginTop: space(1) }}>
                  {fill(STR.epProgress, { c: bnNum(paper.confirmedCount), n: bnNum(paper.itemCount), o: bnNum(paper.openSuggestions) })}
                </Muted>
                <Muted>{paper.reviewerName ? fill(STR.epReviewer, { name: paper.reviewerName }) : STR.epNoReviewer}</Muted>
                {paper.reviewSummary ? (
                  <Muted>
                    {STR.epReviewSummary}: {paper.reviewSummary}
                  </Muted>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  <Button title={showAnswers ? STR.epHideAnswers : STR.epShowAnswers} variant="secondary" onPress={() => setShowAnswers(!showAnswers)} />
                  {paper.authorNotes ? (
                    <Button title={STR.epAuthorNotes} variant="ghost" onPress={() => setShowNotes(!showNotes)} />
                  ) : null}
                </View>
                {showNotes && paper.authorNotes ? <Muted style={{ marginTop: space(2) }}>{paper.authorNotes}</Muted> : null}
              </Card>
              {paper.status === "FINAL" ? <Notice tone="ok" message={STR.epFinalNote} /> : null}
              {error ? <Notice tone="danger" message={error} /> : null}
              {notice ? <Notice tone="ok" message={notice} /> : null}

              {paper.sections.map((s) => (
                <SectionCard key={s.seq} paper={paper} section={s} showAnswers={showAnswers} canReview={canReview} myId={myId} run={run} />
              ))}

              {paper.viewerIsReviewer && paper.status !== "FINAL" ? (
                <Card style={{ marginBottom: space(3) }}>
                  <Field label={STR.epSubmitSummary} value={summary} onChangeText={setSummary} multiline autoCapitalize="sentences" />
                  <Button
                    title={STR.epSubmitReview}
                    onPress={async () => {
                      const left = paper.itemCount - paper.confirmedCount;
                      if (left > 0 && !(await confirmAction({ title: STR.epSubmitReview, message: fill(STR.epSubmitConfirm, { n: bnNum(left) }) }))) return;
                      const ok = await run(() =>
                        submit({ paperId: paper.id, summary: summary.trim() || null }).then((r) => ({ data: r.data?.submitExamPaperReview, error: r.error })),
                      );
                      if (ok) setNotice(STR.epSubmitted);
                    }}
                  />
                </Card>
              ) : null}
              {paper.viewerCanManage ? (
                <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(6) }}>
                  {paper.status === "FINAL" ? (
                    <Button
                      title={STR.epReopen}
                      variant="secondary"
                      onPress={() => void run(() => finalize({ paperId: paper.id, final: false }).then((r) => ({ data: r.data?.finalizeExamPaper, error: r.error })))}
                    />
                  ) : (
                    <Button
                      title={STR.epFinalize}
                      onPress={async () => {
                        if (!(await confirmAction({ title: STR.epFinalize, message: STR.epFinalNote }))) return;
                        await run(() => finalize({ paperId: paper.id, final: true }).then((r) => ({ data: r.data?.finalizeExamPaper, error: r.error })));
                      }}
                    />
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
