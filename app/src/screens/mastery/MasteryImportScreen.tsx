/**
 * MasteryImportScreen (M-0) — paste a catalogue file's JSON, PREVIEW what it would change,
 * then APPLY (docs/prd-mastery.md §5.1 "Catalogue import").
 *
 * The preview and the apply are the same server computation; Apply is offered only after
 * a clean preview of exactly the text in the box, so what the Principal reviewed is what
 * gets written. Any diff error blocks the apply (a locked code re-moded, a retired code back).
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { IMPORT_MASTERY_CATALOGUE } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryImport">;

type Report = {
  ok: boolean;
  applied: boolean;
  classToken: string | null;
  subject: string | null;
  status: string | null;
  errors: string[];
  diff: {
    added: string[];
    changed: { code: string; fields: string[] }[];
    unchanged: number;
    removedDrafts: string[];
    retired: string[];
    qtAdded: string[];
    qtMarksChanged: { code: string; from: number | null; to: number | null }[];
    qtLabelChanged: string[];
    errors: string[];
  } | null;
};

function Line({ label, items }: { label: string; items: string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space(1) }}>
      <Body style={{ fontWeight: "700" }}>
        {label} ({bnNum(items.length)})
      </Body>
      <Muted>{items.slice(0, 40).join(", ")}{items.length > 40 ? " …" : ""}</Muted>
    </View>
  );
}

export default function MasteryImportScreen({ navigation }: Props): React.ReactElement {
  const toast = useToast();
  const [text, setText] = useState("");
  const [previewedText, setPreviewedText] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, run] = useMutation(IMPORT_MASTERY_CATALOGUE);

  async function go(apply: boolean): Promise<void> {
    setError(null);
    const res = await run({ catalogueJson: text, apply });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    const r = res.data?.importMasteryCatalogue as Report;
    setReport(r);
    if (!apply) setPreviewedText(r.ok ? text : null);
    if (apply && r.applied) {
      toast.show(STR.msImported);
      setPreviewedText(null);
      if (r.classToken && r.subject) navigation.replace("MasteryCatalogue", { classToken: r.classToken, subject: r.subject });
    }
  }

  const d = report?.diff;
  const canApply = report?.ok === true && !report.applied && previewedText === text;

  return (
    <Screen scroll>
      <Muted>{STR.msImportHint}</Muted>
      <Field
        label={STR.msPasteJson}
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (t !== previewedText) setReport((r) => (r && !r.applied ? r : null));
        }}
        multiline
        inputStyle={{ minHeight: 160, fontFamily: "monospace", fontSize: 12 }}
      />
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Button title={STR.msPreview} variant="secondary" onPress={() => void go(false)} loading={state.fetching} disabled={!text.trim()} />
        <Button title={STR.msApply} onPress={() => void go(true)} loading={state.fetching} disabled={!canApply} />
      </View>
      {error ? <Notice message={error} tone="danger" /> : null}

      {report ? (
        <Card>
          {report.classToken && report.subject ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700" }}>
                {masteryClassLabel(report.classToken)} · {hwSubjectLabel(report.subject)}
              </Body>
              <Badge text={report.status === "LOCKED" ? STR.msLocked : STR.msDraft} tone={report.status === "LOCKED" ? "ok" : "gold"} />
            </View>
          ) : null}
          {report.errors.length > 0 ? (
            <Notice message={`${STR.msDiffErrors}:\n• ${report.errors.slice(0, 30).join("\n• ")}`} tone="danger" />
          ) : null}
          {d ? (
            <View style={{ gap: space(2) }}>
              <Line label={STR.msDiffAdded} items={d.added} />
              <Line label={STR.msDiffChanged} items={d.changed.map((c) => `${c.code} (${c.fields.join(", ")})`)} />
              <Line label={STR.msDiffRemoved} items={d.removedDrafts} />
              <Line label={STR.msDiffRetired} items={d.retired} />
              <Line label={STR.msDiffQtAdded} items={d.qtAdded} />
              <Line
                label={STR.msDiffQtMarks}
                items={d.qtMarksChanged.map((m) => `${m.code}: ${m.from ?? "—"} → ${m.to ?? "—"}`)}
              />
              <Muted>
                {STR.msDiffUnchanged}: {bnNum(d.unchanged)}
              </Muted>
            </View>
          ) : null}
          {report.applied ? <Notice message={STR.msImported} tone="ok" /> : null}
        </Card>
      ) : null}
    </Screen>
  );
}
