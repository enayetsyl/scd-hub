/**
 * MasteryImportScreen (M-0; extended by OT-1, prd-objective-tree §6 mock 1) — paste a catalogue
 * file's JSON, PREVIEW what it would change, then APPLY (docs/prd-mastery.md §5.1).
 *
 * Two file kinds, told apart by the server: the flat M-0 catalogue, and the objective tree
 * (`scd-objective-tree/1`) with its subject's domains file in the second box (needed only for
 * the subject's first tree). The tree preview shows counts per level, the exercise-coverage line,
 * the reviewer flags, the domain diff and what the apply does to the review round.
 *
 * The preview and the apply are the same server computation; Apply is offered only after
 * a clean preview of exactly the text in the boxes, so what the Principal reviewed is what
 * gets written. Any diff error or broken structural rule blocks the apply.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { IMPORT_MASTERY_CATALOGUE } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import { levelFill, fill } from "./masteryStateUi";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryImport">;

type TreePreview = {
  format: string;
  counts: { domains: number; objectives: number; subs: number; strands: number; tagged: number; grouping: number };
  coverage: { exercisesTotal: number; mapped: number; unmapped: { ref: string; text: string; reason: string }[]; note: string | null };
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null }[];
  domainsAdded: string[];
  domainsChanged: string[];
  domainsUnchanged: number;
  roundAction: string;
  round: number | null;
  kept: number;
  backToProposed: string[];
  removedInRedraft: string[];
  lockedChanged: string[];
  violations: string[];
  noop: boolean;
};

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
  tree: TreePreview | null;
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

function TreeCard({ t }: { t: TreePreview }): React.ReactElement {
  const levels = useMasteryLevelLabels();
  const roundLine =
    t.roundAction === "OPEN_NEW"
      ? fill(STR.msTreeRoundOpenNew, { n: bnNum(t.round ?? 0) })
      : t.roundAction === "REDRAFT"
        ? fill(STR.msTreeRoundRedraft, { n: bnNum(t.round ?? 0) })
        : STR.msTreeRoundNone;
  return (
    <View style={{ gap: space(2) }}>
      <Body style={{ fontWeight: "700" }}>{STR.msTreeByLevel}</Body>
      <Muted>
        {levels.domain}: {bnNum(t.counts.domains)} · {levels.objective}: {bnNum(t.counts.objectives)} · {levels.sub}:{" "}
        {bnNum(t.counts.subs)} · {STR.msTreeStrands}: {bnNum(t.counts.strands)}
      </Muted>
      <Muted>
        {STR.msTreeTagged}: {bnNum(t.counts.tagged)} · {STR.msTreeGrouping}: {bnNum(t.counts.grouping)}
      </Muted>
      <Body>
        {fill(STR.msTreeCoverage, {
          mapped: bnNum(t.coverage.mapped),
          total: bnNum(t.coverage.exercisesTotal),
          unmapped: bnNum(t.coverage.unmapped.length),
        })}
      </Body>
      {t.coverage.unmapped.length > 0 ? (
        <Muted>{t.coverage.unmapped.slice(0, 20).map((u) => `${u.ref} — ${u.reason}`).join("\n")}</Muted>
      ) : null}
      <Badge text={roundLine} tone={t.roundAction === "NONE" ? "muted" : "brand"} />
      {t.noop ? <Notice message={STR.msTreeNoop} tone="ok" /> : null}
      <Line label={`${levels.domain} — ${STR.msTreeNew}`} items={t.domainsAdded} />
      <Line label={`${levels.domain} — ${STR.msDiffChanged}`} items={t.domainsChanged} />
      <Line label={STR.msTreeBackToProposed} items={t.backToProposed} />
      <Line label={STR.msTreeRemovedInRedraft} items={t.removedInRedraft} />
      <Line label={STR.msTreeLockedChanged} items={t.lockedChanged} />
      {t.kept > 0 ? (
        <Muted>
          {STR.msTreeKept}: {bnNum(t.kept)}
        </Muted>
      ) : null}
      {t.violations.length > 0 ? (
        <Notice message={`${STR.msTreeViolations}:\n• ${t.violations.slice(0, 30).join("\n• ")}`} tone="danger" />
      ) : null}
      {t.flags.length > 0 ? (
        <View style={{ gap: space(1) }}>
          <Body style={{ fontWeight: "700" }}>
            {STR.msTreeFlags} ({bnNum(t.flags.length)})
          </Body>
          {t.flags.map((f, i) => (
            <View key={i} style={{ gap: space(0.5) }}>
              <Muted>
                {f.kind}
                {f.code ? ` · ${f.code}` : ""}: {f.text}
              </Muted>
              {f.ownerRuling ? (
                <Muted>
                  {STR.msTreeRuling}: {f.ownerRuling}
                </Muted>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function MasteryImportScreen({ navigation }: Props): React.ReactElement {
  const lv = useMasteryLevelLabels();
  const toast = useToast();
  const [text, setText] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, run] = useMutation(IMPORT_MASTERY_CATALOGUE);
  const key = `${text}\u0000${domainsText}`;

  async function go(apply: boolean): Promise<void> {
    setError(null);
    const res = await run({ catalogueJson: text, apply, domainsJson: domainsText.trim() ? domainsText : null });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    const r = res.data?.importMasteryCatalogue as Report;
    setReport(r);
    if (!apply) setPreviewedKey(r.ok ? key : null);
    if (apply && r.applied) {
      toast.show(r.tree ? STR.msTreeImported : STR.msImported);
      setPreviewedKey(null);
      if (r.classToken && r.subject) navigation.replace("MasteryCatalogue", { classToken: r.classToken, subject: r.subject });
    }
  }

  const d = report?.diff;
  const canApply = report?.ok === true && !report.applied && previewedKey === key;
  const onEdit = (next: string): void => {
    if (next !== previewedKey) setReport((r) => (r && !r.applied ? r : null));
  };

  return (
    <Screen scroll>
      <Muted>{STR.msImportHint}</Muted>
      <Muted>{STR.msTreeImportHint}</Muted>
      <Field
        label={STR.msPasteJson}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onEdit(`${t}\u0000${domainsText}`);
        }}
        multiline
        inputStyle={{ minHeight: 160, fontFamily: "monospace", fontSize: 12 }}
      />
      <Field
        label={STR.msDomainsJson}
        value={domainsText}
        onChangeText={(t) => {
          setDomainsText(t);
          onEdit(`${text}\u0000${t}`);
        }}
        multiline
        inputStyle={{ minHeight: 80, fontFamily: "monospace", fontSize: 12 }}
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
          {report.tree ? <TreeCard t={report.tree} /> : null}
          {d ? (
            <View style={{ gap: space(2) }}>
              <Line label={levelFill(STR.msDiffAdded, lv)} items={d.added} />
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
          {report.applied ? <Notice message={report.tree ? STR.msTreeImported : STR.msImported} tone="ok" /> : null}
        </Card>
      ) : null}
    </Screen>
  );
}
