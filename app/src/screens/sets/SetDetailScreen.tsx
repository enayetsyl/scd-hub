/**
 * SetDetailScreen (S8 / J3.4) — set metadata, the full question list with answers,
 * and server-side PDF export. A DRAFT set can be edited here (add / remove questions)
 * and offers a shortcut to AssembleSet; an ASSEMBLED set is locked (D-#set-edit) and
 * exposes the PDF answers/marks toggles.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { ASSESSMENT_SET_QUERY, REMOVE_QUESTION_FROM_SET, RENAME_SET } from "../../graphql/operations";
import type { SetsStackParamList, TabParamList } from "../../navigation/types";
import {
  Screen,
  H1,
  Body,
  Muted,
  Card,
  Row,
  Badge,
  Chip,
  ChipRow,
  Button,
  Field,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, setTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { parsePayload, prettyCode, type QuestionPayload } from "../../lib/question";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { space, useColors } from "../../theme";

type Props = NativeStackScreenProps<SetsStackParamList, "SetDetail">;

export default function SetDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { setId } = route.params;
  const tabNav = useNavigation<NavigationProp<TabParamList>>();
  // cache-and-network: assembleSet returns an AssembleResult (a different __typename
  // than AssessmentSet), so urql's document cache never invalidates this query on
  // finalise. Revalidating on mount keeps a re-opened set from showing a stale draft.
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSESSMENT_SET_QUERY,
    variables: { id: setId },
    requestPolicy: "cache-and-network",
  });
  const [, removeQuestion] = useMutation(REMOVE_QUESTION_FROM_SET);
  const [, renameSetMut] = useMutation(RENAME_SET);
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // PDF options — default OFF = a clean student paper; toggle on for the answer key.
  const [showAnswers, setShowAnswers] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const s = data?.assessmentSet;

  async function onExport(): Promise<void> {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const q = `?answers=${showAnswers ? 1 : 0}&marks=${showMarks ? 1 : 0}`;
      await openPdf(`/pdf/set/${setId}${q}`);
    } catch {
      setPdfError(STR.pdfError);
    } finally {
      setPdfBusy(false);
    }
  }

  async function onRemove(artifactId: string): Promise<void> {
    if (!(await confirmAction({ message: STR.setRemoveQuestionConfirm, confirmLabel: STR.remove }))) return;
    setBusyId(artifactId);
    const res = await removeQuestion({ setId, artifactId });
    setBusyId(null);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.setQuestionRemoved, "ok");
  }

  function startRename(): void {
    setNameInput(s?.name ?? "");
    setEditingName(true);
  }

  async function onSaveName(): Promise<void> {
    setNameBusy(true);
    const res = await renameSetMut({ setId, name: nameInput.trim() });
    setNameBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    setEditingName(false);
  }

  function onAddQuestions(): void {
    // QuestionBank is the Questions-tab root; navigating with the param flips it into
    // add-to-this-set mode (it clears the param on blur — see QuestionBankScreen).
    tabNav.navigate("QuestionsTab", { screen: "QuestionBank", params: { addToSetId: setId } });
  }

  if (fetching && !s) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  const assembled = s.status === "assembled";

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H1>{s.name || setTypeLabel(s.setType)}</H1>
        <Badge text={assembled ? STR.statusAssembled : STR.statusDraft} tone={assembled ? "ok" : "warn"} />
      </View>

      {editingName ? (
        <Card>
          <Field label={STR.setName} value={nameInput} onChangeText={setNameInput} placeholder={STR.setNamePlaceholder} />
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Button title={STR.cancel} variant="ghost" onPress={() => setEditingName(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={nameBusy ? STR.saving : STR.save} onPress={onSaveName} loading={nameBusy} />
            </View>
          </View>
        </Card>
      ) : (
        <Button title={STR.rename} variant="ghost" onPress={startRename} />
      )}

      <Card>
        <Row label={STR.setType} value={setTypeLabel(s.setType)} />
        <Row label={STR.status} value={assembled ? STR.statusAssembled : STR.statusDraft} />
        <Row label={STR.totalMarks} value={bnNum(s.totalMarks ?? s.basketItems.reduce((a, b) => a + b.marks, 0))} />
        {/* BOTH, because they answer different questions (QT-2, D-#607): examMinutes is how
            long the questions take, durationMinutes is how long THIS set claims to take. For
            homework the second is double the first, and showing only one hides that. */}
        {s.examMinutes != null ? <Row label={STR.examMinutes} value={bnNum(s.examMinutes)} /> : null}
        {s.durationMinutes != null ? <Row label={STR.durationMinutes} value={bnNum(s.durationMinutes)} /> : null}
        {s.dueDate ? <Row label={STR.dueDate} value={s.dueDate.slice(0, 10)} /> : null}
      </Card>

      {assembled ? (
        PDF_SUPPORTED ? (
          <>
            <Muted>{STR.exportPdf}</Muted>
            <ChipRow>
              <Chip label={STR.showAnswers} selected={showAnswers} onPress={() => setShowAnswers((v) => !v)} />
              <Chip label={STR.showMarks} selected={showMarks} onPress={() => setShowMarks((v) => !v)} />
            </ChipRow>
            <Button title={pdfBusy ? STR.preparingPdf : STR.exportPdf} onPress={onExport} loading={pdfBusy} variant="secondary" />
            {/* PQ-3 (D-#281): send this assembled set to the Office print queue. No PDF
                snapshot — an assembled set is locked, so the setId alone is immutable. */}
            <Button
              title={`🖨️ ${STR.prSend}`}
              variant="secondary"
              onPress={() =>
                tabNav.navigate("PrintTab", {
                  screen: "NewPrintRequest",
                  params: { setId, title: s.name ?? STR.prTitle },
                  initial: false,
                })
              }
            />
          </>
        ) : (
          <Notice message={STR.pdfWebOnly} tone="warn" />
        )
      ) : (
        <>
          <Button title={STR.addQuestions} onPress={onAddQuestions} variant="secondary" />
          <Button
            title={STR.assemble}
            onPress={() => navigation.navigate("AssembleSet", { setId: s.id, setType: s.setType })}
            style={{ marginTop: space(2) }}
          />
        </>
      )}
      {pdfError ? <Notice message={pdfError} tone="danger" /> : null}

      <Divider />
      <Muted>
        {STR.questionsWord} ({bnNum(s.basketItems.length)})
      </Muted>
      {s.basketItems.map((item, i) => (
        <QuestionCard
          key={item.artifactId}
          num={i + 1}
          marks={item.marks}
          qid={item.qid}
          payload={parsePayload(item.payloadJson)}
          removable={!assembled}
          removing={busyId === item.artifactId}
          onRemove={() => void onRemove(item.artifactId)}
        />
      ))}
    </Screen>
  );
}

/** One question with its answer carrier — the teacher's answer view (J3). */
function QuestionCard({
  num,
  marks,
  qid,
  payload,
  removable,
  removing,
  onRemove,
}: {
  num: number;
  marks: number;
  qid: string;
  payload: QuestionPayload;
  removable: boolean;
  removing: boolean;
  onRemove: () => void;
}): React.ReactElement {
  const colors = useColors();
  const text = payload.question_text ?? "";
  const type = payload.question_type ?? "";

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <Muted style={{ fontWeight: "700" }}>{qid}</Muted>
        <Badge text={`${bnNum(marks)} ${STR.marks}`} tone="brand" />
      </View>
      <Body style={{ marginTop: 4 }}>
        {bnNum(num)}. {text || "—"}
      </Body>
      {type ? <View style={{ marginTop: space(1) }}><Badge text={prettyCode(type)} tone="muted" /></View> : null}

      <View style={{ marginTop: space(2) }}>
        <AnswerCarrier payload={payload} correctColor={colors.primary} />
      </View>

      {removable ? (
        <Button title={removing ? STR.saving : STR.remove} variant="ghost" onPress={onRemove} loading={removing} />
      ) : null}
    </Card>
  );
}
