/**
 * MasteryCatalogueScreen (M-0, mock A1) — one class × subject's chapters, learning
 * outcomes and skill strands; lock the catalogue, edit an outcome's label / home tip,
 * retire an outcome (docs/prd-mastery.md §5.1, D-#776).
 *
 * Grouped by chapter in book order; strands (no chapter) come last under their own head.
 * Writes are shown only to mastery:manage — the server re-gates every one.
 *
 * D-#1161: this is where Question/Rubric and the question types are set — the review round judges
 * tags only (D-#1160). Only tagged rows carry them (a grouping parent shows দল); types offered are
 * the class-subject's active marks-table types, plus any the row already holds.
 */
import React, { useLayoutEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  LOCK_MASTERY_CATALOGUE,
  MASTERY_CATALOGUE_QUERY,
  RETIRE_MASTERY_OUTCOME,
  SAVE_MASTERY_OUTCOME,
  type MasteryOutcomeRow,
  type MasteryQuestionTypeRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { levelFill } from "./masteryStateUi";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryCatalogue">;

type Chapter = { number: number; titleBn: string; termNote: string | null; outcomeCount: number };

const statusTone = (s: string) => (s === "LOCKED" ? "ok" : s === "DRAFT" ? "gold" : "muted") as "ok" | "gold" | "muted";
const statusText = (s: string) => (s === "LOCKED" ? STR.msLocked : s === "DRAFT" ? STR.msDraft : STR.msRetired);

export default function MasteryCatalogueScreen({ route, navigation }: Props): React.ReactElement {
  const lv = useMasteryLevelLabels();
  useLayoutEffect(() => navigation.setOptions({ title: levelFill(STR.msOutcomes, lv) }), [navigation, lv.objective]);
  const { classToken, subject } = route.params;
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("mastery:settings");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [tip, setTip] = useState("");
  const [assess, setAssess] = useState("QUESTION");
  const [qts, setQts] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ kind: "lock" } | { kind: "retire"; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [{ data, fetching, error: qErr }, refetch] = useQuery({
    query: MASTERY_CATALOGUE_QUERY,
    variables: { classToken, subject, includeRetired: showRetired },
  });
  const [, lock] = useMutation(LOCK_MASTERY_CATALOGUE);
  const [, retire] = useMutation(RETIRE_MASTERY_OUTCOME);
  const [save, saveOutcome] = useMutation(SAVE_MASTERY_OUTCOME);

  const cat = data?.masteryCatalogue as
    | {
        chapters: Chapter[];
        outcomes: MasteryOutcomeRow[];
        questionTypes: MasteryQuestionTypeRow[];
        draftCount: number;
        lockedCount: number;
        retiredCount: number;
      }
    | undefined;
  const qtLabel = useMemo(() => new Map((cat?.questionTypes ?? []).map((t) => [t.code, t.labelBn || t.code])), [cat]);
  const byChapter = useMemo(() => {
    const m = new Map<number, MasteryOutcomeRow[]>();
    for (const o of cat?.outcomes ?? []) {
      if (o.chapterNumber === null) continue;
      if (!m.has(o.chapterNumber)) m.set(o.chapterNumber, []);
      m.get(o.chapterNumber)!.push(o);
    }
    return m;
  }, [cat]);
  const strands = (cat?.outcomes ?? []).filter((o) => o.strand !== null);

  const reload = () => refetch({ requestPolicy: "network-only" });

  async function onConfirm(): Promise<void> {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    setError(null);
    const res = c.kind === "lock" ? await lock({ classToken, subject }) : await retire({ code: c.code });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(c.kind === "lock" ? `${levelFill(STR.msLockedToast, lv)} (${bnNum(Number(res.data?.lockMasteryCatalogue ?? 0))})` : STR.msSaved);
    reload();
  }

  async function onSave(o: MasteryOutcomeRow): Promise<void> {
    setError(null);
    const res = await saveOutcome({
      code: o.code,
      labelBn: label.trim(),
      homeTipBn: tip.trim(),
      ...(o.tagged ? { assess, questionTypeCodes: qts } : {}),
    });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setEditing(null);
    toast.show(STR.msSaved);
    reload();
  }

  function outcomeCard(o: MasteryOutcomeRow): React.ReactElement {
    const isEditing = editing === o.code;
    // Offer the active marks-table types, plus any this row already holds (a switched-off type
    // stays where it is but is never newly given — the server refuses it).
    const offered = (cat?.questionTypes ?? []).filter((t) => t.active || o.questionTypeCodes.includes(t.code));
    const noTypes = o.tagged && o.assess === "QUESTION" && o.questionTypeCodes.length === 0;
    return (
      <Card key={o.code}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
          <Muted>{o.code}</Muted>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            {o.tagged ? (
              <Badge text={o.assess === "RUBRIC" ? STR.msAssessRubric : STR.msAssessQuestion} tone={o.assess === "RUBRIC" ? "info" : "brand"} />
            ) : (
              <Badge text={STR.msCatGroup} tone="muted" />
            )}
            {noTypes ? <Badge text={STR.msCatNoTypes} tone="gold" /> : null}
            <Badge text={statusText(o.status)} tone={statusTone(o.status)} />
          </View>
        </View>
        {isEditing ? (
          <>
            <Field label={STR.msLabel} value={label} onChangeText={setLabel} />
            {o.level !== "SUB" ? <Field label={STR.msHomeTip} value={tip} onChangeText={setTip} multiline /> : null}
            {o.tagged ? (
              <>
                <Muted>{STR.msCatAssessField}</Muted>
                <ChipRow>
                  <Chip label={STR.msAssessQuestion} selected={assess === "QUESTION"} onPress={() => setAssess("QUESTION")} />
                  <Chip label={STR.msAssessRubric} selected={assess === "RUBRIC"} onPress={() => setAssess("RUBRIC")} />
                </ChipRow>
                <Muted>{STR.msCatAssessHint}</Muted>
                <Muted>
                  {STR.msQuestionTypes} — {STR.msCatTypesHint}
                </Muted>
                <ChipRow>
                  {offered.map((t) => (
                    <Chip
                      key={t.code}
                      label={t.labelBn || t.code}
                      selected={qts.includes(t.code)}
                      onPress={() => setQts((p) => (p.includes(t.code) ? p.filter((x) => x !== t.code) : [...p, t.code]))}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button title={STR.msSave} onPress={() => void onSave(o)} loading={save.fetching} disabled={!label.trim()} />
              <Button title={STR.msCancel} variant="secondary" onPress={() => setEditing(null)} />
            </View>
          </>
        ) : (
          <>
            <Body style={{ fontWeight: "700" }}>{o.labelBn}</Body>
            {o.sourceText ? <Muted>{STR.msSourceText}: {o.sourceText}</Muted> : null}
            {o.tagged && o.questionTypeCodes.length > 0 ? (
              <Muted>
                {STR.msQuestionTypes}: {o.questionTypeCodes.map((c) => qtLabel.get(c) ?? c).join(", ")}
              </Muted>
            ) : null}
            {o.homeTipBn ? <Muted>{STR.msHomeTip}: {o.homeTipBn}</Muted> : null}
            {canManage && o.status !== "RETIRED" ? (
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Button
                  title={STR.msEdit}
                  variant="secondary"
                  onPress={() => {
                    setEditing(o.code);
                    setLabel(o.labelBn);
                    setTip(o.homeTipBn ?? "");
                    setAssess(o.assess === "RUBRIC" ? "RUBRIC" : "QUESTION");
                    setQts(o.questionTypeCodes);
                  }}
                />
                <Button title={STR.msRetire} variant="ghost" onPress={() => setConfirm({ kind: "retire", code: o.code })} />
              </View>
            ) : null}
          </>
        )}
      </Card>
    );
  }

  return (
    <Screen scroll>
      <H2>
        {masteryClassLabel(classToken)} · {hwSubjectLabel(subject)}
      </H2>
      {cat ? (
        <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
          <Badge text={`${STR.msDraft} ${bnNum(cat.draftCount)}`} tone="gold" />
          <Badge text={`${STR.msLocked} ${bnNum(cat.lockedCount)}`} tone="ok" />
          <Badge text={`${STR.msRetired} ${bnNum(cat.retiredCount)}`} tone="muted" />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        {canManage && (cat?.draftCount ?? 0) > 0 ? (
          <Button title={STR.msLockAll} onPress={() => setConfirm({ kind: "lock" })} />
        ) : null}
        {(cat?.retiredCount ?? 0) > 0 ? (
          <Button
            title={showRetired ? STR.msCancel : `${STR.msRetired} (${bnNum(cat?.retiredCount ?? 0)})`}
            variant="secondary"
            onPress={() => setShowRetired((v) => !v)}
          />
        ) : null}
      </View>

      {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {fetching && !cat ? <Loader /> : null}
      {!fetching && cat && cat.outcomes.length === 0 ? <EmptyState message={levelFill(STR.msNoCoverage, lv)} /> : null}

      {(cat?.chapters ?? []).map((c) => {
        const list = byChapter.get(c.number) ?? [];
        if (list.length === 0) return null;
        return (
          <View key={c.number} style={{ gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>
              {STR.msChapter} {bnNum(c.number)} · {c.titleBn}
            </Body>
            {c.termNote ? <Muted>{c.termNote}</Muted> : null}
            {list.map(outcomeCard)}
          </View>
        );
      })}

      {strands.length > 0 ? (
        <View style={{ gap: space(2) }}>
          <Body style={{ fontWeight: "700" }}>{STR.msStrands}</Body>
          {strands.map(outcomeCard)}
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirm !== null}
        message={confirm?.kind === "lock" ? STR.msLockConfirm : levelFill(STR.msRetireConfirm, lv)}
        confirmLabel={confirm?.kind === "lock" ? STR.msLockAll : STR.msRetire}
        tone={confirm?.kind === "lock" ? "primary" : "danger"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      />
    </Screen>
  );
}
