/**
 * Worksheet plan (D-#745) — Principal/Office decide HOW each published মানবন্টন row
 * is generated (kind, sequence, set size) and what a weekly assignment / class test
 * takes from it. Counts and marks stay the syllabus's; only the choices are saved.
 * A row whose syllabus wording changed since it was saved shows a warning and falls
 * back to the automatic guess until someone confirms it here.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  WORKSHEET_AXES,
  WORKSHEET_AXIS_LABELS_BN,
  WORKSHEET_ITEM_KINDS,
  WORKSHEET_ITEM_KIND_LABELS_BN,
  WORKSHEET_ITEM_KIND_LABELS_EN,
} from "@scd/shared";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import { SAVE_WORKSHEET_PLAN, WORKSHEET_PLAN, type WorksheetPlanT } from "../../graphql/worksheet";
import { Screen, H2, Body, Muted, Card, Button, Chip, ChipRow, Field, Select, Notice, Loader, Badge } from "../../components/ui";
import { STR, bnNum, classLevelLabel, routineSubjectLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const SUBJECTS = ["BAN", "ENG", "MATH", "ARABIC"] as const;
const LETTER_KINDS = new Set(["WRITE_SEQUENCE", "FILL_MISSING", "REARRANGE", "BEFORE", "AFTER", "BEFORE_AFTER"]);

interface RowEdit {
  kind: string;
  axis: string | null;
  setSize: string;
}

const kindOptions = (): Array<{ value: string; label: string }> =>
  WORKSHEET_ITEM_KINDS.map((k) => ({
    value: k,
    label: (getActiveLang() === "en" ? WORKSHEET_ITEM_KIND_LABELS_EN : WORKSHEET_ITEM_KIND_LABELS_BN)[k],
  }));
const axisOptions = WORKSHEET_AXES.map((a) => ({ value: a, label: WORKSHEET_AXIS_LABELS_BN[a] }));

function presetMap(p: WorksheetPlanT["assignmentPreset"]): Record<number, string> {
  return Object.fromEntries(p.map((r) => [r.seq, String(r.count)]));
}

export default function WorksheetPlanScreen(): React.ReactElement {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId = yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId ?? "" }, pause: !yearId });
  const classes = useMemo(
    () => (classesQ.data?.classes ?? []).filter((c) => c.active !== false && c.level <= 0).sort((a, b) => a.level - b.level),
    [classesQ.data],
  );
  const [classId, setClassId] = useState<string | null>(null);
  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id);
  }, [classes, classId]);
  const [subject, setSubject] = useState<string>("BAN");

  const [planQ] = useQuery({
    query: WORKSHEET_PLAN,
    variables: { classId: classId ?? "", subject },
    pause: !classId,
    requestPolicy: "network-only",
  });
  const plan = planQ.data?.worksheetPlan ?? null;

  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [asg, setAsg] = useState<Record<number, string>>({});
  const [ct, setCt] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!plan) return;
    setEdits(Object.fromEntries(plan.rows.map((r) => [r.seq, { kind: r.kind, axis: r.axis, setSize: r.setSize ? String(r.setSize) : "" }])));
    setAsg(presetMap(plan.assignmentPreset));
    setCt(presetMap(plan.classTestPreset));
  }, [plan]);

  const [{ fetching: saving }, save] = useMutation(SAVE_WORKSHEET_PLAN);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const toPreset = (m: Record<number, string>) =>
    Object.entries(m)
      .map(([seq, v]) => ({ seq: Number(seq), count: Number(v) }))
      .filter((r) => Number.isInteger(r.count) && r.count > 0);

  const onSave = async (): Promise<void> => {
    if (!plan || !classId) return;
    setMsg(null);
    const res = await save({
      classId,
      subject,
      rows: plan.rows.map((r) => {
        const e = edits[r.seq];
        return {
          seq: r.seq,
          kind: e?.kind ?? r.kind,
          axis: e?.axis ?? null,
          setSize: e?.setSize ? Number(e.setSize) : null,
        };
      }),
      assignmentPreset: toPreset(asg),
      classTestPreset: toPreset(ct),
    });
    setMsg(res.error || !res.data ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.wsPlanSaved });
  };

  const presetBlock = (
    label: string,
    saved: boolean,
    values: Record<number, string>,
    set: React.Dispatch<React.SetStateAction<Record<number, string>>>,
  ): React.ReactElement => (
    <Card>
      <H2>{label}</H2>
      <Muted style={{ marginBottom: space(2) }}>
        {STR.wsPresetHint} {saved ? "" : STR.wsPresetDefault}
      </Muted>
      {plan?.rows
        .filter((r) => r.kind !== "ORAL")
        .map((r) => (
          <View key={r.seq} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Body style={{ flex: 1 }}>
              {bnNum(r.seq)}. {r.label}
            </Body>
            <View style={{ width: 90 }}>
              <Field
                value={values[r.seq] ?? "0"}
                onChangeText={(v) => set((cur) => ({ ...cur, [r.seq]: v.replace(/[^0-9]/g, "") }))}
                keyboardType="number-pad"
              />
            </View>
          </View>
        ))}
    </Card>
  );

  return (
    <Screen scroll>
      <H2>{STR.wsPlan}</H2>
      <Card>
        <Select
          label={STR.wsClass}
          value={classId}
          onChange={setClassId}
          options={classes.map((c) => ({ value: c.id, label: c.nameBn || classLevelLabel(c.level) }))}
        />
        <ChipRow>
          {SUBJECTS.map((s) => (
            <Chip key={s} label={routineSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
          ))}
        </ChipRow>
        {plan?.examName ? (
          <Muted>
            {STR.wsPlanFrom}: {plan.examName} · {STR.wsTotal} {bnNum(plan.finalTotal)}
          </Muted>
        ) : null}
      </Card>

      {planQ.fetching && !plan ? <Loader /> : null}
      {planQ.error ? <Notice tone="danger" message={friendlyError(planQ.error)} /> : null}
      {plan && plan.rows.length === 0 ? <Notice tone="warn" message={STR.wsNoRows} /> : null}

      {plan?.rows.map((r) => {
        const e = edits[r.seq] ?? { kind: r.kind, axis: r.axis, setSize: "" };
        return (
          <Card key={r.seq}>
            <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Body style={{ flexShrink: 1 }}>
                {bnNum(r.seq)}. {r.label}
              </Body>
              <Badge text={`${bnNum(r.count)} × ${bnNum(r.marksEach)} = ${bnNum(r.total)}`} tone="muted" />
              {r.source === "auto" ? <Badge text={STR.wsPlanAuto} tone="info" /> : null}
            </View>
            {r.changed ? <Notice tone="warn" message={STR.wsPlanChanged} /> : null}
            <Select
              label={STR.wsPlanKind}
              value={e.kind}
              onChange={(v) => setEdits((cur) => ({ ...cur, [r.seq]: { ...e, kind: v } }))}
              options={kindOptions()}
            />
            {LETTER_KINDS.has(e.kind) ? (
              <Select
                label={STR.wsPlanAxis}
                value={e.axis}
                onChange={(v) => setEdits((cur) => ({ ...cur, [r.seq]: { ...e, axis: v } }))}
                options={axisOptions}
              />
            ) : null}
            {e.kind === "REARRANGE" ? (
              <Field
                label={STR.wsPlanSetSize}
                value={e.setSize}
                onChangeText={(v) => setEdits((cur) => ({ ...cur, [r.seq]: { ...e, setSize: v.replace(/[^0-9]/g, "") } }))}
                keyboardType="number-pad"
              />
            ) : null}
          </Card>
        );
      })}

      {plan && plan.rows.length ? (
        <>
          {presetBlock(STR.wsPresetAssignment, plan.assignmentPresetSaved, asg, setAsg)}
          {presetBlock(STR.wsPresetCt, plan.classTestPresetSaved, ct, setCt)}
          {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
          <Button title={STR.wsPlanSave} onPress={() => void onSave()} loading={saving} />
        </>
      ) : null}
    </Screen>
  );
}
