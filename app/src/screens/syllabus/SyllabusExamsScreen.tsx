/**
 * SyllabusExamsScreen (SY-7) — create and edit the exam itself.
 *
 * Until this screen existed the ONLY way to create an exam was the `createExam`
 * mutation over GraphQL, which made the whole module unreachable to the people
 * who actually use it: Office cannot open a GraphQL client, so step one of the
 * feature required a developer.
 *
 * Two rules the form has to carry, because both are irreversible:
 *
 *  - **Year and term are set once.** Together they are the row's identity and its
 *    unique index, and every syllabus hangs off the exam id — moving an exam to
 *    another term would silently re-home all of them. So they are pickers when
 *    creating and plain text when editing, with the reason stated on screen
 *    rather than left for someone to discover.
 *  - **One exam per (year × term).** The server refuses a duplicate; this screen
 *    disables the term that already exists for the chosen year, so the refusal is
 *    something you can see coming rather than something you run into.
 */
import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { EXAMS, CREATE_EXAM, UPDATE_EXAM, type ExamT } from "../../graphql/exams";
import { ACADEMIC_YEARS_QUERY } from "../../graphql/operations";
import {
  Screen,
  Body,
  Muted,
  Card,
  Field,
  Button,
  Select,
  Notice,
  ErrorBanner,
  EmptyState,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { QueryGate } from "../../components/QueryGate";
import { STR, examTermLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space, typeScale } from "../../theme/tokens";
import { EXAM_TERMS } from "@scd/shared";

export default function SyllabusExamsScreen(): React.ReactElement {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = useMemo(() => yearsQ.data?.academicYears ?? [], [yearsQ.data?.academicYears]);
  const currentYearId = useMemo(
    () => (years.find((y) => y.current) ?? years[0])?.id ?? null,
    [years],
  );

  const [yearId, setYearId] = useState<string | null>(null);
  useEffect(() => {
    if (yearId === null && currentYearId) setYearId(currentYearId);
  }, [currentYearId, yearId]);

  const [examsQ, refetchExams] = useQuery({
    query: EXAMS,
    variables: { academicYearId: yearId },
    pause: !yearId,
  });
  const exams = useMemo(() => examsQ.data?.exams ?? [], [examsQ.data?.exams]);

  const refresh = usePullRefresh(examsQ.fetching, () =>
    refetchExams({ requestPolicy: "network-only" }),
  );

  // --- create form ---------------------------------------------------------
  const [term, setTerm] = useState<string>("ANNUAL");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** Terms this year does NOT already have — the duplicate rule, made visible. */
  const freeTerms = useMemo(
    () => EXAM_TERMS.filter((t) => !exams.some((e) => e.term === t)),
    [exams],
  );

  // Keep the term choice on something that can actually be created.
  useEffect(() => {
    if (freeTerms.length > 0 && !freeTerms.includes(term as (typeof EXAM_TERMS)[number])) {
      setTerm(freeTerms[0]);
    }
  }, [freeTerms, term]);

  const [, create] = useMutation(CREATE_EXAM);
  const [, update] = useMutation(UPDATE_EXAM);

  async function onCreate(): Promise<void> {
    setErr(null);
    setSaved(false);
    if (!yearId || !name.trim()) return;
    const res = await create({
      academicYearId: yearId,
      term,
      name: name.trim(),
      startDateKey: start || null,
      endDateKey: end || null,
    });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setName("");
    setStart("");
    setEnd("");
    setSaved(true);
    refetchExams({ requestPolicy: "network-only" });
  }

  // --- edit ----------------------------------------------------------------
  const [editing, setEditing] = useState<ExamT | null>(null);
  const [eName, setEName] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");

  function beginEdit(x: ExamT): void {
    setEditing(x);
    setEName(x.name);
    setEStart(x.startDateKey ?? "");
    setEEnd(x.endDateKey ?? "");
    setErr(null);
    setSaved(false);
  }

  async function onUpdate(): Promise<void> {
    if (!editing) return;
    setErr(null);
    const res = await update({
      id: editing.id,
      name: eName.trim() || null,
      startDateKey: eStart || null,
      endDateKey: eEnd || null,
    });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setEditing(null);
    setSaved(true);
    refetchExams({ requestPolicy: "network-only" });
  }

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}
    >
      {err ? <ErrorBanner message={err} /> : null}
      {saved ? <Notice message={STR.syExamSaved} tone="ok" /> : null}

      <Select
        label={STR.syExamYear}
        value={yearId}
        options={years.map((y) => ({ label: y.label, value: y.id }))}
        onChange={(v) => {
          setYearId(v);
          setEditing(null);
        }}
      />

      <QueryGate result={examsQ} onRetry={() => refetchExams({ requestPolicy: "network-only" })}>
        {exams.length === 0 ? (
          <EmptyState message={STR.syExamNone} />
        ) : (
          <View style={{ gap: space(2) }}>
            {exams.map((x) => (
              <Card key={x.id}>
                {editing?.id === x.id ? (
                  <>
                    {/* Year and term are shown, never offered — see the header note. */}
                    <Muted>
                      {examTermLabel(x.term)} · {years.find((y) => y.id === x.academicYearId)?.label ?? ""}
                    </Muted>
                    <Field label={STR.syExamName} value={eName} onChangeText={setEName} />
                    <DateField label={STR.syExamStart} value={eStart} onChange={setEStart} />
                    <DateField
                      label={STR.syExamEnd}
                      value={eEnd}
                      onChange={setEEnd}
                      min={eStart || undefined}
                    />
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={STR.cancel}
                          variant="secondary"
                          onPress={() => setEditing(null)}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={STR.sySave}
                          disabled={!eName.trim()}
                          onPress={onUpdate}
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <Body style={typeScale.bodyStrong}>{x.name}</Body>
                    <Muted>{examTermLabel(x.term)}</Muted>
                    {x.startDateKey || x.endDateKey ? (
                      <Muted>
                        {x.startDateKey ?? "—"} → {x.endDateKey ?? "—"}
                      </Muted>
                    ) : null}
                    <Button
                      title={STR.syExamEdit}
                      variant="ghost"
                      onPress={() => beginEdit(x)}
                    />
                  </>
                )}
              </Card>
            ))}
          </View>
        )}
      </QueryGate>

      <Card>
        <Body style={{ ...typeScale.bodyStrong, marginBottom: space(2) }}>{STR.syNewExam}</Body>

        {freeTerms.length === 0 ? (
          // Both terms already exist for this year. Saying so beats offering a
          // button whose only outcome is the duplicate refusal.
          <Muted>{STR.syExamTermLocked}</Muted>
        ) : (
          <>
            <Select
              label={STR.syExamTerm}
              value={term}
              options={freeTerms.map((t) => ({ label: examTermLabel(t), value: t }))}
              onChange={setTerm}
            />
            <Field
              label={STR.syExamName}
              value={name}
              onChangeText={setName}
              placeholder={STR.syExamNameHint}
            />
            <DateField label={STR.syExamStart} value={start} onChange={setStart} />
            <DateField
              label={STR.syExamEnd}
              value={end}
              onChange={setEnd}
              min={start || undefined}
            />
            <Muted>{STR.syExamTermLocked}</Muted>
            <Button
              title={STR.syExamCreate}
              disabled={!yearId || !name.trim()}
              onPress={onCreate}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}
