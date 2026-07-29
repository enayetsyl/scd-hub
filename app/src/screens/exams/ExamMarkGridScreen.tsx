/**
 * ExamMarkGridScreen (EX-3) — the checker's roster grid.
 *
 * Laid out one row per student in schoolId order, deliberately matching the paper mark
 * sheet the checker is reading from, so transcription is line-for-line and the eye does
 * not have to jump.
 *
 * Two things this screen must get right, both from D-#377/#378:
 *   · FINAL is typed on the SCRIPT's scale (the scans show 80/100/200) and the converted
 *     component value is shown live beside it — the hand arithmetic in the source margins
 *     is exactly what that preview replaces.
 *   · A CT pull proposes; it never silently fills. A student with no class-test history
 *     shows "no history — stays blank", never a 0.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { convertMark } from "@scd/shared";
import {
  EXAM_PAPERS_QUERY,
  EXAM_MARKS_QUERY,
  EXAM_CT_PROPOSALS_QUERY,
  ENTER_EXAM_MARKS,
  APPLY_EXAM_CT_PULL,
  EXAM_PAPER_ROSTER_QUERY,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice, Field, Divider } from "../../components/ui";
import { STR, bnNum, examComponentLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ExamsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ExamsStackParamList, "ExamMarkGrid">;

export default function ExamMarkGridScreen({ route }: Props): React.ReactElement {
  const { paperId } = route.params;

  // The paper list is the only read that carries a paper's shape; filter to this one.
  const [papersQ] = useQuery({ query: EXAM_PAPERS_QUERY, variables: { examId: route.params.examId ?? "" }, pause: !route.params.examId });
  const paper = (papersQ.data?.examPapers ?? []).find((p) => p.id === paperId) ?? null;

  // The server returns the roster already in printed (schoolId) order, so the screen and
  // the paper mark sheet read line-for-line.
  const [studentsQ] = useQuery({ query: EXAM_PAPER_ROSTER_QUERY, variables: { paperId } });
  const students = studentsQ.data?.examPaperRoster ?? [];

  const [marksQ, refetchMarks] = useQuery({ query: EXAM_MARKS_QUERY, variables: { paperId } });
  const marks = marksQ.data?.examMarks ?? [];
  const markKey = (studentId: string, component: string) => `${studentId}|${component}`;
  const markByKey = useMemo(() => {
    const m = new Map<string, (typeof marks)[number]>();
    for (const r of marks) m.set(markKey(r.studentId, r.component), r);
    return m;
  }, [marks]);

  const hasCt = !!paper?.components.some((c) => c.component === "CT");
  const [proposalsQ] = useQuery({
    query: EXAM_CT_PROPOSALS_QUERY,
    variables: { paperId },
    pause: !hasCt,
  });
  const proposalByStudent = useMemo(() => {
    const m = new Map<string, { value: number | null; testsCounted: number; mode: string; bestN: number }>();
    for (const p of proposalsQ.data?.examCtProposals ?? []) m.set(p.studentId, p);
    return m;
  }, [proposalsQ.data]);

  const [, enterMarks] = useMutation(ENTER_EXAM_MARKS);
  const [, applyPull] = useMutation(APPLY_EXAM_CT_PULL);

  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [absent, setAbsent] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openStudent(studentId: string): void {
    setError(null); setOk(null); setOpenId(studentId);
    const d: Record<string, string> = {};
    const a: Record<string, boolean> = {};
    for (const c of paper?.components ?? []) {
      const existing = markByKey.get(markKey(studentId, c.component));
      d[c.component] = existing?.rawMark != null ? String(existing.rawMark) : "";
      a[c.component] = existing?.status === "ABSENT";
    }
    setDraft(d);
    setAbsent(a);
  }

  /** The entry scale differs by component: FINAL is the script's own full marks. */
  function scaleFor(component: string): number {
    if (!paper) return 100;
    if (component === "FINAL") return paper.paperFullMarks;
    return paper.components.find((c) => c.component === component)?.maxMarks ?? 100;
  }

  /** The live preview — the SAME nearest-0.5 helper the server and the PDF use, so the
   *  three can never disagree about what will print. */
  function previewFor(component: string, raw: string): string | null {
    if (component !== "FINAL" || !paper) return null;
    const n = Number(raw);
    if (!raw.trim() || Number.isNaN(n)) return null;
    const max = paper.components.find((c) => c.component === "FINAL")?.maxMarks ?? 0;
    if (!max || paper.paperFullMarks <= 0) return null;
    return String(convertMark(n, paper.paperFullMarks, max));
  }

  async function onSave(): Promise<void> {
    if (!openId || !paper) return;
    setError(null); setOk(null);

    // PRESENT and ABSENT go in SEPARATE calls. The mutation's `rawMarks` is a [Float!]
    // list positionally matched to the entries, so it cannot carry a null for an absent
    // row — mixing the two in one call would silently misalign every mark after the first
    // absence.
    const present: { component: string; mark: number }[] = [];
    const absentComponents: string[] = [];

    for (const c of paper.components) {
      const isAbsent = absent[c.component] === true;
      const raw = (draft[c.component] ?? "").trim();
      if (isAbsent) {
        absentComponents.push(c.component);
        continue;
      }
      // A component left untouched stays UNENTERED, which is meaningfully different from
      // a 0 (D-#378) — so skip it rather than writing a zero.
      if (!raw) continue;
      const n = Number(raw);
      if (Number.isNaN(n)) return setError(STR.errGeneric);
      present.push({ component: c.component, mark: n });
    }
    if (!present.length && !absentComponents.length) return setOpenId(null);

    setBusy(true);
    if (present.length) {
      const res = await enterMarks({
        paperId,
        studentIds: present.map(() => openId),
        components: present.map((p) => p.component),
        statuses: present.map(() => "PRESENT"),
        rawMarks: present.map((p) => p.mark),
      });
      if (res.error) { setBusy(false); return setError(friendlyError(res.error)); }
    }
    if (absentComponents.length) {
      const res = await enterMarks({
        paperId,
        studentIds: absentComponents.map(() => openId),
        components: absentComponents,
        statuses: absentComponents.map(() => "ABSENT"),
        rawMarks: null,
      });
      if (res.error) { setBusy(false); return setError(friendlyError(res.error)); }
    }
    setBusy(false);
    setOk(STR.exSaved);
    setOpenId(null);
    refetchMarks({ requestPolicy: "network-only" });
  }

  async function onPullCt(): Promise<void> {
    setError(null); setOk(null); setBusy(true);
    const res = await applyPull({ paperId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(`${bnNum(res.data?.applyExamCtPull ?? 0)} ${STR.exCtPulled}`);
    refetchMarks({ requestPolicy: "network-only" });
  }

  if (papersQ.fetching || studentsQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!paper) {
    return (
      <Screen>
        <Notice message={STR.errGeneric} tone="danger" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(paper.subject)}</Body>
          <Muted>
            {STR.exFullMarks}: {bnNum(paper.paperFullMarks)} ·{" "}
            {paper.components.map((c) => `${examComponentLabel(c.component)} ${bnNum(c.maxMarks)}`).join(" + ")}
          </Muted>
          {paper.tabulatedAt ? <Badge text={STR.exTabulated} tone="ok" /> : null}
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {hasCt ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.exPullCt}</Body>
            <Muted>{STR.exCtNoHistory}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.exPullCt} variant="secondary" onPress={onPullCt} loading={busy} disabled={busy || !!paper.tabulatedAt} />
            </View>
          </Card>
        ) : (
          <Card>
            <Muted>{STR.exNoCtComponent}</Muted>
          </Card>
        )}

        {students.map((s, i) => {
          const isOpen = openId === s.id;
          const proposal = proposalByStudent.get(s.id);
          return (
            <Card key={s.id}>
              {i > 0 ? null : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                  <Muted>{s.schoolId}</Muted>
                </View>
                <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {paper.components.map((c) => {
                    const m = markByKey.get(markKey(s.id, c.component));
                    return (
                      <Badge
                        key={c.component}
                        text={
                          !m
                            ? `${c.component} —`
                            : m.status === "ABSENT"
                              ? `${c.component} ${STR.exAbsent}`
                              : `${c.component} ${bnNum(m.componentValue)}`
                        }
                        tone={!m ? "muted" : m.status === "ABSENT" ? "warn" : "ok"}
                      />
                    );
                  })}
                </View>
              </View>

              {!isOpen ? (
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={STR.exEnterMarks}
                    variant="secondary"
                    onPress={() => openStudent(s.id)}
                    disabled={!!paper.tabulatedAt}
                  />
                </View>
              ) : (
                <View style={{ marginTop: space(2) }}>
                  {paper.components.map((c) => {
                    const scale = scaleFor(c.component);
                    const preview = previewFor(c.component, draft[c.component] ?? "");
                    const isAbsent = absent[c.component] === true;
                    return (
                      <View key={c.component} style={{ marginTop: space(2) }}>
                        <Divider />
                        <Body style={{ fontWeight: "700", marginTop: space(2) }}>
                          {examComponentLabel(c.component)}
                        </Body>
                        {c.component === "CT" && proposal ? (
                          <Muted>
                            {proposal.value === null
                              ? STR.exCtNoHistory
                              : `${STR.exCtProposal} ${bnNum(proposal.value)} · ${STR.exCtRule}: ${proposal.mode === "BEST_N" ? `best ${bnNum(proposal.bestN)}` : "mean"} (${bnNum(proposal.testsCounted)})`}
                          </Muted>
                        ) : null}
                        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                          <Chip
                            label={STR.exPresent}
                            selected={!isAbsent}
                            onPress={() => setAbsent((p) => ({ ...p, [c.component]: false }))}
                          />
                          <Chip
                            label={STR.exAbsent}
                            selected={isAbsent}
                            onPress={() => setAbsent((p) => ({ ...p, [c.component]: true }))}
                          />
                        </View>
                        {!isAbsent ? (
                          <View style={{ marginTop: space(1) }}>
                            <Field
                              label={`${STR.exRawOutOf} ${bnNum(scale)})`}
                              value={draft[c.component] ?? ""}
                              onChangeText={(v) => setDraft((p) => ({ ...p, [c.component]: v }))}
                              keyboardType="numeric"
                            />
                            {preview !== null ? (
                              <Muted>
                                {STR.exConverted}: {bnNum(preview)} / {bnNum(c.maxMarks)}
                              </Muted>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}

                  <View style={{ flexDirection: "row", gap: space(2), marginTop: space(3) }}>
                    <Button title={STR.exSave} onPress={onSave} loading={busy} disabled={busy} />
                    <Button title={STR.cancel} variant="ghost" onPress={() => setOpenId(null)} />
                  </View>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
