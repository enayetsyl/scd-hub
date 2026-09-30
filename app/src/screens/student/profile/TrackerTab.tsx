/**
 * Homework / Assignment tab — three layers instead of the old wall of counters:
 *
 *   1. three headline numbers (submitted %, outstanding now, quality % or avg marks);
 *   2. "outstanding now" — the few items the student owes, because that is what a
 *      person opening the profile usually wants first;
 *   3. one row per subject; tapping a row narrows the item list below to that subject.
 *      The item list is the deep dive: date, status, result/marks, teacher feedback,
 *      filterable by where the work stands.
 *
 * The workflow counters (received, absent at issue, pending checking/return, chased…)
 * are teacher-desk numbers; they stay on the workspaces, not here. The buckets below
 * mirror the server's own counter rules (StudentProfileService): owed + overdue =
 * not submitted, ABSENT_REDELIVER = not received, SUBMITTED/CHECKED/RESUBMIT = with
 * the teacher, RETURNED = done.
 */
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TrackerItemT, TrackerPanelT } from "../../../graphql/studentProfile";
import { Badge, Body, Button, Card, Chip, ChipRow, Loader, Muted, Notice } from "../../../components/ui";
import { STR, bnNum, hwResultLabel, hwSubjectLabel, isoDateLabel, lifecycleStateLabel } from "../../../lib/labels";
import { space, useColors } from "../../../theme";
import { DataTable, SectionTitle, StatTile, TileRow, ToneText, pctText, toneForCount, toneForPct } from "./parts";

type Bucket = "outstanding" | "upcoming" | "withTeacher" | "done";
type Filter = "all" | Bucket;

const OWED = new Set(["GIVEN", "DUE", "CHASE"]);
const WITH_TEACHER = new Set(["SUBMITTED", "CHECKED", "RESUBMIT"]);

export function bucketOf(it: Pick<TrackerItemT, "state" | "overdue">): Bucket {
  if (it.state === "ABSENT_REDELIVER") return "outstanding";
  if (OWED.has(it.state)) return it.overdue ? "outstanding" : "upcoming";
  if (WITH_TEACHER.has(it.state)) return "withTeacher";
  return "done";
}

const BUCKET_TONE: Record<Bucket, "danger" | "muted" | "info" | "ok"> = {
  outstanding: "danger",
  upcoming: "muted",
  withTeacher: "info",
  done: "ok",
};

const PAGE = 20;

function ItemRow({ it, isAssignment }: { it: TrackerItemT; isAssignment: boolean }): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const bucket = bucketOf(it);
  const outcome = isAssignment
    ? it.marks != null && it.totalMarks
      ? `${bnNum(it.marks)}/${bnNum(it.totalMarks)}`
      : null
    : it.result
      ? hwResultLabel(it.result)
      : null;
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space(2), gap: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Body style={{ fontWeight: "600" }}>
            {hwSubjectLabel(it.subject)} · <Muted>{isoDateLabel(it.dateGiven)}</Muted>
          </Body>
          {it.description ? (
            <Text numberOfLines={open ? undefined : 1} style={{ color: colors.textSecondary, fontSize: 14 }}>
              {it.description}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Badge text={lifecycleStateLabel(it.state)} tone={BUCKET_TONE[bucket]} />
          {outcome ? <Muted style={{ fontWeight: "700" }}>{outcome}</Muted> : null}
        </View>
      </View>
      {open ? (
        <View style={{ gap: 2, marginTop: space(1) }}>
          {it.dueDate ? (
            <Muted>
              {STR.spDueOn}: {isoDateLabel(it.dueDate)}
              {it.overdue && bucket === "outstanding" ? ` · ${STR.spOverdue}` : ""}
            </Muted>
          ) : null}
          {it.chaseCount > 0 ? (
            <Muted>
              {STR.spChased}: {bnNum(it.chaseCount)}
            </Muted>
          ) : null}
          {it.resubmissions > 0 ? (
            <Muted>
              {STR.spResubmissions}: {bnNum(it.resubmissions)}
            </Muted>
          ) : null}
          {it.feedback ? (
            <Muted>
              {STR.spFeedback}: {it.feedback}
            </Muted>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function TrackerTab({
  kind,
  panel,
  fetching,
  error,
  narrowed,
  rangeControl,
}: {
  kind: "homework" | "assignment";
  panel: TrackerPanelT | null;
  fetching: boolean;
  error: string | null;
  narrowed: boolean;
  rangeControl: React.ReactNode;
}): React.ReactElement {
  const isAssignment = kind === "assignment";
  const [subject, setSubject] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);

  const items = panel?.items ?? [];
  const outstanding = useMemo(() => items.filter((i) => bucketOf(i) === "outstanding"), [items]);

  const bySubjectExtra = useMemo(() => {
    const m = new Map<string, { outstanding: number; latest: TrackerItemT | null }>();
    for (const it of items) {
      const e = m.get(it.subject) ?? { outstanding: 0, latest: null };
      if (bucketOf(it) === "outstanding") e.outstanding += 1;
      // items arrive newest first, so the first graded one is the latest
      if (!e.latest && it.marks != null) e.latest = it;
      m.set(it.subject, e);
    }
    return m;
  }, [items]);

  const listed = useMemo(
    () => items.filter((i) => (!subject || i.subject === subject) && (filter === "all" || bucketOf(i) === filter)),
    [items, subject, filter],
  );

  const body = (() => {
    if (error) return <Notice message={error} tone="danger" />;
    if (fetching && !panel) return <Loader label={STR.loading} />;
    if (!panel || panel.totals.sheets === 0) {
      return <Muted>{narrowed ? STR.spNoDataMySubjects : STR.spNoDataInRange}</Muted>;
    }
    const t = panel.totals;
    return (
      <View style={{ gap: space(3) }}>
        <TileRow>
          {isAssignment ? (
            <StatTile label={STR.spAvgMarks} value={pctText(t.avgMarksPct)} tone={toneForPct(t.avgMarksPct, 70, 50)} />
          ) : null}
          <StatTile
            label={STR.spSubmissionPct}
            value={pctText(t.submissionPct)}
            sub={`${bnNum(t.submitted)} / ${bnNum(t.sheets)}`}
            tone={toneForPct(t.submissionPct, 85, 65)}
          />
          <StatTile
            label={STR.spOutstandingNow}
            value={bnNum(outstanding.length)}
            tone={toneForCount(outstanding.length)}
            onPress={outstanding.length > 0 ? () => { setSubject(null); setFilter("outstanding"); } : undefined}
          />
          {!isAssignment ? (
            <StatTile
              label={STR.spQualityPct}
              value={pctText(t.qualityPct)}
              sub={`${STR.spCorrect} ${bnNum(t.correct)} · ${STR.spPartial} ${bnNum(t.partial)} · ${STR.spWrong} ${bnNum(t.wrong)}`}
              tone={toneForPct(t.qualityPct)}
            />
          ) : null}
        </TileRow>

        <Card style={{ gap: space(1) }}>
          <SectionTitle title={STR.spOutstandingNow} />
          {outstanding.length === 0 ? (
            <Muted>{STR.spNothingOutstanding}</Muted>
          ) : (
            outstanding.slice(0, 5).map((it) => <ItemRow key={it.recordId} it={it} isAssignment={isAssignment} />)
          )}
          {outstanding.length > 5 ? (
            <Button
              title={`${STR.spShowMore} (${bnNum(outstanding.length)})`}
              variant="ghost"
              onPress={() => { setSubject(null); setFilter("outstanding"); }}
            />
          ) : null}
        </Card>

        <View style={{ gap: space(2) }}>
          <SectionTitle title={STR.spBySubject} hint={STR.spTapSubjectHint} />
          <DataTable
            columns={
              isAssignment
                ? [
                    { label: STR.spColSubject, width: 150 },
                    { label: STR.spColCount, width: 70, align: "right" },
                    { label: STR.spAvgMarks, width: 100, align: "right" },
                    { label: STR.spColLatest, width: 90, align: "right" },
                    { label: STR.spColOutstanding, width: 90, align: "right" },
                  ]
                : [
                    { label: STR.spColSubject, width: 150 },
                    { label: STR.spColGiven, width: 70, align: "right" },
                    { label: STR.spSubmissionPct, width: 100, align: "right" },
                    { label: STR.spQualityPct, width: 100, align: "right" },
                    { label: STR.spColOutstanding, width: 90, align: "right" },
                  ]
            }
            rows={panel.bySubject.map((r) => {
              const extra = bySubjectExtra.get(r.subject);
              const owed = extra?.outstanding ?? 0;
              const c = r.counters;
              const latest = extra?.latest;
              return {
                key: r.subject,
                selected: subject === r.subject,
                onPress: () => {
                  setSubject(subject === r.subject ? null : r.subject);
                  setLimit(PAGE);
                },
                cells: isAssignment
                  ? [
                      hwSubjectLabel(r.subject),
                      bnNum(c.sheets),
                      <ToneText key="a" tone={toneForPct(c.avgMarksPct, 70, 50)}>{pctText(c.avgMarksPct)}</ToneText>,
                      latest && latest.totalMarks ? `${bnNum(latest.marks ?? 0)}/${bnNum(latest.totalMarks)}` : "—",
                      <ToneText key="o" tone={owed === 0 ? "muted" : "danger"}>{bnNum(owed)}</ToneText>,
                    ]
                  : [
                      hwSubjectLabel(r.subject),
                      bnNum(c.sheets),
                      <ToneText key="s" tone={toneForPct(c.submissionPct, 85, 65)}>{pctText(c.submissionPct)}</ToneText>,
                      <ToneText key="q" tone={toneForPct(c.qualityPct)}>{pctText(c.qualityPct)}</ToneText>,
                      <ToneText key="o" tone={owed === 0 ? "muted" : "danger"}>{bnNum(owed)}</ToneText>,
                    ],
              };
            })}
          />
        </View>

        <Card style={{ gap: space(2) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space(2) }}>
            <SectionTitle title={subject ? `${STR.spAllWork} · ${hwSubjectLabel(subject)}` : STR.spAllWork} />
            {subject ? <Chip label={`✕ ${hwSubjectLabel(subject)}`} selected onPress={() => setSubject(null)} /> : null}
          </View>
          <ChipRow>
            {(
              [
                ["all", STR.spFilterAll],
                ["outstanding", STR.spFilterOutstanding],
                ["upcoming", STR.spAwaiting],
                ["withTeacher", STR.spFilterWithTeacher],
                ["done", STR.spFilterDone],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <Chip key={k} label={label} selected={filter === k} onPress={() => { setFilter(k); setLimit(PAGE); }} />
            ))}
          </ChipRow>
          {listed.length === 0 ? <Muted>{STR.spNoItemsFilter}</Muted> : null}
          {listed.slice(0, limit).map((it) => (
            <ItemRow key={it.recordId} it={it} isAssignment={isAssignment} />
          ))}
          {listed.length > limit ? (
            <Button
              title={`${STR.spShowMore} (${bnNum(listed.length - limit)})`}
              variant="secondary"
              onPress={() => setLimit((l) => l + PAGE)}
            />
          ) : null}
        </Card>
      </View>
    );
  })();

  return (
    <View style={{ gap: space(3) }}>
      {rangeControl}
      {narrowed ? <Muted>{STR.spMySubjectsNote}</Muted> : null}
      {body}
    </View>
  );
}
