/**
 * MasteryReviewRowScreen (OT-2, prd-objective-tree §7, mock 3) — one row with its evidence:
 * code, path (domain › objective), label, book wording, book ref with exercises, earlier steps, home
 * tip (objective), Claude's note. Actions: গ্রহণ, সম্পাদনা, ভাগ করুন, অন্যটির সাথে মেলান, সরান,
 * বাদ দিন — each one event on the server, refused with the broken tree rule named. The row's
 * comment threads sit underneath.
 *
 * The screen title is the row's level word from useMasteryLevelLabels (D-#923).
 *
 * D-#1160: the review judges TAGS only — Question/Rubric and question types are neither shown nor
 * edited here; they are set later on the catalogue (D-#1161). A sub lists all its siblings so the
 * reviewer sees the whole objective's split while reading one step.
 *
 * D-#1260: an objective with steps offers ভাগ ফিরিয়ে নিন — the server's existing "merge back" (a MERGE
 * of one step into its own parent folds every step in and re-tags the parent), placed where a
 * reviewer who split by mistake looks for it, not only inside a step's merge list.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MASTERY_REVIEW_DECIDE, type ReviewDecisionInput, type ReviewQueue, type ReviewRow } from "../../graphql/masteryReview";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, Row, Select } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { ReviewThreads, TapText, codeTail, formatExerciseRef, reviewStateLabel, reviewStateTone, useReviewAction, useReviewQueue } from "./masteryReviewUi";
import { AddCard } from "./MasteryReviewAddCard";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryReviewRow">;
type Mode = null | "EDIT" | "SPLIT" | "UNSPLIT" | "MERGE" | "MOVE" | "REJECT";

const isOut = (r: ReviewRow) => r.reviewState === "REJECTED" || !!r.mergedInto;
const lines = (t: string) =>
  t
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function EditForm({ q, r, run, busy }: { q: ReviewQueue; r: ReviewRow; run: (i: ReviewDecisionInput) => void; busy: boolean }): React.ReactElement {
  const levels = useMasteryLevelLabels();
  const [label, setLabel] = useState(r.labelBn);
  const [labelEn, setLabelEn] = useState(r.labelEn ?? "");
  const [prereqs, setPrereqs] = useState(r.prereqCodes.join(", "));
  const [tip, setTip] = useState(r.homeTipBn ?? "");
  const [domain, setDomain] = useState<string | null>(r.domainCode);
  const [exercises, setExercises] = useState(r.bookRef.exercises.join("\n"));
  return (
    <View style={{ gap: space(2) }}>
      <Field label={STR.msRvLabel} value={label} onChangeText={setLabel} multiline />
      <Field label={STR.msRvLabelEn} value={labelEn} onChangeText={setLabelEn} />
      <Field label={STR.msRvPrereqCodes} value={prereqs} onChangeText={setPrereqs} multiline />
      {r.level !== "SUB" ? (
        <>
          <Field label={STR.msRvHomeTipField} value={tip} onChangeText={setTip} multiline />
          <Select label={levels.domain} value={domain} options={q.domains.map((d) => ({ label: d.labelBn, value: d.code }))} onChange={setDomain} />
        </>
      ) : null}
      <Field label={STR.msRvExercises} value={exercises} onChangeText={setExercises} multiline />
      <Button
        title={STR.msRvSave}
        loading={busy}
        onPress={() =>
          run({
            action: "EDIT",
            code: r.code,
            labelBn: label,
            labelEn,
            prereqCodes: lines(prereqs),
            homeTipBn: r.level !== "SUB" ? tip : undefined,
            domainCode: r.level !== "SUB" ? domain : undefined,
            exercises: lines(exercises),
          })
        }
      />
    </View>
  );
}

function SplitForm({ r, run, busy }: { r: ReviewRow; run: (i: ReviewDecisionInput) => void; busy: boolean }): React.ReactElement {
  const [parts, setParts] = useState<{ label: string; ex: string[] }[]>([
    { label: "", ex: [] },
    { label: "", ex: [] },
  ]);
  const setPart = (i: number, p: { label: string; ex: string[] }) => setParts((all) => all.map((x, j) => (j === i ? p : x)));
  return (
    <View style={{ gap: space(2) }}>
      <Muted>{STR.msRvSplitHint}</Muted>
      {parts.map((p, i) => (
        <View key={i} style={{ gap: space(1) }}>
          <Field label={fill(STR.msRvPartTpl, { n: bnNum(i + 1) })} value={p.label} onChangeText={(t) => setPart(i, { ...p, label: t })} />
          <ChipRow>
            {r.bookRef.exercises.map((x) => (
              <Chip key={x} label={formatExerciseRef(x)} selected={p.ex.includes(x)} onPress={() => setPart(i, { ...p, ex: p.ex.includes(x) ? p.ex.filter((y) => y !== x) : [...p.ex, x] })} />
            ))}
          </ChipRow>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Button title={STR.msRvAddPart} variant="ghost" onPress={() => setParts((all) => [...all, { label: "", ex: [] }])} />
        <Button
          title={STR.msRvSplit}
          loading={busy}
          disabled={parts.some((p) => !p.label.trim())}
          onPress={() => run({ action: "SPLIT", code: r.code, children: parts.map((p) => ({ labelBn: p.label, exercises: p.ex })) })}
        />
      </View>
    </View>
  );
}

export default function MasteryReviewRowScreen({ navigation, route }: Props): React.ReactElement {
  const { reviewId, code } = route.params;
  const levels = useMasteryLevelLabels();
  const { queue: q, fetching, error } = useReviewQueue(reviewId);
  const act = useReviewAction(MASTERY_REVIEW_DECIDE);
  const [mode, setMode] = useState<Mode>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const r = q?.rows.find((x) => x.code === code) ?? null;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: r?.level === "SUB" ? levels.sub : levels.objective });
  }, [navigation, r?.level, levels.sub, levels.objective]);

  if (!q || !r) {
    return <Screen scroll>{error ? <Notice message={error} tone="danger" /> : fetching ? <Loader /> : null}</Screen>;
  }
  const byCode = new Map(q.rows.map((x) => [x.code, x]));
  const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
  const domain = q.domains.find((d) => d.code === r.domainCode);
  const kids = q.rows.filter((x) => x.parentCode === r.code && !isOut(x));
  // A sub lists every sub of its objective, so the reviewer sees the whole split while reading one step.
  const siblings = r.level === "SUB" && parent ? q.rows.filter((x) => x.parentCode === parent.code && !isOut(x)) : [];
  const stepLine = (k: ReviewRow) => `${codeTail(k.code)} · ${k.labelBn} — ${reviewStateLabel(k.reviewState)}`;
  const editable = q.canWrite && r.status === "DRAFT" && !r.mergedInto;
  const live = editable && r.reviewState !== "REJECTED";
  // D-#1016: add a step where the reviewer is reading — on an objective that already has steps (a leaf
  // objective is split instead, never given one lone child), or on a step, under its own objective.
  const addParent = r.level !== "SUB" ? (kids.length > 0 ? r : null) : parent && parent.status === "DRAFT" && !isOut(parent) ? parent : null;
  const canAddHere = q.canWrite && !!addParent && addParent.status === "DRAFT" && !isOut(addParent);
  const canUnsplit = live && r.level !== "SUB" && kids.length > 0 && kids.every((k) => k.status === "DRAFT");
  const run = (input: ReviewDecisionInput) =>
    void act.run({ reviewId: q.id, input }, STR.msRvSaved).then((ok) => {
      if (!ok) return;
      setMode(null);
      setReason("");
      setTarget(null);
    });

  // Merge targets: tagged live leaves (and the parent, for "merge back"); move targets: objectives / domains.
  const leafOptions = q.rows
    .filter((x) => x.code !== r.code && x.status === "DRAFT" && x.tagged && !isOut(x))
    .map((x) => ({ label: `${codeTail(x.code)} · ${x.labelBn}`, value: x.code }));
  const mergeOptions = parent && !isOut(parent) ? [{ label: fill(STR.msRvMergeBackTpl, { objective: levels.objective }), value: parent.code }, ...leafOptions] : leafOptions;
  const parentOptions = q.rows
    .filter((x) => x.level !== "SUB" && x.code !== r.code && x.code !== r.parentCode && x.status === "DRAFT" && !isOut(x))
    .map((x) => ({ label: `${codeTail(x.code)} · ${x.labelBn}`, value: `P:${x.code}` }));
  const domainOptions = q.domains.filter((d) => d.code !== r.domainCode).map((d) => ({ label: `${levels.domain}: ${d.labelBn}`, value: `D:${d.code}` }));

  return (
    <Screen scroll>
      <Card>
        <Muted>
          {r.code} · {domain?.labelBn ?? r.domainCode ?? "—"}
          {parent ? ` › ${parent.labelBn}` : ""}
        </Muted>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
          <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.labelBn}</Body>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            {r.status === "LOCKED" ? <Badge text={STR.msRvLockedRow} tone="ok" /> : null}
            <Badge text={r.mergedInto ? fill(STR.msRvMergedTo, { code: codeTail(r.mergedInto) }) : reviewStateLabel(r.reviewState)} tone={reviewStateTone(r.reviewState)} />
          </View>
        </View>
        {r.labelEn ? <Muted>{r.labelEn}</Muted> : null}
        <Row
          label={STR.msRvInBook}
          value={[
            r.bookRef.chapter !== null ? fill(STR.msRvChapter, { n: bnNum(r.bookRef.chapter) }) : null,
            r.bookRef.lesson,
            r.bookRef.exercises.map(formatExerciseRef).join("; "),
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        {r.sourceText ? <Row label={STR.msRvBookWording} value={r.sourceText} /> : null}
        {r.prereqCodes.length ? (
          <Row label={STR.msRvPrereq} value={r.prereqCodes.map((c) => `${byCode.get(c)?.labelBn ?? ""} (${codeTail(c)})`).join("\n")} />
        ) : null}
        {r.homeTipBn ? <Row label={STR.msRvHomeTip} value={r.homeTipBn} /> : null}
        {r.legacyCodes.length ? <Row label={STR.msRvLegacy} value={r.legacyCodes.join(", ")} /> : null}
        {r.addReason ? <Row label={STR.msRvAddReason} value={r.addReason} /> : null}
        {r.rejectReason && !r.mergedInto ? <Row label={STR.msRvRsRejected} value={r.rejectReason} /> : null}
      </Card>

      {r.claudeNote ? (
        <Card>
          <Muted>
            {STR.msRvClaudeNote} · {r.claudeNote}
          </Muted>
        </Card>
      ) : null}

      {kids.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{fill(STR.msRvChildrenTpl, { n: bnNum(kids.length), sub: levels.sub })}</Body>
          {kids.map((k) => (
            <TapText key={k.code} onPress={() => navigation.push("MasteryReviewRow", { reviewId: q.id, code: k.code })}>
              {stepLine(k)}
            </TapText>
          ))}
        </Card>
      ) : null}

      {siblings.length > 1 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{fill(STR.msRvSiblingsTpl, { objective: levels.objective, sub: levels.sub })}</Body>
          {siblings.map((k) =>
            k.code === r.code ? (
              <Body key={k.code} style={{ fontWeight: "700" }}>
                {stepLine(k)}
              </Body>
            ) : (
              <TapText key={k.code} onPress={() => navigation.replace("MasteryReviewRow", { reviewId: q.id, code: k.code })}>
                {stepLine(k)}
              </TapText>
            ),
          )}
        </Card>
      ) : null}

      {canAddHere && addParent ? (
        adding ? (
          <AddCard key={addParent.code} q={q} fixedParent={addParent} onDone={() => setAdding(false)} />
        ) : (
          <Button title={fill(STR.msRvAddSubHereTpl, { sub: levels.sub })} variant="secondary" onPress={() => setAdding(true)} />
        )
      ) : null}

      {r.mergedInto && byCode.has(r.mergedInto) ? (
        <Button title={`${STR.msRvDetails}: ${codeTail(r.mergedInto)}`} variant="secondary" onPress={() => navigation.replace("MasteryReviewRow", { reviewId: q.id, code: r.mergedInto! })} />
      ) : null}

      {editable ? (
        <Card>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            {r.reviewState === "PROPOSED" || (r.reviewState === "REJECTED" && !r.mergedInto) ? (
              <Button title={STR.msRvAccept} loading={act.busy} onPress={() => run({ action: "ACCEPT", code: r.code })} />
            ) : null}
            {live ? <Button title={STR.msRvEdit} variant={mode === "EDIT" ? "primary" : "secondary"} onPress={() => setMode(mode === "EDIT" ? null : "EDIT")} /> : null}
            {live && r.level !== "SUB" && r.tagged && kids.length === 0 ? (
              <Button title={STR.msRvSplit} variant={mode === "SPLIT" ? "primary" : "secondary"} onPress={() => setMode(mode === "SPLIT" ? null : "SPLIT")} />
            ) : null}
            {canUnsplit ? (
              <Button title={STR.msRvUndoSplit} variant={mode === "UNSPLIT" ? "primary" : "secondary"} onPress={() => setMode(mode === "UNSPLIT" ? null : "UNSPLIT")} />
            ) : null}
            {live ? <Button title={STR.msRvMerge} variant={mode === "MERGE" ? "primary" : "secondary"} onPress={() => setMode(mode === "MERGE" ? null : "MERGE")} /> : null}
            {live ? <Button title={STR.msRvMove} variant={mode === "MOVE" ? "primary" : "secondary"} onPress={() => setMode(mode === "MOVE" ? null : "MOVE")} /> : null}
            {live ? <Button title={STR.msRvRejectFull} variant="ghost" onPress={() => setMode(mode === "REJECT" ? null : "REJECT")} /> : null}
          </View>
          {mode === "EDIT" ? <EditForm q={q} r={r} run={run} busy={act.busy} /> : null}
          {mode === "SPLIT" ? <SplitForm r={r} run={run} busy={act.busy} /> : null}
          {mode === "UNSPLIT" && canUnsplit ? (
            <View style={{ gap: space(2) }}>
              <Muted>{fill(STR.msRvUndoSplitHintTpl, { n: bnNum(kids.length), sub: levels.sub, objective: levels.objective })}</Muted>
              <Button title={STR.msRvUndoSplitConfirm} loading={act.busy} onPress={() => run({ action: "MERGE", code: kids[0].code, intoCode: r.code })} />
            </View>
          ) : null}
          {mode === "MERGE" ? (
            <View style={{ gap: space(2) }}>
              <Muted>{STR.msRvMergeHint}</Muted>
              <Select label={STR.msRvMergeInto} value={target} options={mergeOptions} onChange={setTarget} searchable />
              <Button title={STR.msRvMerge} loading={act.busy} disabled={!target} onPress={() => run({ action: "MERGE", code: r.code, intoCode: target })} />
            </View>
          ) : null}
          {mode === "MOVE" ? (
            <View style={{ gap: space(2) }}>
              <Select
                label={`${fill(STR.msRvMoveToParentTpl, { objective: levels.objective })} / ${fill(STR.msRvMoveToDomainTpl, { domain: levels.domain })}`}
                value={target}
                options={[...(r.level !== "SUB" ? domainOptions : []), ...(r.tagged && kids.length === 0 ? parentOptions : [])]}
                onChange={setTarget}
                searchable
              />
              <Button
                title={STR.msRvMove}
                loading={act.busy}
                disabled={!target}
                onPress={() =>
                  run(
                    target?.startsWith("D:")
                      ? { action: "MOVE", code: r.code, toDomainCode: target.slice(2) }
                      : { action: "MOVE", code: r.code, toParentCode: (target ?? "").slice(2) },
                  )
                }
              />
            </View>
          ) : null}
          {mode === "REJECT" ? (
            <View style={{ gap: space(2) }}>
              <Field value={reason} onChangeText={setReason} placeholder={STR.msRvReasonPh} multiline />
              <Button title={STR.msRvConfirmReject} variant="danger" loading={act.busy} disabled={!reason.trim()} onPress={() => run({ action: "REJECT", code: r.code, reason })} />
            </View>
          ) : null}
          {act.error ? <Notice message={act.error} tone="danger" /> : null}
        </Card>
      ) : null}

      <Card>
        <ReviewThreads queue={q} code={r.code} title={STR.msRvComments} />
      </Card>
    </Screen>
  );
}
