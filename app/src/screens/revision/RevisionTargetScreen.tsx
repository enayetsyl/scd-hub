/**
 * RevisionTargetScreen (SR-6, D-#1170) — declare a Hifz level's revision target for a
 * Saturday. One card per level (হিফয ১, হিফয ৩ …): the three parts (নতুন মুখস্ত /
 * সর্বসাম্প্রতিক পাঠ / পুরনো রিভিশন), each a start and end surah:ayah. Every student of
 * the level gets the same target. A level with no target yet is pre-filled from last
 * Saturday's: the recent lesson takes last week's new lesson, the rest are copied.
 * Levels the caller does not lead are read-only (myRevisionTargetLevels; the server re-checks).
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { REVISION_CATEGORIES, formatRangeBn, rangeError, wholeJuzRange, type AyahRange } from "@scd/shared";
import {
  MY_REVISION_TARGET_LEVELS_QUERY,
  REVISION_TARGETS_QUERY,
  SET_REVISION_TARGET,
  type RevisionLevelTargetT,
  type RevisionTargetPortionT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Select, Notice, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { SurahAyahPicker, JUZ_OPTIONS } from "../../components/RevisionInputs";
import { STR, bnNum, hifzLevelLabel, revCategoryLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "RevisionTarget">;

interface DraftPart {
  on: boolean;
  fromSurah: string | null;
  fromAyah: string | null;
  toSurah: string | null;
  toAyah: string | null;
}

const str = (n: number | null | undefined): string | null => (n == null ? null : String(n));
const emptyPart = (): DraftPart => ({ on: true, fromSurah: null, fromAyah: null, toSurah: null, toAyah: null });
const fromTarget = (p: RevisionTargetPortionT | undefined): DraftPart =>
  p
    ? { on: true, fromSurah: str(p.fromSurah), fromAyah: str(p.fromAyah), toSurah: str(p.toSurah), toAyah: str(p.toAyah) }
    : emptyPart();

/** This week's saved target; else last week's (recent lesson ← last new lesson; the rest copied). */
function initialParts(row: RevisionLevelTargetT): { parts: Record<string, DraftPart>; prefilled: boolean } {
  const by = (list: RevisionTargetPortionT[] | undefined, c: string) => list?.find((p) => p.category === c);
  if (row.target) {
    const parts: Record<string, DraftPart> = {};
    for (const c of REVISION_CATEGORIES) {
      const p = by(row.target.portions, c);
      parts[c] = p ? fromTarget(p) : { ...emptyPart(), on: false };
    }
    return { parts, prefilled: false };
  }
  const prev = row.previous?.portions;
  return {
    parts: {
      SABAQ: emptyPart(),
      SABQI: fromTarget(by(prev, "SABAQ")),
      MANZIL: fromTarget(by(prev, "MANZIL")),
    },
    prefilled: !!prev && prev.length > 0,
  };
}

function partRange(d: DraftPart): AyahRange | null {
  if (!d.fromSurah || !d.fromAyah || !d.toSurah || !d.toAyah) return null;
  return { fromSurah: Number(d.fromSurah), fromAyah: Number(d.fromAyah), toSurah: Number(d.toSurah), toAyah: Number(d.toAyah) };
}

function LevelCard({
  row,
  date,
  canEdit,
  saved,
  onSaved,
}: {
  row: RevisionLevelTargetT;
  date: string;
  canEdit: boolean;
  /** Kept by the screen: the save refetches the targets and remounts this card. */
  saved: boolean;
  onSaved: (saved: boolean) => void;
}): React.ReactElement {
  const initial = useMemo(() => initialParts(row), [row]);
  const [parts, setParts] = useState<Record<string, DraftPart>>(initial.parts);
  const [error, setError] = useState<string | null>(null);
  const ok = saved ? STR.revTargetSaved : null;
  const setOk = (v: string | null) => onSaved(!!v);
  const [busy, setBusy] = useState(false);
  const [, save] = useMutation(SET_REVISION_TARGET);

  const patch = (c: string, p: Partial<DraftPart>) => {
    setOk(null);
    setParts((prev) => ({ ...prev, [c]: { ...prev[c], ...p } }));
  };

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    const portions = [];
    for (const c of REVISION_CATEGORIES) {
      const d = parts[c];
      if (!d?.on) continue;
      const r = partRange(d);
      if (!r) return setError(STR.revRangeIncomplete);
      const err = rangeError(r);
      if (err) return setError(err);
      portions.push({ category: c, ...r });
    }
    if (portions.length === 0) return setError(STR.revTargetNeedOne);
    setBusy(true);
    const res = await save({ level: row.level, date, portions });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.revTargetSaved);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{hifzLevelLabel(row.level)}</Body>
        <Muted>
          {bnNum(row.studentCount)} {STR.revTargetStudents}
        </Muted>
      </View>
      <Muted>{row.groupNames.join(" · ")}</Muted>
      {row.target?.setByName ? (
        <Muted>
          {STR.revTargetSetBy}: {row.target.setByName}
        </Muted>
      ) : null}
      {!canEdit ? <Notice message={STR.revTargetViewOnly} tone="info" /> : null}
      {initial.prefilled && canEdit ? <Muted style={{ marginTop: space(1) }}>{STR.revTargetHelp}</Muted> : null}

      {REVISION_CATEGORIES.map((c) => {
        const d = parts[c];
        const r = d ? partRange(d) : null;
        const err = r ? rangeError(r) : null;
        return (
          <View key={c} style={{ marginTop: space(3), paddingTop: space(2), borderTopWidth: 1, borderTopColor: "#0001" }}>
            <Body style={{ fontWeight: "700" }}>{revCategoryLabel(c)}</Body>
            {!d?.on ? (
              <>
                <Muted>{STR.revTargetNoPart}</Muted>
                {canEdit ? <Button title={STR.revTargetAddPart} variant="ghost" onPress={() => patch(c, emptyPart())} /> : null}
              </>
            ) : canEdit ? (
              <>
                <SurahAyahPicker
                  label={STR.revFrom}
                  surah={d.fromSurah}
                  ayah={d.fromAyah}
                  onChange={(s, a) => patch(c, { fromSurah: s, fromAyah: a })}
                />
                <SurahAyahPicker label={STR.revTo} surah={d.toSurah} ayah={d.toAyah} onChange={(s, a) => patch(c, { toSurah: s, toAyah: a })} />
                <Select
                  label={STR.revWholeJuz}
                  value={null}
                  options={JUZ_OPTIONS}
                  onChange={(v) => {
                    const w = wholeJuzRange(Number(v));
                    patch(c, { fromSurah: str(w.fromSurah), fromAyah: str(w.fromAyah), toSurah: str(w.toSurah), toAyah: str(w.toAyah) });
                  }}
                  placeholder={STR.revPickJuz}
                  searchable
                />
                {r && !err ? <Body style={{ fontWeight: "700", marginTop: space(1) }}>{formatRangeBn(r)}</Body> : null}
                {err ? <Notice message={err} tone="danger" /> : null}
                <Button title={STR.revTargetLeaveOut} variant="ghost" onPress={() => patch(c, { on: false })} />
              </>
            ) : (
              <Body>{r ? formatRangeBn(r) : "—"}</Body>
            )}
          </View>
        );
      })}

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {canEdit ? (
        <View style={{ marginTop: space(3) }}>
          <Button title={STR.revTargetSave} onPress={onSave} loading={busy} disabled={busy} />
        </View>
      ) : null}
    </Card>
  );
}

export default function RevisionTargetScreen({ route }: Props): React.ReactElement {
  const [date, setDate] = useState(route.params.date);
  const [savedLevels, setSavedLevels] = useState<Set<string>>(new Set());
  const [q, refetch] = useQuery({ query: REVISION_TARGETS_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const [levelsQ] = useQuery({ query: MY_REVISION_TARGET_LEVELS_QUERY });
  const mine = new Set(levelsQ.data?.myRevisionTargetLevels ?? []);
  const rows = q.data?.revisionTargets ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revTargetTitle}</Body>
          <DateField
            label={STR.revSaturdayDate}
            value={date}
            onChange={(d) => {
              setDate(d);
              setSavedLevels(new Set());
            }}
          />
          <Muted style={{ marginTop: space(1) }}>{STR.revTargetHelp}</Muted>
        </Card>
        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {rows.length === 0 ? (
            <EmptyState message={STR.revNoLevels} />
          ) : (
            rows.map((row) => (
              <LevelCard
                key={`${row.level}-${date}-${row.target?.updatedAt ?? ""}`}
                row={row}
                date={date}
                canEdit={mine.has(row.level)}
                saved={savedLevels.has(row.level)}
                onSaved={(v) =>
                  setSavedLevels((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(row.level);
                    else next.delete(row.level);
                    return next;
                  })
                }
              />
            ))
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
