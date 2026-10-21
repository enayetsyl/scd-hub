/**
 * MasteryCatalogueScreen (M-0, mock A1) — one class × subject's chapters, learning
 * outcomes and skill strands; lock the catalogue, edit an outcome's label / home tip,
 * retire an outcome (docs/prd-mastery.md §5.1, D-#776).
 *
 * Grouped by chapter in book order; strands (no chapter) come last under their own head.
 * Writes are shown only to mastery:manage — the server re-gates every one.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  LOCK_MASTERY_CATALOGUE,
  MASTERY_CATALOGUE_QUERY,
  RETIRE_MASTERY_OUTCOME,
  SAVE_MASTERY_OUTCOME,
  type MasteryOutcomeRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
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

export default function MasteryCatalogueScreen({ route }: Props): React.ReactElement {
  const { classToken, subject } = route.params;
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("mastery:manage");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [tip, setTip] = useState("");
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
    | { chapters: Chapter[]; outcomes: MasteryOutcomeRow[]; draftCount: number; lockedCount: number; retiredCount: number }
    | undefined;
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
    toast.show(c.kind === "lock" ? `${STR.msLockedToast} (${bnNum(Number(res.data?.lockMasteryCatalogue ?? 0))})` : STR.msSaved);
    reload();
  }

  async function onSave(code: string): Promise<void> {
    setError(null);
    const res = await saveOutcome({ code, labelBn: label.trim(), homeTipBn: tip.trim() });
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
    return (
      <Card key={o.code}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
          <Muted>{o.code}</Muted>
          <View style={{ flexDirection: "row", gap: space(1) }}>
            <Badge text={o.assess === "RUBRIC" ? STR.msAssessRubric : STR.msAssessQuestion} tone={o.assess === "RUBRIC" ? "info" : "brand"} />
            <Badge text={statusText(o.status)} tone={statusTone(o.status)} />
          </View>
        </View>
        {isEditing ? (
          <>
            <Field label={STR.msLabel} value={label} onChangeText={setLabel} />
            <Field label={STR.msHomeTip} value={tip} onChangeText={setTip} multiline />
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button title={STR.msSave} onPress={() => void onSave(o.code)} loading={save.fetching} disabled={!label.trim()} />
              <Button title={STR.msCancel} variant="secondary" onPress={() => setEditing(null)} />
            </View>
          </>
        ) : (
          <>
            <Body style={{ fontWeight: "700" }}>{o.labelBn}</Body>
            {o.sourceText ? <Muted>{STR.msSourceText}: {o.sourceText}</Muted> : null}
            {o.questionTypeCodes.length > 0 ? <Muted>{o.questionTypeCodes.join(", ")}</Muted> : null}
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
      {!fetching && cat && cat.outcomes.length === 0 ? <EmptyState message={STR.msNoCoverage} /> : null}

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
        message={confirm?.kind === "lock" ? STR.msLockConfirm : STR.msRetireConfirm}
        confirmLabel={confirm?.kind === "lock" ? STR.msLockAll : STR.msRetire}
        tone={confirm?.kind === "lock" ? "primary" : "danger"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      />
    </Screen>
  );
}
