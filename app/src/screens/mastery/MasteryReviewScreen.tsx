/**
 * MasteryReviewScreen (OT-2, prd-objective-tree §7, mock 2) — the review queue of one round.
 *
 * Grouped chapter → objective; progress "N / M দেখা হয়েছে"; filter "শুধু বাকিগুলো"; one-tap
 * গ্রহণ / বাদ per row (বাদ asks for the reason in place); "এই {objective}-এর সব গ্রহণ" (BULK_ACCEPT,
 * one event per row). Below: the unmapped exercises to resolve, the round's own comments, the
 * নতুন যোগ form, then জমা দিন (reviewer) / আবার খুলুন / চূড়ান্ত করার পাতা (Principal). The
 * Principal also assigns reviewers (বরাদ্দ) here.
 *
 * Every refusal shows the server's sentence — a broken tree rule is named there ("[SINGLE_CHILD] …").
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  ASSIGN_MASTERY_REVIEWERS,
  MASTERY_REVIEWER_CANDIDATES_QUERY,
  MASTERY_REVIEW_DECIDE,
  MASTERY_REVIEW_RESOLVE_UNMAPPED,
  REOPEN_MASTERY_REVIEW,
  SUBMIT_MASTERY_REVIEW,
  type ReviewPerson,
  type ReviewQueue,
  type ReviewRow,
} from "../../graphql/masteryReview";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, Select } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { space, useColors } from "../../theme";
import { fill } from "./masteryStateUi";
import {
  ReviewThreads,
  TapText,
  codeTail,
  formatExerciseRef,
  reviewStateLabel,
  reviewStateTone,
  roundStateLabel,
  roundStateTone,
  useReviewAction,
  useReviewQueue,
} from "./masteryReviewUi";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryReview">;

const isOut = (r: ReviewRow) => r.reviewState === "REJECTED" || !!r.mergedInto;

interface Group {
  key: string;
  heading: string;
  objective: ReviewRow;
  children: ReviewRow[];
}

function groupsOf(q: ReviewQueue): { chapter: string; groups: Group[] }[] {
  const byParent = new Map<string, ReviewRow[]>();
  for (const r of q.rows) {
    if (r.level === "SUB" && r.parentCode) byParent.set(r.parentCode, [...(byParent.get(r.parentCode) ?? []), r]);
  }
  const titles = new Map(q.chapters.map((c) => [c.number, c.titleBn]));
  const sections = new Map<string, { chapter: string; groups: Group[] }>();
  const objectives = q.rows.filter((r) => r.level !== "SUB").sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  for (const o of objectives) {
    const key = o.strand ? "SK" : `C${o.chapterNumber ?? 0}`;
    const chapter = o.strand
      ? STR.msTreeStrands
      : `${fill(STR.msRvChapter, { n: bnNum(o.chapterNumber ?? 0) })}${titles.get(o.chapterNumber ?? -1) ? ` · ${titles.get(o.chapterNumber ?? -1)}` : ""}`;
    const sec = sections.get(key) ?? { chapter, groups: [] };
    sec.groups.push({ key: o.code, heading: o.labelBn, objective: o, children: (byParent.get(o.code) ?? []).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })) });
    sections.set(key, sec);
  }
  return [...sections.entries()].sort(([a], [b]) => (a === "SK" ? 1 : b === "SK" ? -1 : Number(a.slice(1)) - Number(b.slice(1)))).map(([, v]) => v);
}

function AssignCard({ q }: { q: ReviewQueue }): React.ReactElement {
  const [{ data, fetching }] = useQuery({ query: MASTERY_REVIEWER_CANDIDATES_QUERY });
  const people = (data?.masteryReviewerCandidates ?? []) as ReviewPerson[];
  const [picked, setPicked] = useState<string[]>(q.reviewers.map((r) => r.id));
  const act = useReviewAction(ASSIGN_MASTERY_REVIEWERS);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.msRvAssign}</Body>
      <Muted>{STR.msRvAssignHint}</Muted>
      {fetching && people.length === 0 ? <Loader /> : null}
      {!fetching && people.length === 0 ? <Notice message={STR.msRvNoCandidates} tone="warn" /> : null}
      <ChipRow>
        {people.map((p) => (
          <Chip key={p.id} label={p.name} selected={picked.includes(p.id)} onPress={() => toggle(p.id)} />
        ))}
      </ChipRow>
      <Button
        title={STR.msRvAssignSave}
        variant="secondary"
        disabled={picked.length === 0}
        loading={act.busy}
        onPress={() => void act.run({ reviewId: q.id, reviewerIds: picked }, STR.msRvAssigned)}
      />
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </Card>
  );
}

function RowLine({
  q,
  r,
  onOpen,
  rejecting,
  setRejecting,
  hideLabel = false,
}: {
  q: ReviewQueue;
  r: ReviewRow;
  onOpen: () => void;
  rejecting: string | null;
  setRejecting: (code: string | null) => void;
  /** The objective's own row: its label is already the card heading, so don't print it twice. */
  hideLabel?: boolean;
}): React.ReactElement {
  const colors = useColors();
  const act = useReviewAction(MASTERY_REVIEW_DECIDE);
  const [reason, setReason] = useState("");
  const editable = q.canWrite && r.status === "DRAFT" && !r.mergedInto;
  const out = isOut(r);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(1), gap: space(1) }}>
      <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: space(0.5) }}>
          {hideLabel ? null : (
            <TapText onPress={onOpen} style={out ? { textDecorationLine: "line-through", color: colors.textSecondary } : undefined}>
              {r.labelBn}
            </TapText>
          )}
          <Muted>
            {codeTail(r.code)}
            {r.bookRef.exercises.length ? ` · ${r.bookRef.exercises.slice(0, 3).map(formatExerciseRef).join("; ")}${r.bookRef.exercises.length > 3 ? " …" : ""}` : ""}
          </Muted>
        </View>
        <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
          {r.status === "LOCKED" ? <Badge text={STR.msRvLockedRow} tone="ok" /> : null}
          {r.status === "DRAFT" ? (
            <Badge text={r.mergedInto ? fill(STR.msRvMergedTo, { code: codeTail(r.mergedInto) }) : reviewStateLabel(r.reviewState)} tone={reviewStateTone(r.reviewState)} />
          ) : null}
          {r.openComments > 0 ? <Badge text={`${STR.msRvComments} ${bnNum(r.openComments)}`} tone="warn" /> : null}
          {editable && r.reviewState !== "ACCEPTED" && r.reviewState !== "EDITED" && r.reviewState !== "ADDED" ? (
            <Button title={STR.msRvAccept} variant="secondary" loading={act.busy} onPress={() => void act.run({ reviewId: q.id, input: { action: "ACCEPT", code: r.code } })} />
          ) : null}
          {editable && r.reviewState !== "REJECTED" ? (
            <Button title={STR.msRvReject} variant="ghost" onPress={() => setRejecting(rejecting === r.code ? null : r.code)} />
          ) : null}
        </View>
      </View>
      {rejecting === r.code ? (
        <View style={{ gap: space(1) }}>
          <Field value={reason} onChangeText={setReason} placeholder={STR.msRvReasonPh} />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button
              title={STR.msRvConfirmReject}
              variant="danger"
              disabled={!reason.trim()}
              loading={act.busy}
              onPress={() =>
                void act.run({ reviewId: q.id, input: { action: "REJECT", code: r.code, reason } }).then((ok) => {
                  if (ok) {
                    setReason("");
                    setRejecting(null);
                  }
                })
              }
            />
            <Button title={STR.msRvCancel} variant="ghost" onPress={() => setRejecting(null)} />
          </View>
        </View>
      ) : null}
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </View>
  );
}

function GroupCard({ q, g, onOpen, pendingOnly }: { q: ReviewQueue; g: Group; onOpen: (code: string) => void; pendingOnly: boolean }): React.ReactElement {
  const levels = useMasteryLevelLabels();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const bulk = useReviewAction(MASTERY_REVIEW_DECIDE);
  const all = [g.objective, ...g.children];
  const proposed = all.filter((r) => r.status === "DRAFT" && r.reviewState === "PROPOSED" && !r.mergedInto);
  const shown = pendingOnly ? proposed : all;
  const liveKids = g.children.filter((c) => !isOut(c)).length;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <TapText
          style={[{ fontWeight: "700", flexShrink: 1 }, isOut(g.objective) ? { textDecorationLine: "line-through" } : null]}
          onPress={() => onOpen(g.objective.code)}
        >
          {g.heading}
        </TapText>
        <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
          <Badge text={levels.objective} tone="info" />
          {liveKids > 0 ? <Badge text={fill(STR.msRvChildrenTpl, { n: bnNum(liveKids), sub: levels.sub })} tone="muted" /> : null}
        </View>
      </View>
      {shown.map((r) => (
        <RowLine
          key={r.code}
          q={q}
          r={r}
          onOpen={() => onOpen(r.code)}
          rejecting={rejecting}
          setRejecting={setRejecting}
          hideLabel={r.code === g.objective.code}
        />
      ))}
      {q.canWrite && proposed.length > 1 ? (
        <Button
          title={fill(STR.msRvAcceptAllTpl, { objective: levels.objective })}
          variant="secondary"
          loading={bulk.busy}
          onPress={() => void bulk.run({ reviewId: q.id, input: { action: "BULK_ACCEPT", code: g.objective.code } })}
        />
      ) : null}
      {bulk.error ? <Notice message={bulk.error} tone="danger" /> : null}
    </Card>
  );
}

function UnmappedCard({ q }: { q: ReviewQueue }): React.ReactElement | null {
  const act = useReviewAction(MASTERY_REVIEW_RESOLVE_UNMAPPED);
  const [pick, setPick] = useState<Record<string, string | null>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  if (q.unmapped.length === 0) return null;
  const targets = q.rows.filter((r) => r.status === "DRAFT" && r.tagged && !isOut(r)).map((r) => ({ label: `${codeTail(r.code)} · ${r.labelBn}`, value: r.code }));
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>
        {STR.msRvUnmappedTitle} ({bnNum(q.unresolvedUnmapped)} / {bnNum(q.unmapped.length)})
      </Body>
      {q.unmapped.map((u) => (
        <View key={u.ref} style={{ gap: space(1), paddingVertical: space(1) }}>
          <Body>
            {u.ref}
            {u.text ? ` — ${u.text}` : ""}
          </Body>
          {u.reason ? <Muted>{u.reason}</Muted> : null}
          {u.resolution ? (
            <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Badge text={u.resolvedCode ? `${STR.msRvMapTo}: ${codeTail(u.resolvedCode)}` : u.resolution} tone="ok" />
              {q.canWrite ? (
                <Button title={STR.msRvReopen} variant="ghost" loading={act.busy} onPress={() => void act.run({ reviewId: q.id, ref: u.ref, reopen: true })} />
              ) : null}
            </View>
          ) : q.canWrite ? (
            <View style={{ gap: space(1) }}>
              <Select label={STR.msRvMapTo} value={pick[u.ref] ?? null} options={targets} onChange={(v) => setPick((p) => ({ ...p, [u.ref]: v }))} placeholder={STR.msRvPickRow} searchable />
              <Button
                title={STR.msRvMapTo}
                variant="secondary"
                disabled={!pick[u.ref]}
                loading={act.busy}
                onPress={() => void act.run({ reviewId: q.id, ref: u.ref, mapToCode: pick[u.ref] })}
              />
              <Field value={why[u.ref] ?? ""} onChangeText={(t) => setWhy((w) => ({ ...w, [u.ref]: t }))} placeholder={STR.msRvReasonPh} />
              <Button
                title={STR.msRvNotAssessed}
                variant="ghost"
                disabled={!(why[u.ref] ?? "").trim()}
                loading={act.busy}
                onPress={() => void act.run({ reviewId: q.id, ref: u.ref, notAssessedReason: why[u.ref] })}
              />
            </View>
          ) : null}
        </View>
      ))}
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </Card>
  );
}

const splitList = (t: string) =>
  t
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function AddCard({ q, onDone }: { q: ReviewQueue; onDone: () => void }): React.ReactElement {
  const levels = useMasteryLevelLabels();
  const act = useReviewAction(MASTERY_REVIEW_DECIDE);
  const [level, setLevel] = useState<"OBJECTIVE" | "SUB">("SUB");
  const [parent, setParent] = useState<string | null>(null);
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
      <Body style={{ fontWeight: "700" }}>{STR.msRvAddNew}</Body>
      <Muted>{STR.msRvLevel}</Muted>
      <ChipRow>
        <Chip label={levels.sub} selected={level === "SUB"} onPress={() => setLevel("SUB")} />
        <Chip label={levels.objective} selected={level === "OBJECTIVE"} onPress={() => setLevel("OBJECTIVE")} />
      </ChipRow>
      {level === "SUB" ? (
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

export default function MasteryReviewScreen({ navigation, route }: Props): React.ReactElement {
  const { reviewId } = route.params;
  const levels = useMasteryLevelLabels();
  const colors = useColors();
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: fill(STR.msRvTitleTpl, { objective: levels.objective }) });
  }, [navigation, levels.objective]);
  const { queue: q, fetching, error } = useReviewQueue(reviewId);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const submit = useReviewAction(SUBMIT_MASTERY_REVIEW);
  const reopen = useReviewAction(REOPEN_MASTERY_REVIEW);
  const sections = useMemo(() => (q ? groupsOf(q) : []), [q]);

  if (!q) {
    return <Screen scroll>{error ? <Notice message={error} tone="danger" /> : fetching ? <Loader /> : null}</Screen>;
  }
  const pct = q.total > 0 ? Math.round((q.seen / q.total) * 100) : 0;
  const open = (code: string) => navigation.navigate("MasteryReviewRow", { reviewId: q.id, code });
  const visible = (g: Group) => !pendingOnly || [g.objective, ...g.children].some((r) => r.reviewState === "PROPOSED" && r.status === "DRAFT");

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
          <Body style={{ fontWeight: "700" }}>
            {masteryClassLabel(q.classToken)} · {hwSubjectLabel(q.subject)} · {fill(STR.msRvRound, { n: bnNum(q.round) })}
          </Body>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            {q.assignedToMe ? <Badge text={STR.msRvAssignedToYou} tone="gold" /> : null}
            <Badge text={roundStateLabel(q.state)} tone={roundStateTone(q.state)} />
          </View>
        </View>
        <View style={{ height: 6, borderRadius: 99, backgroundColor: colors.surfaceAlt, overflow: "hidden" }}>
          <View style={{ width: `${pct}%`, height: 6, backgroundColor: colors.primary }} />
        </View>
        <Muted>
          {fill(STR.msRvProgress, { seen: bnNum(q.seen), total: bnNum(q.total) })}
          {q.openComments > 0 ? ` · ${fill(STR.msRvOpenComments, { n: bnNum(q.openComments) })}` : ""}
          {q.unresolvedUnmapped > 0 ? ` · ${fill(STR.msRvUnmappedLeft, { n: bnNum(q.unresolvedUnmapped) })}` : ""}
        </Muted>
        <Muted>
          {STR.msRvReviewers}: {q.reviewers.length ? q.reviewers.map((p) => p.name).join(", ") : STR.msRvNotAssigned}
        </Muted>
        {q.book ? <Muted>{q.book}</Muted> : null}
      </Card>

      {q.canAssign ? <AssignCard key={q.reviewers.map((r) => r.id).join(",")} q={q} /> : null}
      {q.violations.length > 0 ? <Notice message={`${STR.msTreeViolations}:\n• ${q.violations.slice(0, 12).join("\n• ")}`} tone="danger" /> : null}
      {q.state === "SUBMITTED" ? <Notice message={STR.msRvSubmitted} tone="info" /> : null}

      <ChipRow>
        <Chip label={STR.msRvShowAll} selected={!pendingOnly} onPress={() => setPendingOnly(false)} />
        <Chip label={STR.msRvOnlyPending} selected={pendingOnly} onPress={() => setPendingOnly(true)} />
      </ChipRow>

      {sections.map((s) => {
        const groups = s.groups.filter(visible);
        if (groups.length === 0) return null;
        return (
          <View key={s.chapter} style={{ gap: space(2) }}>
            <Body style={{ fontWeight: "700", color: colors.textSecondary }}>{s.chapter}</Body>
            {groups.map((g) => (
              <GroupCard key={g.key} q={q} g={g} onOpen={open} pendingOnly={pendingOnly} />
            ))}
          </View>
        );
      })}

      <UnmappedCard q={q} />

      <Card>
        <ReviewThreads queue={q} code={null} title={STR.msRvRoundComment} />
      </Card>

      {q.canWrite ? (
        adding ? (
          <AddCard q={q} onDone={() => setAdding(false)} />
        ) : (
          <Button title={STR.msRvAddNew} variant="secondary" onPress={() => setAdding(true)} />
        )
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        {q.canSubmit ? (
          <Button
            title={STR.msRvSubmit}
            loading={submit.busy}
            onPress={() => {
              if (q.decisions.proposed > 0 && !confirmSubmit) {
                setConfirmSubmit(true);
                return;
              }
              void submit.run({ reviewId: q.id }, STR.msRvSubmitted).then(() => setConfirmSubmit(false));
            }}
          />
        ) : null}
        {q.canReopen ? <Button title={STR.msRvReopen} variant="secondary" loading={reopen.busy} onPress={() => void reopen.run({ reviewId: q.id }, STR.msRvReopened)} /> : null}
        {q.canAssign || q.state === "LOCKED" ? (
          <Button title={STR.msRvGoLock} variant="secondary" onPress={() => navigation.navigate("MasteryReviewLock", { reviewId: q.id })} />
        ) : null}
      </View>
      {confirmSubmit ? <Notice message={fill(STR.msRvSubmitWarn, { n: bnNum(q.decisions.proposed) })} tone="warn" /> : null}
      {submit.error ? <Notice message={submit.error} tone="danger" /> : null}
      {reopen.error ? <Notice message={reopen.error} tone="danger" /> : null}
    </Screen>
  );
}
