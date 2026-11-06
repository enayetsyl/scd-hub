/**
 * MasteryReviewAddCard (OT-2, prd-objective-tree §7) — the নতুন যোগ form of a review round.
 *
 * Used twice: at the foot of the round page (any level, any parent), and on a row's own page with
 * `fixedParent` (D-#1016) — the level is then the sub-objective and the parent is that objective,
 * so a reviewer adds a step where she is reading instead of hunting for the button below 70 rows.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { MASTERY_REVIEW_DECIDE, type ReviewQueue, type ReviewRow } from "../../graphql/masteryReview";
import { Card, Body, Muted, Button, Chip, ChipRow, Field, Notice, Select } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { space } from "../../theme";
import { fill } from "./masteryStateUi";
import { codeTail, useReviewAction } from "./masteryReviewUi";

const isOut = (r: ReviewRow) => r.reviewState === "REJECTED" || !!r.mergedInto;

const splitList = (t: string) =>
  t
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function AddCard({ q, onDone, fixedParent }: { q: ReviewQueue; onDone: () => void; fixedParent?: ReviewRow }): React.ReactElement {
  const levels = useMasteryLevelLabels();
  const act = useReviewAction(MASTERY_REVIEW_DECIDE);
  const [level, setLevel] = useState<"OBJECTIVE" | "SUB">("SUB");
  const [parent, setParent] = useState<string | null>(fixedParent?.code ?? null);
  const [chapter, setChapter] = useState<string | null>(null);
  const [strand, setStrand] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [qts, setQts] = useState<string[]>([]);
  const [exercises, setExercises] = useState("");
  const [reason, setReason] = useState("");
  const [tip, setTip] = useState("");
  const parents = q.rows.filter((r) => r.level !== "SUB" && r.status === "DRAFT" && !isOut(r)).map((r) => ({ label: `${codeTail(r.code)} · ${r.labelBn}`, value: r.code }));
  return (
    <Card>
      {fixedParent ? (
        <>
          <Body style={{ fontWeight: "700" }}>{fill(STR.msRvAddSubHereTpl, { sub: levels.sub })}</Body>
          <Muted>
            {levels.objective}: {codeTail(fixedParent.code)} · {fixedParent.labelBn}
          </Muted>
        </>
      ) : (
        <>
          <Body style={{ fontWeight: "700" }}>{STR.msRvAddNew}</Body>
          <Muted>{STR.msRvLevel}</Muted>
          <ChipRow>
            <Chip label={levels.sub} selected={level === "SUB"} onPress={() => setLevel("SUB")} />
            <Chip label={levels.objective} selected={level === "OBJECTIVE"} onPress={() => setLevel("OBJECTIVE")} />
          </ChipRow>
        </>
      )}
      {fixedParent ? null : level === "SUB" ? (
        <Select label={levels.objective} value={parent} options={parents} onChange={setParent} searchable />
      ) : (
        <View style={{ gap: space(1) }}>
          <Select
            label={STR.msRvChapterPick}
            value={chapter}
            options={q.chapters.map((c) => ({ label: `${bnNum(c.number)} · ${c.titleBn}`, value: String(c.number) }))}
            onChange={setChapter}
          />
          <Field label={STR.msRvStrandCode} value={strand} onChangeText={(t) => setStrand(t.toUpperCase())} />
          <Select label={levels.domain} value={domain} options={q.domains.map((d) => ({ label: d.labelBn, value: d.code }))} onChange={setDomain} />
          <Field label={STR.msRvHomeTipField} value={tip} onChangeText={setTip} multiline />
        </View>
      )}
      <Field label={STR.msRvLabel} value={label} onChangeText={setLabel} />
      <Muted>{STR.msQuestionTypes}</Muted>
      <ChipRow>
        {q.questionTypes.map((t) => (
          <Chip key={t.code} label={t.labelBn || t.code} selected={qts.includes(t.code)} onPress={() => setQts((p) => (p.includes(t.code) ? p.filter((x) => x !== t.code) : [...p, t.code]))} />
        ))}
      </ChipRow>
      <Field label={STR.msRvExercises} value={exercises} onChangeText={setExercises} multiline />
      <Field label={STR.msRvAddReasonField} value={reason} onChangeText={setReason} />
      <Button
        title={STR.msRvSave}
        loading={act.busy}
        disabled={!label.trim()}
        onPress={() =>
          void act
            .run(
              {
                reviewId: q.id,
                input: {
                  action: "ADD",
                  level,
                  parentCode: level === "SUB" ? parent : null,
                  chapterNumber: level === "OBJECTIVE" && !strand.trim() && chapter ? Number(chapter) : null,
                  strand: level === "OBJECTIVE" && strand.trim() ? strand.trim() : null,
                  domainCode: level === "OBJECTIVE" ? domain : null,
                  homeTipBn: level === "OBJECTIVE" ? tip : null,
                  labelBn: label,
                  questionTypeCodes: qts,
                  exercises: splitList(exercises),
                  reason,
                },
              },
              STR.msRvSaved,
            )
            .then((ok) => ok && onDone())
        }
      />
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </Card>
  );
}
