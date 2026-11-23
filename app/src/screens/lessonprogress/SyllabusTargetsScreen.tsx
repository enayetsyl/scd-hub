/**
 * SyllabusTargetsScreen (AL-11, D-#1675, docs/prd-academic-loop-2027.md §3.3, journey A3) — "লক্ষ্য তারিখ": the Office sets,
 * per class × subject, the half-yearly and the annual end session and date. The on-track column on the lesson-progress
 * screens reads these; a class × subject with no target keeps reading "লক্ষ্য দেওয়া নেই" and nothing else changes.
 * `lesson_progress:set_targets` only. Each term row saves on its own; clearing the date and saving removes the target.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  SET_SYLLABUS_TARGETS,
  SYLLABUS_TARGET_BOARD_QUERY,
  SYLLABUS_TARGET_YEARS_QUERY,
  type SyllabusTargetBoardRowT,
  type SyllabusTargetViewT,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Select, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum, classLevelLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Term = "HALF_YEARLY" | "ANNUAL";

interface Draft {
  endKey: string | null;
  date: string;
}

const draftOf = (t: SyllabusTargetViewT | null | undefined): Draft => ({ endKey: t?.endKey ?? null, date: t?.targetDate ?? "" });

/** One term of one subject: end-session picker + date + save / clear. */
function TermEditor({
  classLevel,
  academicYearId,
  minKey,
  maxKey,
  row,
  term,
  saved,
  onSaved,
}: {
  classLevel: number;
  academicYearId: string | null;
  minKey?: string;
  maxKey?: string;
  row: SyllabusTargetBoardRowT;
  term: Term;
  saved: SyllabusTargetViewT | null;
  onSaved: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(draftOf(saved));
  const [busy, setBusy] = useState(false);
  const [, save] = useMutation(SET_SYLLABUS_TARGETS);
  // Re-seed when the saved target changes (a refetch after saving, or another class chosen).
  useEffect(() => setDraft(draftOf(saved)), [saved?.endKey, saved?.targetDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () =>
      (row.sessions ?? []).map((s) => ({
        label: `${s.chapter}${s.chapterTitle ? ` · ${s.chapterTitle}` : ""} — ${STR.lpSession} ${bnNum(s.sessionIndex)}/${bnNum(s.sessionOf)}`,
        value: s.key,
        hint: s.titleBn,
      })),
    [row.sessions],
  );

  async function submit(clear: boolean): Promise<void> {
    const end = row.sessions?.find((s) => s.key === draft.endKey);
    if (!clear && !draft.date) {
      toast.show(STR.ltDate, "danger");
      return;
    }
    if (!clear && term === "HALF_YEARLY" && !end) {
      toast.show(STR.ltPickSession, "danger");
      return;
    }
    setBusy(true);
    const res = await save({
      academicYearId,
      inputs: [
        {
          classLevel,
          subject: row.subject,
          term,
          targetDate: clear ? "" : draft.date,
          endChapter: clear ? null : (end?.chapter ?? null),
          endSessionIndex: clear ? null : (end?.sessionIndex ?? null),
        },
      ],
    });
    setBusy(false);
    if (res.error || !res.data?.setSyllabusTargets) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    if (clear) setDraft({ endKey: null, date: "" });
    toast.show(STR.ltSaved, "ok");
    onSaved();
  }

  return (
    <View style={{ marginTop: space(2) }}>
      <Body style={{ fontWeight: "700" }}>{term === "HALF_YEARLY" ? STR.ltHalfYearly : STR.ltAnnual}</Body>
      <Select
        label={STR.ltEndSession}
        value={draft.endKey}
        options={options}
        onChange={(v) => setDraft((d) => ({ ...d, endKey: v }))}
        placeholder={STR.ltPickSession}
        searchable
        helper={term === "ANNUAL" ? STR.ltAnnualHint : undefined}
      />
      <DateField label={STR.ltDate} value={draft.date} min={minKey} max={maxKey} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.ltSave} onPress={() => submit(false)} loading={busy} />
        {saved ? <Button title={STR.ltClear} variant="ghost" onPress={() => submit(true)} disabled={busy} /> : null}
      </View>
    </View>
  );
}

export default function SyllabusTargetsScreen(): React.ReactElement {
  const [level, setLevel] = useState(1);
  // The current year by default; the prepared next year is offered when it exists (dates must lie inside the chosen year).
  const [yearsQ] = useQuery({ query: SYLLABUS_TARGET_YEARS_QUERY, variables: {} });
  const years = yearsQ.data?.syllabusTargetYears ?? [];
  const [yearId, setYearId] = useState<string | null>(null);
  const year = years.find((y) => y.id === yearId) ?? years.find((y) => y.current) ?? null;
  const [q, refetch] = useQuery({
    query: SYLLABUS_TARGET_BOARD_QUERY,
    variables: { classLevel: level, academicYearId: year?.id ?? null },
    pause: yearsQ.fetching,
    requestPolicy: "cache-and-network",
  });
  const reload = useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]);
  const rows = q.data?.syllabusTargetBoard ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(2) }}>
        <Muted>{STR.ltIntro}</Muted>
        {years.length > 1 ? (
          <>
            <ChipRow>
              {years.map((y) => (
                <Chip key={y.id} label={`${STR.ltYear} ${y.label}`} selected={year?.id === y.id} onPress={() => setYearId(y.id)} />
              ))}
            </ChipRow>
            {year && !year.current ? <Muted>{STR.ltNextYearHint}</Muted> : null}
          </>
        ) : null}
        <ChipRow>
          {[1, 2, 3, 4, 5].map((l) => (
            <Chip key={l} label={classLevelLabel(l)} selected={level === l} onPress={() => setLevel(l)} />
          ))}
        </ChipRow>
        {q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={reload} />
        ) : q.fetching && rows.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.ltNoPlans} />
        ) : (
          rows.map((r) => (
            <Card key={`${year?.id ?? ""}|${level}|${r.subject}`}>
              <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(r.subject)}</Body>
              {!r.halfYearly && !r.annual ? <Muted>{STR.ltNone}</Muted> : null}
              <TermEditor classLevel={level} academicYearId={year?.id ?? null} minKey={year?.startKey} maxKey={year?.endKey} row={r} term="HALF_YEARLY" saved={r.halfYearly ?? null} onSaved={reload} />
              <TermEditor classLevel={level} academicYearId={year?.id ?? null} minKey={year?.startKey} maxKey={year?.endKey} row={r} term="ANNUAL" saved={r.annual ?? null} onSaved={reload} />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
