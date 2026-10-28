/**
 * QuranExamHomeScreen (D-#873–#878) — the কুরআন পরীক্ষা tab.
 *
 *  - Office (quran_exam:view / manage): the exam's status, publish / lock, the exam days
 *    with counts (tap a day to manage its examiners), the papers, the results.
 *  - A teacher who only examines lands on their own duties (MyQuranExam content inline).
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_EXAMS, QX_LOCK, QX_PUBLISH, QX_SET_NOTE, type QxOverviewT, type QxPaperT } from "../../graphql/quranExam";
import { Badge, Body, Button, Card, EmptyState, Field, H2, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { qxLevelLabel } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { MyQuranExamList } from "./MyQuranExamScreen";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamHome">;

/** The Office's note for families (D-#877): blank = guardians see nothing at all. */
function GuardianNoteCard({ exam, refetch }: { exam: QxOverviewT; refetch: () => void }): React.ReactElement {
  const { can } = useAuth();
  const [note, setNote] = React.useState(exam.guardianNote ?? "");
  const [st, save] = useMutation(QX_SET_NOTE);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const manage = can("quran_exam:manage");
  return (
    <Card>
      <Field label={STR.qxGuardianNote} value={note} onChangeText={(t) => manage && setNote(t)} />
      <Muted>{STR.qxGuardianNoteHelp}</Muted>
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      {manage ? (
        <Button
          title={STR.qxSave}
          variant="secondary"
          loading={st.fetching}
          disabled={note.trim() === (exam.guardianNote ?? "").trim()}
          onPress={async () => {
            const r = await save({ examId: exam.examId, note: note.trim() || null });
            setMsg(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.qxNoteSaved });
            if (!r.error) refetch();
          }}
        />
      ) : null}
    </Card>
  );
}

function PaperCard({ p, onPress }: { p: QxPaperT; onPress: () => void }): React.ReactElement {
  const rule =
    p.scheme === "HIFZ_DEDUCTION"
      ? `${STR.qxParaN.replace("{n}", p.paras.map((x) => bnNum(x)).join(", "))} · ${STR.qxHifzRule
          .replace("{t}", bnNum(p.tanbihPerMark ?? 4))
          .replace("{f}", bnNum(p.fathCost ?? 2))}`
      : p.sections.map((s) => `${s.title} ${bnNum(s.items.reduce((a, i) => a + i.marks, 0))}`).join(" · ");
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flex: 1 }}>{qxLevelLabel(p.level)}</Body>
        <Badge text={STR.qxFullMarks.replace("{n}", bnNum(p.fullMarks))} tone="brand" />
      </View>
      <Muted>{rule}</Muted>
    </Card>
  );
}

function Office({ exam, navigation, refetch }: { exam: QxOverviewT; navigation: Props["navigation"]; refetch: () => void }): React.ReactElement {
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const [pub, publish] = useMutation(QX_PUBLISH);
  const [lk, lock] = useMutation(QX_LOCK);
  const [err, setErr] = React.useState<string | null>(null);
  const published = exam.status === "PUBLISHED";
  const locked = !!exam.marksLockedAt;

  async function togglePublish() {
    if (!(await confirmAction({ title: published ? STR.qxUnpublish : STR.qxPublish, message: published ? STR.qxUnpublishConfirm : STR.qxPublishConfirm }))) return;
    const r = await publish({ examId: exam.examId, publish: !published });
    setErr(r.error ? friendlyError(r.error) : null);
    if (!r.error) refetch();
  }
  async function toggleLock() {
    if (!locked && !(await confirmAction({ title: STR.qxLock, message: STR.qxLockConfirm }))) return;
    const r = await lock({ examId: exam.examId, lock: !locked });
    setErr(r.error ? friendlyError(r.error) : null);
    if (!r.error) refetch();
  }

  return (
    <View style={{ gap: space(3) }}>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{exam.examName}</Body>
          <Badge text={published ? STR.qxPublished : STR.qxDraft} tone={published ? "ok" : "warn"} />
          {locked ? <Badge text={STR.qxLocked} tone="info" /> : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {can("quran_exam:publish") ? (
            <Button title={published ? STR.qxUnpublish : STR.qxPublish} variant={published ? "secondary" : "primary"} loading={pub.fetching} onPress={togglePublish} />
          ) : null}
          {can("quran_exam:lock") ? (
            <Button title={locked ? STR.qxUnlock : STR.qxLock} variant="secondary" loading={lk.fetching} onPress={toggleLock} />
          ) : null}
          <Button title={STR.qxMonitor} variant="secondary" onPress={() => navigation.navigate("QuranExamMonitor", { examId: exam.examId })} />
          <Button title={STR.qxResults} variant="ghost" onPress={() => navigation.navigate("QuranExamResults", { examId: exam.examId })} />
        </View>
        {err ? <Notice tone="danger" message={err} /> : null}
      </Card>

      <GuardianNoteCard key={exam.guardianNote ?? ""} exam={exam} refetch={refetch} />

      <H2>{STR.qxDays}</H2>
      {exam.days.map((d) => (
        <Card key={d.dateKey} onPress={() => navigation.navigate("QuranExamDay", { examId: exam.examId, dateKey: d.dateKey })}>
          <Body style={{ fontWeight: "700" }}>{fullDateLabel(d.dateKey)}</Body>
          <Muted>{STR.qxDayCounts.replace("{n}", bnNum(d.sittings)).replace("{e}", bnNum(d.examiners))}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            <Badge text={`${STR.qxDone} ${bnNum(d.done)}`} tone="ok" />
            <Badge text={`${STR.qxAbsent} ${bnNum(d.absent)}`} tone={d.absent ? "danger" : "muted"} />
            <Badge text={`${STR.qxPending} ${bnNum(d.pending)}`} tone={d.pending ? "warn" : "muted"} />
          </View>
        </Card>
      ))}

      <H2>{STR.qxPapers}</H2>
      {exam.papers.map((p) => (
        <PaperCard key={p.id} p={p} onPress={() => navigation.navigate("QuranExamPaper", { examId: exam.examId, level: p.level })} />
      ))}
    </View>
  );
}

export default function QuranExamHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const office = can("quran_exam:view") || can("quran_exam:manage");
  const [q, reexec] = useQuery({ query: QX_EXAMS, pause: !office });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);

  if (!office) {
    return <MyQuranExamList onOpen={(id) => navigation.navigate("QuranExamSitting", { id })} />;
  }
  const exam = q.data?.quranExams?.[0];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch} isEmpty={!exam} empty={<EmptyState message={STR.qxNoExam} />}>
        {exam ? <Office exam={exam} navigation={navigation} refetch={refetch} /> : null}
      </QueryGate>
      {can("quran_exam:examine") ? (
        <View style={{ marginTop: space(5) }}>
          <Button title={STR.qxMyDuties} variant="secondary" onPress={() => navigation.navigate("MyQuranExam")} />
        </View>
      ) : null}
    </Screen>
  );
}
