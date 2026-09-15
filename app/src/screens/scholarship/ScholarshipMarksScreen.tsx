/**
 * ScholarshipMarksScreen (SC-2) — per-item marks, one student at a time.
 *
 * The per-student sheet rather than a 14-column grid: at 360dp a grid of one column per
 * item cannot show a name and a cell at a readable size, and this is the shape the
 * class-test results screen already uses, so the transcription habit carries over.
 *
 * ABSENT clears the marks rather than zeroing them (D-#660) — a zero says "sat it and
 * scored nothing", which is a different fact and would drag her into every class mean.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { ENTER_SCHOLARSHIP_SCORES, SCHOLARSHIP_PAPER_QUERY } from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  Badge,
  Button,
  Chip,
  ChipRow,
  Field,
  Loader,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipMarks">;
type Nav = NativeStackNavigationProp<ScholarshipStackParamList>;

interface PaperItem {
  itemNo: number;
  questionNo: number | null;
  part: string | null;
  label: string;
  subject: string;
  topicLabel: string;
  marks: number;
}
interface RosterRow {
  studentId: string;
  nameBn: string;
  status: string | null;
  total: number | null;
  itemMarks: { itemNo: number; marks: number }[];
}

/**
 * The number as the PAPER prints it — `৭` or `১.a` — falling back to the storage key.
 *
 * `itemNo` is unique-per-paper and sequential; on a paper that declares every
 * alternative it runs 1..24 while the paper in front of the teacher says 1.a … 14.b
 * (D-#675). Marking against a column numbered differently from the question is how
 * marks land on the wrong item.
 */
function printedNo(it: { itemNo: number; questionNo: number | null; part: string | null }): string {
  const n = bnNum(it.questionNo ?? it.itemNo);
  return it.part ? `${n}.${it.part}` : n;
}

export default function ScholarshipMarksScreen({ route }: Props): React.ReactElement {
  const { paperId } = route.params;
  const nav = useNavigation<Nav>();
  const toast = useToast();
  const { can } = useAuth();

  const [{ data, fetching, error }, refetch] = useQuery({
    query: SCHOLARSHIP_PAPER_QUERY,
    variables: { id: paperId },
  });
  const [, enterScores] = useMutation(ENTER_SCHOLARSHIP_SCORES);

  const paper = data?.scholarshipPaper as
    | {
        id: string;
        paperId: string;
        name: string;
        subjects: string[];
        sectionId: string;
        classLevel: number;
        totalMarks: number;
        items: PaperItem[];
        roster: RosterRow[];
      }
    | undefined;

  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"PRESENT" | "ABSENT">("PRESENT");
  const [marks, setMarks] = useState<Record<number, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const student = paper?.roster[idx];

  // Re-seed the form whenever the selected student changes, so a half-typed row cannot
  // follow the teacher onto the next child.
  useEffect(() => {
    if (!student) return;
    setStatus(student.status === "ABSENT" ? "ABSENT" : "PRESENT");
    const seeded: Record<number, string> = {};
    for (const m of student.itemMarks) seeded[m.itemNo] = String(m.marks);
    setMarks(seeded);
    setSaveError(null);
  }, [student?.studentId, student?.status, student]);

  const runningTotal = useMemo(
    () =>
      Object.values(marks).reduce((a, v) => {
        const n = Number(v);
        return a + (Number.isFinite(n) ? Math.round(n * 2) : 0);
      }, 0) / 2,
    [marks],
  );

  async function onSave(next: boolean): Promise<void> {
    if (!paper || !student) return;
    setBusy(true);
    setSaveError(null);
    const res = await enterScores({
      paperId: paper.id,
      rows: [
        {
          studentId: student.studentId,
          status,
          itemMarks:
            status === "PRESENT"
              ? paper.items
                  .filter((it) => (marks[it.itemNo] ?? "").trim() !== "")
                  .map((it) => ({ itemNo: it.itemNo, marks: Number(marks[it.itemNo]) }))
              : [],
        },
      ],
    });
    setBusy(false);
    if (res.error) {
      setSaveError(friendlyError(res.error));
      return;
    }
    toast.show(STR.scSaved);
    refetch({ requestPolicy: "network-only" });
    if (next && paper.roster.length > idx + 1) setIdx(idx + 1);
  }

  if (fetching && !paper) return <Screen><Loader /></Screen>;
  if (error) return <Screen><Notice message={friendlyError(error)} tone="danger" /></Screen>;
  if (!paper) return <Screen><Notice message={STR.errGeneric} tone="danger" /></Screen>;

  const readOnly = !can("scholarship:manage");

  return (
    <Screen scroll>
      <Card>
        <Body style={{ fontWeight: "700" }}>{paper.name}</Body>
        <Muted>
          {paper.paperId} · {paper.subjects.map(hwSubjectLabel).join(" + ")} · {bnNum(paper.totalMarks)}{" "}
          {STR.scItemMarks}
        </Muted>
      </Card>

      <View style={{ flexDirection: "row", gap: space(3), marginBottom: space(3) }}>
        <Button title="‹" variant="ghost" onPress={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} />
        <View style={{ flexGrow: 1, alignItems: "center" }}>
          <Body style={{ fontWeight: "700" }}>{student?.nameBn ?? "—"}</Body>
          <Muted>
            {bnNum(idx + 1)} / {bnNum(paper.roster.length)}
          </Muted>
        </View>
        <Button
          title="›"
          variant="ghost"
          onPress={() => setIdx(Math.min(paper.roster.length - 1, idx + 1))}
          disabled={idx >= paper.roster.length - 1}
        />
      </View>

      <ChipRow>
        <Chip label={STR.scPresent} selected={status === "PRESENT"} onPress={() => setStatus("PRESENT")} />
        <Chip label={STR.scAbsent} selected={status === "ABSENT"} onPress={() => setStatus("ABSENT")} />
      </ChipRow>

      {status === "PRESENT" ? (
        <>
          {paper.items.map((it) => (
            <Card key={it.itemNo}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
                <View style={{ flexShrink: 1 }}>
                  <Body>
                    {printedNo(it)}. {it.label}
                  </Body>
                  <Muted>
                    {it.topicLabel}
                    {paper.subjects.length > 1 ? ` · ${hwSubjectLabel(it.subject)}` : ""}
                  </Muted>
                </View>
                <Badge text={`${STR.scMarksOutOf} ${bnNum(it.marks)}`} tone="muted" />
              </View>
              <Field
                label=""
                value={marks[it.itemNo] ?? ""}
                onChangeText={(v) => setMarks((prev) => ({ ...prev, [it.itemNo]: v }))}
                keyboardType="decimal-pad"
                editable={!readOnly}
              />
            </Card>
          ))}
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
              <Muted>{STR.scTotal}</Muted>
              <Body style={{ fontWeight: "700" }}>
                {bnNum(runningTotal)} / {bnNum(paper.totalMarks)}
              </Body>
            </View>
          </Card>
        </>
      ) : (
        <Notice message={STR.scAbsent} tone="warn" />
      )}

      {saveError ? <Notice message={saveError} tone="danger" /> : null}
      {!readOnly ? (
        <Button title={STR.scSave} onPress={() => void onSave(true)} loading={busy} disabled={busy} />
      ) : null}

      <Divider />
      <Button
        title={STR.scAnalysis}
        variant="secondary"
        onPress={() =>
          student
            ? nav.navigate("ScholarshipStudent", {
                sectionId: paper.sectionId,
                classLevel: paper.classLevel,
                studentId: student.studentId,
                name: student.nameBn,
              })
            : undefined
        }
      />
    </Screen>
  );
}
