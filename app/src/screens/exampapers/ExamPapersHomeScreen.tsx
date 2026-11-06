/**
 * ExamPapersHomeScreen (D-#1031–#1033) — the draft question papers.
 *
 *  - A REVIEWER (anyone; exam_papers:review is SELF) sees only the papers given to them.
 *  - exam_papers:view sees every draft with its review progress (read only).
 *  - exam_papers:manage also selects papers and assigns the reviewer (one notification
 *    to the reviewer per assignment).
 *  - exam_papers:view_reference gets a link to the Mohammadpur papers shelf.
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ASSIGN_EXAM_PAPER_REVIEWER,
  EXAM_PAPER_DRAFTS_QUERY,
  EXAM_PAPER_REVIEWER_OPTIONS,
  type ExamPaperSummaryT,
} from "../../graphql/examPapers";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import type { ExamPapersStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";
import { fill, paperStatus, subjectLabel } from "./common";

type Props = NativeStackScreenProps<ExamPapersStackParamList, "ExamPapersHome">;

function PaperCard({
  p,
  selectable,
  selected,
  onToggle,
  onOpen,
}: {
  p: ExamPaperSummaryT;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const colors = useColors();
  const st = paperStatus(p.status);
  const done = p.itemCount > 0 && p.confirmedCount === p.itemCount;
  return (
    <Card onPress={onOpen} style={{ marginBottom: space(2) }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
        {selectable ? (
          <Pressable
            onPress={onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={STR.epSelect}
            hitSlop={8}
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.sm,
              borderWidth: 2,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : "transparent",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 2,
            }}
          >
            {selected ? <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>✓</Text> : null}
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>
            {classLevelLabel(p.classLevel)} · {subjectLabel(p.subject)}
          </Text>
          <Muted>{p.examNameBn} · {fill(STR.epFullMarks, { m: bnNum(p.fullMarks) })}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            <Badge text={st.label} tone={st.tone} />
            {done ? <Badge text={STR.epConfirmed} tone="ok" /> : null}
            {p.openSuggestions > 0 ? <Badge text={`${STR.epSuggestions}: ${bnNum(p.openSuggestions)}`} tone="warn" /> : null}
          </View>
          <Muted style={{ marginTop: space(1) }}>
            {fill(STR.epProgress, { c: bnNum(p.confirmedCount), n: bnNum(p.itemCount), o: bnNum(p.openSuggestions) })}
          </Muted>
          <Muted>{p.reviewerName ? fill(STR.epReviewer, { name: p.reviewerName }) : STR.epNoReviewer}</Muted>
        </View>
      </View>
    </Card>
  );
}

export default function ExamPapersHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const manage = can("exam_papers:manage");
  const viewAll = manage || can("exam_papers:view");
  const canRef = can("exam_papers:view_reference") || can("exam_papers:manage_reference");
  const [mine, setMine] = useState(!viewAll);
  const [classFilter, setClassFilter] = useState<number | "all">("all");
  const [q, refetchQ] = useQuery({ query: EXAM_PAPER_DRAFTS_QUERY, variables: { mine: mine || !viewAll } });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const [optQ] = useQuery({ query: EXAM_PAPER_REVIEWER_OPTIONS, pause: !manage });
  const [assignState, assign] = useMutation(ASSIGN_EXAM_PAPER_REVIEWER);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const all = q.data?.examPaperDrafts ?? [];
  const levels = useMemo(() => [...new Set(all.map((p) => p.classLevel))].sort((a, b) => a - b), [all]);
  const papers = classFilter === "all" ? all : all.filter((p) => p.classLevel === classFilter);
  const options = (optQ.data?.examPaperReviewerOptions ?? []).map((o) => ({ value: o.id, label: o.name }));

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doAssign = async (): Promise<void> => {
    if (!reviewer || selected.size === 0) return;
    setMsg(null);
    const res = await assign({ paperIds: [...selected], reviewerUserId: reviewer });
    if (res.error) {
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    setMsg({ tone: "ok", text: STR.epAssigned });
    setSelected(new Set());
    refetch();
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Notice tone="info" message={viewAll ? STR.epHomeHintStaff : STR.epHomeHintReviewer} />
        {canRef ? (
          <Card onPress={() => navigation.navigate("ReferencePapers")} style={{ marginBottom: space(3) }}>
            <Body style={{ fontWeight: "700" }}>📂 {STR.epRefTitle} →</Body>
            <Muted>{STR.epRefHint}</Muted>
          </Card>
        ) : null}
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        {manage ? (
          <Card style={{ marginBottom: space(3) }}>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.epAssignTitle}</Body>
            <Select label={STR.epAssignPick} value={reviewer} options={options} onChange={setReviewer} searchable />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              <Button
                title={fill(STR.epAssignSelected, { n: bnNum(selected.size) })}
                disabled={!reviewer || selected.size === 0}
                loading={assignState.fetching}
                onPress={() => void doAssign()}
              />
              <Button title={STR.epAssignAll} variant="secondary" onPress={() => setSelected(new Set(papers.map((p) => p.id)))} />
              {selected.size ? <Button title={STR.epAssignClear} variant="ghost" onPress={() => setSelected(new Set())} /> : null}
            </View>
          </Card>
        ) : null}
        <ChipRow>
          {viewAll ? <Chip label={STR.epFilterMine} selected={mine} onPress={() => setMine(!mine)} /> : null}
          {levels.length > 1 ? <Chip label={STR.all} selected={classFilter === "all"} onPress={() => setClassFilter("all")} /> : null}
          {levels.length > 1
            ? levels.map((l) => <Chip key={l} label={classLevelLabel(l)} selected={classFilter === l} onPress={() => setClassFilter(l)} />)
            : null}
        </ChipRow>
        <QueryGate result={q} onRetry={refetch} loaderLabel={STR.loading}>
          {papers.length === 0 ? (
            <EmptyState message={mine || !viewAll ? STR.epEmptyMine : STR.epEmpty} />
          ) : (
            <View style={{ marginTop: space(2) }}>
              {papers.map((p) => (
                <PaperCard
                  key={p.id}
                  p={p}
                  selectable={manage}
                  selected={selected.has(p.id)}
                  onToggle={() => toggle(p.id)}
                  onOpen={() => navigation.navigate("ExamPaperDraft", { paperId: p.id })}
                />
              ))}
            </View>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
