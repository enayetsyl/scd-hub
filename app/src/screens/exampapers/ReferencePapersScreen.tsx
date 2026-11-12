/**
 * ReferencePapersScreen (D-#1030) — Mohammadpur's past papers (half-yearly + annual, 2025/2026).
 *
 *  - exam_papers:view_reference reads every paper (filter by year, exam, class) and opens the
 *    original file.
 *  - exam_papers:manage_reference also uploads a PDF (rendered to page images on the server),
 *    and deletes a paper. A PROCESSING paper polls until its pages are ready.
 */
import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ROSTER_CLASS_LEVELS } from "@scd/shared";
import { DELETE_REFERENCE_PAPER, REFERENCE_PAPERS_QUERY, type ReferencePaperT } from "../../graphql/examPapers";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { FileUploadError, openStoredFile, pickAndUploadReferencePaper } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import type { ExamPapersStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { fill, subjectLabel, termLabel } from "./common";

type Props = NativeStackScreenProps<ExamPapersStackParamList, "ReferencePapers">;

const SUBJECTS = ["BAN", "ENG", "MATH", "ISLAM", "SCI", "BGS", "ARABIC", "ICT", "BAN2", "ENG2"] as const;

function UploadCard({ onDone }: { onDone: (m: { tone: "ok" | "danger"; text: string }) => void }): React.ReactElement {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState<"HALF_YEARLY" | "ANNUAL">("ANNUAL");
  const [level, setLevel] = useState<string>("1");
  const [subject, setSubject] = useState<string>("BAN");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const classOptions = [
    ...ROSTER_CLASS_LEVELS.map((l) => ({ value: String(l), label: classLevelLabel(l) })),
    { value: "none", label: STR.epCrossClass },
  ];
  const upload = async (): Promise<void> => {
    setBusy(true);
    try {
      const classLevel = level === "none" ? null : Number(level);
      const res = await pickAndUploadReferencePaper({
        term,
        year: Number(year),
        classLevel,
        subject,
        title: title.trim() || `${classLevel === null ? "" : `${classLevelLabel(classLevel)} · `}${subjectLabel(subject)}`,
      });
      if (!res) return;
      setTitle("");
      onDone({ tone: "ok", text: STR.epRefUploaded });
    } catch (e) {
      onDone({ tone: "danger", text: e instanceof FileUploadError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.epRefUploadTitle}</Body>
      <Field label={STR.epYear} value={year} onChangeText={(t) => setYear(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" />
      <Select
        label={STR.epTerm}
        value={term}
        options={[
          { value: "HALF_YEARLY", label: STR.epTermHalf },
          { value: "ANNUAL", label: STR.epTermAnnual },
        ]}
        onChange={setTerm}
      />
      <Select label={STR.epClass} value={level} options={classOptions} onChange={setLevel} />
      <Select label={STR.epSubject} value={subject} options={SUBJECTS.map((s) => ({ value: s, label: subjectLabel(s) }))} onChange={setSubject} />
      <Field label={STR.epTitleField} value={title} onChangeText={setTitle} placeholder={STR.epTitlePh} autoCapitalize="sentences" />
      <Button title={busy ? STR.epRefUploading : STR.epRefUploadPick} loading={busy} onPress={() => void upload()} />
    </Card>
  );
}

export default function ReferencePapersScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const manage = can("exam_papers:manage_reference");
  const { confirmAction } = useConfirm();
  const [q, refetchQ] = useQuery({ query: REFERENCE_PAPERS_QUERY, variables: {} });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const [, del] = useMutation(DELETE_REFERENCE_PAPER);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [year, setYear] = useState<number | "all">("all");
  const [term, setTerm] = useState<string | "all">("all");
  const [level, setLevel] = useState<number | "all">("all");

  const all = q.data?.referencePapers ?? [];
  const years = useMemo(() => [...new Set(all.map((p) => p.year))].sort((a, b) => b - a), [all]);
  const levels = useMemo(
    () => [...new Set(all.map((p) => p.classLevel).filter((l): l is number => l !== null))].sort((a, b) => a - b),
    [all],
  );
  const papers = all.filter(
    (p) => (year === "all" || p.year === year) && (term === "all" || p.term === term) && (level === "all" || p.classLevel === level),
  );

  const processing = all.some((p) => p.status === "PROCESSING");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refetch, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  const open = (p: ReferencePaperT): void =>
    navigation.navigate("ReferencePaperReader", {
      paperId: p.id,
      title: p.title,
      pageCount: p.pageCount,
      pageAspect: p.pageAspect,
      sourceFileId: p.sourceFileId,
    });

  const remove = async (p: ReferencePaperT): Promise<void> => {
    if (!(await confirmAction({ title: STR.epRefDeleteTitle, message: STR.epRefDeleteBody, tone: "danger" }))) return;
    const r = await del({ id: p.id });
    if (r.error) setMsg({ tone: "danger", text: friendlyError(r.error) });
    else refetch();
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Notice tone="info" message={STR.epRefHint} />
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        {manage ? (
          <UploadCard
            onDone={(m) => {
              setMsg(m);
              if (m.tone === "ok") refetch();
            }}
          />
        ) : null}
        <ChipRow>
          <Chip label={STR.all} selected={year === "all"} onPress={() => setYear("all")} />
          {years.map((y) => (
            <Chip key={y} label={bnNum(y)} selected={year === y} onPress={() => setYear(y)} />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip label={STR.all} selected={term === "all"} onPress={() => setTerm("all")} />
          <Chip label={STR.epTermHalf} selected={term === "HALF_YEARLY"} onPress={() => setTerm("HALF_YEARLY")} />
          <Chip label={STR.epTermAnnual} selected={term === "ANNUAL"} onPress={() => setTerm("ANNUAL")} />
        </ChipRow>
        {levels.length > 1 ? (
          <ChipRow>
            <Chip label={STR.all} selected={level === "all"} onPress={() => setLevel("all")} />
            {levels.map((l) => (
              <Chip key={l} label={classLevelLabel(l)} selected={level === l} onPress={() => setLevel(l)} />
            ))}
          </ChipRow>
        ) : null}
        <QueryGate result={q} onRetry={refetch} loaderLabel={STR.loading}>
          {papers.length === 0 ? (
            <EmptyState message={STR.epRefEmpty} />
          ) : (
            <View style={{ marginTop: space(2) }}>
              {papers.map((p) => (
                <Card key={p.id} onPress={p.status === "READY" ? () => open(p) : undefined} style={{ marginBottom: space(2) }}>
                  <Body style={{ fontWeight: "700" }}>{p.title}</Body>
                  <Muted>
                    {bnNum(p.year)} · {termLabel(p.term)} · {p.classLabelBn ?? STR.epCrossClass} · {subjectLabel(p.subject)}
                  </Muted>
                  {p.sourceName ? <Muted>📄 {p.sourceName}</Muted> : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                    {p.status === "READY" ? <Badge text={fill(STR.epPages, { n: bnNum(p.pageCount) })} tone="muted" /> : null}
                    {p.status === "PROCESSING" ? <Badge text={STR.epRefProcessing} tone="warn" /> : null}
                    {p.status === "FAILED" ? <Badge text={p.error ?? "FAILED"} tone="danger" /> : null}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                    {p.sourceFileId ? (
                      <Button title={STR.epOpenOriginal} variant="secondary" onPress={() => void openStoredFile(p.sourceFileId!)} />
                    ) : null}
                    {manage ? <Button title={STR.epRefDelete} variant="danger" onPress={() => void remove(p)} /> : null}
                  </View>
                </Card>
              ))}
            </View>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
