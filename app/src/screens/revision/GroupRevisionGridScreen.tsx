/**
 * GroupRevisionGridScreen (J-SR1, SR-1) — the Saturday grid for one Hifz group.
 * Per student row: a present/absent toggle, a per-juz record editor (add/remove
 * JuzRecords with category, juz no., amount, tanbih, fath, mistake counts, note),
 * and a teacher comment. Saves via recordRevisionEntry, or editRevisionEntry when
 * the row already has an entry. A row whose entry.deliveredAt is set is locked
 * read-only (the server re-enforces this; the lock is just UX). tracker:read writes
 * are re-gated + row-scoped server-side.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { REVISION_CATEGORIES } from "@scd/shared";
import {
  GROUP_REVISION_SATURDAY_QUERY,
  RECORD_REVISION_ENTRY,
  EDIT_REVISION_ENTRY,
  type RevisionGridRowT,
  type RevisionJuzRecordInput,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Field, Select, Chip, Badge, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, revCategoryLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "GroupRevisionGrid">;

/** A juz-record being edited locally — all numerics are strings (text inputs). */
interface DraftJuz {
  juz: string;
  category: string | null;
  amountJuz: string;
  tanbih: string;
  fath: string;
  harf: string;
  ghunnah: string;
  madd: string;
  other: string;
  note: string;
}

const emptyJuz = (): DraftJuz => ({
  juz: "",
  category: null,
  amountJuz: "",
  tanbih: "",
  fath: "",
  harf: "",
  ghunnah: "",
  madd: "",
  other: "",
  note: "",
});

/** Map a server entry's juzRecords into editable drafts. */
function toDrafts(row: RevisionGridRowT): DraftJuz[] {
  const recs = row.entry?.juzRecords ?? [];
  return recs.map((r) => ({
    juz: String(r.juz),
    category: r.category,
    amountJuz: String(r.amountJuz),
    tanbih: String(r.tanbih),
    fath: String(r.fath),
    harf: String(r.mistakes.harf),
    ghunnah: String(r.mistakes.ghunnah),
    madd: String(r.mistakes.madd),
    other: String(r.mistakes.other),
    note: r.note ?? "",
  }));
}

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

function draftToInput(d: DraftJuz): RevisionJuzRecordInput {
  return {
    juz: Number(d.juz),
    category: d.category ?? "",
    amountJuz: d.amountJuz.trim() === "" ? 0 : Number(d.amountJuz),
    tanbih: numOrNull(d.tanbih),
    fath: numOrNull(d.fath),
    mistakes: {
      harf: numOrNull(d.harf),
      ghunnah: numOrNull(d.ghunnah),
      madd: numOrNull(d.madd),
      other: numOrNull(d.other),
    },
    note: d.note.trim() || null,
  };
}

function StudentRow({
  row,
  groupId,
  date,
}: {
  row: RevisionGridRowT;
  groupId: string;
  date: string;
}): React.ReactElement {
  const locked = !!row.entry?.deliveredAt;
  const [present, setPresent] = useState<boolean>(row.entry?.present ?? true);
  const [juz, setJuz] = useState<DraftJuz[]>(toDrafts(row));
  const [comment, setComment] = useState<string>(row.entry?.teacherComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, record] = useMutation(RECORD_REVISION_ENTRY);
  const [, edit] = useMutation(EDIT_REVISION_ENTRY);

  function setJuzAt(i: number, patch: Partial<DraftJuz>): void {
    setJuz((prev) => prev.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  }

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    const records = present ? juz.filter((j) => j.juz.trim() && j.category).map(draftToInput) : [];
    setBusy(true);
    const res = row.entry
      ? await edit({
          entryId: row.entry.id,
          groupId,
          present,
          juzRecords: records,
          teacherComment: comment.trim() || null,
        })
      : await record({
          groupId,
          studentId: row.studentId,
          date,
          present,
          juzRecords: records,
          teacherComment: comment.trim() || null,
        });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.revSaved);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{row.studentName}</Body>
        {locked ? <Badge text={STR.revDelivered} tone="muted" /> : null}
      </View>

      {locked ? <Notice message={STR.revDelivered} tone="info" /> : null}

      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Chip label={STR.revPresent} selected={present} onPress={() => !locked && setPresent(true)} />
        <Chip label={STR.revAbsent} selected={!present} onPress={() => !locked && setPresent(false)} />
      </View>

      {present ? (
        <View style={{ marginTop: space(2) }}>
          <Body style={{ fontWeight: "700" }}>{STR.revJuzRecords}</Body>
          {juz.map((j, i) => (
            <View
              key={i}
              style={{ marginTop: space(2), paddingTop: space(2), borderTopWidth: 1, borderTopColor: "#0001" }}
            >
              <Select
                label={STR.revCategory}
                value={j.category}
                options={(REVISION_CATEGORIES as readonly string[]).map((c) => ({
                  label: revCategoryLabel(c),
                  value: c,
                }))}
                onChange={(v) => setJuzAt(i, { category: v })}
                placeholder={STR.revPickCategory}
              />
              <Field
                label={STR.revJuz}
                value={j.juz}
                onChangeText={(t) => setJuzAt(i, { juz: t })}
                keyboardType="number-pad"
                editable={!locked}
              />
              <Field
                label={STR.revAmountJuz}
                value={j.amountJuz}
                onChangeText={(t) => setJuzAt(i, { amountJuz: t })}
                keyboardType="decimal-pad"
                editable={!locked}
              />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revTanbih}
                    value={j.tanbih}
                    onChangeText={(t) => setJuzAt(i, { tanbih: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revFath}
                    value={j.fath}
                    onChangeText={(t) => setJuzAt(i, { fath: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
              </View>
              <Muted>{STR.revMistakes}</Muted>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revHarf}
                    value={j.harf}
                    onChangeText={(t) => setJuzAt(i, { harf: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revGhunnah}
                    value={j.ghunnah}
                    onChangeText={(t) => setJuzAt(i, { ghunnah: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revMadd}
                    value={j.madd}
                    onChangeText={(t) => setJuzAt(i, { madd: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={STR.revOther}
                    value={j.other}
                    onChangeText={(t) => setJuzAt(i, { other: t })}
                    keyboardType="number-pad"
                    editable={!locked}
                  />
                </View>
              </View>
              <Field
                label={STR.revNote}
                value={j.note}
                onChangeText={(t) => setJuzAt(i, { note: t })}
                editable={!locked}
              />
              {!locked ? (
                <Button
                  title={STR.revRemoveJuz}
                  variant="ghost"
                  onPress={() => setJuz((prev) => prev.filter((_, k) => k !== i))}
                />
              ) : null}
            </View>
          ))}
          {!locked ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.revAddJuz} variant="secondary" onPress={() => setJuz((prev) => [...prev, emptyJuz()])} />
            </View>
          ) : null}
        </View>
      ) : null}

      <Field
        label={STR.revComment}
        value={comment}
        onChangeText={setComment}
        multiline
        editable={!locked}
      />

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {!locked ? (
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.revSave} onPress={onSave} loading={busy} disabled={busy} />
        </View>
      ) : null}
    </Card>
  );
}

export default function GroupRevisionGridScreen({ route }: Props): React.ReactElement {
  const { groupId, date } = route.params;
  const [gridQ] = useQuery({ query: GROUP_REVISION_SATURDAY_QUERY, variables: { groupId, date } });
  const rows = useMemo(() => gridQ.data?.groupRevisionSaturday ?? [], [gridQ.data]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{route.params.nameBn}</Body>
          <Muted>
            {route.params.code} · {bnNum(date)}
          </Muted>
        </Card>
        {gridQ.fetching ? (
          <Loader label={STR.loading} />
        ) : gridQ.error ? (
          <Notice message={friendlyError(gridQ.error)} tone="danger" />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.revNoData} />
        ) : (
          rows.map((row) => <StudentRow key={row.studentId} row={row} groupId={groupId} date={date} />)
        )}
      </ScrollView>
    </Screen>
  );
}
