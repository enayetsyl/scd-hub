/**
 * ExamReportCardScreen (EX-5/EX-9) — the card preview, the school comment, and the
 * links to the PDF.
 *
 * Every number here is DERIVED server-side (D-#85); the screen renders and never
 * recomputes. In particular it does NOT re-derive the GPA — a second implementation is
 * how the screen and the printed card start disagreeing.
 *
 * When the any-F rule has fired the card SAYS SO. A 0.00 sitting under a 552/800 total
 * is otherwise the kind of thing a guardian queries at the counter.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  EXAM_REPORT_CARD_QUERY,
  EXAM_COMMENT_SUGGESTIONS_QUERY,
  SET_EXAM_REPORT_COMMENT,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice, Field, Divider } from "../../components/ui";
import { STR, bnNum, routineSubjectLabel, examComponentLabel, gradeLetterLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf } from "../../lib/pdf";
import { roleHasPermission } from "@scd/shared";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import type { ExamsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ExamsStackParamList, "ExamReportCard">;

export default function ExamReportCardScreen({ route }: Props): React.ReactElement {
  const { examId, studentId } = route.params;
  const { role } = useAuth();
  const canManage = !!role && roleHasPermission(role, "exam:manage");

  const [cardQ, refetchCard] = useQuery({ query: EXAM_REPORT_CARD_QUERY, variables: { examId, studentId } });
  const card = cardQ.data?.examReportCard ?? null;

  const [sugQ] = useQuery({ query: EXAM_COMMENT_SUGGESTIONS_QUERY, variables: {} });
  const suggestions = sugQ.data?.examCommentSuggestions ?? [];

  const [, setComment] = useMutation(SET_EXAM_REPORT_COMMENT);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSaveComment(): Promise<void> {
    if (draft === null) return;
    setError(null); setOk(null); setBusy(true);
    const res = await setComment({ examId, studentId, comment: draft });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exCommentSaved);
    setDraft(null);
    refetchCard({ requestPolicy: "network-only" });
  }

  if (cardQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen>
        <Notice message={cardQ.error ? friendlyError(cardQ.error) : STR.exNoCard} tone="danger" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700" }}>{card.studentName}</Body>
          <Muted>
            {card.studentSchoolId} · {card.branch} · {card.shift}
          </Muted>
          <Muted>
            {card.examName} · {card.session}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <Badge
              text={card.publishedAt ? STR.exPublished : STR.exUnpublishedState}
              tone={card.publishedAt ? "ok" : "muted"}
            />
          </View>
        </Card>

        <Card>
          {card.rows.map((r, i) => (
            <View key={r.paperId}>
              {i > 0 ? <Divider /> : null}
              <View style={{ marginTop: space(2) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(r.subject)}</Body>
                  <Badge text={gradeLetterLabel(r.letter)} tone={r.letter === "F" ? "danger" : "ok"} />
                </View>
                {/* One line per component the paper actually has — a Nursery card shows no
                    Adab column and a Class-3 Maths row shows no CT (D-#376). */}
                <Muted>
                  {r.cells
                    .map((c) =>
                      `${examComponentLabel(c.component)} ${c.absent ? STR.exAbsent : c.value === null ? "—" : bnNum(c.value)}`,
                    )
                    .join(" · ")}
                </Muted>
                <Muted>
                  {STR.exObtained}: {bnNum(r.obtained)}/{bnNum(r.fullMarks)}
                  {r.highest !== null ? ` · ${STR.exHighest}: ${bnNum(r.highest)}` : ""} ·{" "}
                  {STR.exGradePoint}: {bnNum(r.point)}
                </Muted>
              </View>
            </View>
          ))}

          <Divider />
          <View style={{ marginTop: space(2), flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.exTotalGpa}</Body>
            <Body style={{ fontWeight: "700" }}>
              {bnNum(card.totals.totalObtained)}/{bnNum(card.totals.totalFullMarks)} ·{" "}
              {card.totals.gpa.toFixed(2)} · {gradeLetterLabel(card.totals.letter)}
            </Body>
          </View>
          {card.totals.failedBySubject ? (
            <Notice
              message={`${STR.exFailedBySubject} (${card.totals.failedSubjects.map((s) => routineSubjectLabel(s)).join(", ")})`}
              tone="warn"
            />
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exComment}</Body>
          {draft === null ? (
            <View>
              <Muted>{card.comment ?? "—"}</Muted>
              {canManage ? (
                <View style={{ marginTop: space(2) }}>
                  <Button title={STR.exEdit} variant="secondary" onPress={() => setDraft(card.comment ?? "")} />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={{ marginTop: space(2) }}>
              <Field label={STR.exComment} value={draft} onChangeText={setDraft} multiline />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                {suggestions.map((s) => (
                  <Chip key={s} label={s} selected={draft === s} onPress={() => setDraft(s)} />
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                <Button title={STR.exSave} onPress={onSaveComment} loading={busy} disabled={busy} />
                <Button title={STR.cancel} variant="ghost" onPress={() => setDraft(null)} />
              </View>
            </View>
          )}
        </Card>

        <Card>
          <Button
            title={STR.exOpenPdf}
            variant="secondary"
            onPress={() => openPdf(`/pdf/report-card/${examId}/${studentId}`)}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
