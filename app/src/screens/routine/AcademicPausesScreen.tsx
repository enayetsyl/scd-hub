/**
 * AcademicPausesScreen (D-#1655) — the Office/Principal face of `AcademicPause`: date
 * windows (an exam fortnight, a term break) on which chosen nudges stand down — new
 * assignments, assignment chasing, homework chasing, class-note reminders. Attendance,
 * the routine and the bells are untouched. `routine:edit_calendar`, like holidays.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  ACADEMIC_PAUSES_QUERY,
  CREATE_ACADEMIC_PAUSE,
  UPDATE_ACADEMIC_PAUSE,
  DELETE_ACADEMIC_PAUSE,
  type AcademicPauseT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Button, Field, Chip, ChipRow, Notice, ErrorBanner } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, bnNum, dhakaDateKey, pauseKindLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED", "CLASS_NOTE_CHASE"] as const;

export default function AcademicPausesScreen(): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: ACADEMIC_PAUSES_QUERY, requestPolicy: "cache-and-network" });
  const [createState, create] = useMutation(CREATE_ACADEMIC_PAUSE);
  const [updateState, update] = useMutation(UPDATE_ACADEMIC_PAUSE);
  const [deleteState, remove] = useMutation(DELETE_ACADEMIC_PAUSE);

  const [editId, setEditId] = React.useState<string | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [kinds, setKinds] = React.useState<string[]>([]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const busy = createState.fetching || updateState.fetching || deleteState.fetching;

  const reset = (): void => {
    setEditId(null);
    setFrom("");
    setTo("");
    setLabel("");
    setKinds([]);
  };

  const toggleKind = (k: string): void =>
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const onSave = async (): Promise<void> => {
    setSaved(false);
    const f = from.trim();
    const t = to.trim() || f; // one-day pause: leave "to" empty
    if (!ISO_DAY.test(f) || !ISO_DAY.test(t)) return setFormError(STR.hxBadDate);
    if (f > t) return setFormError(STR.hxBadRange);
    if (!label.trim()) return setFormError(STR.apNeedLabel);
    if (kinds.length === 0) return setFormError(STR.apNeedKind);
    setFormError(null);
    const vars = { fromKey: f, toKey: t, label: label.trim(), pauses: kinds };
    const res = editId ? await update({ id: editId, ...vars }) : await create(vars);
    if (res.error) {
      setFormError(friendlyError(res.error));
      return;
    }
    reset();
    setSaved(true);
    refetch({ requestPolicy: "network-only" });
  };

  const onEdit = (p: AcademicPauseT): void => {
    setEditId(p.id);
    setFrom(p.fromKey);
    setTo(p.toKey);
    setLabel(p.label);
    setKinds(p.pauses);
    setSaved(false);
    setFormError(null);
  };

  const onDelete = async (p: AcademicPauseT): Promise<void> => {
    if (!(await confirmAction({ title: p.label, message: STR.apDeleteConfirm, confirmLabel: STR.apDelete }))) return;
    const res = await remove({ id: p.id });
    if (!res.error) {
      if (editId === p.id) reset();
      refetch({ requestPolicy: "network-only" });
    }
  };

  const today = dhakaDateKey();
  const all = q.data?.academicPauses ?? [];
  const current = all.filter((p) => p.toKey >= today);
  const past = all.filter((p) => p.toKey < today).reverse();

  const renderRow = (p: AcademicPauseT): React.ReactElement => (
    <Card key={p.id}>
      <Body style={{ fontWeight: "700" }}>{p.label}</Body>
      <Muted>{p.fromKey === p.toKey ? bnNum(p.fromKey) : `${bnNum(p.fromKey)} — ${bnNum(p.toKey)}`}</Muted>
      {p.pauses.map((k) => (
        <Muted key={k}>{`• ${pauseKindLabel(k)}`}</Muted>
      ))}
      <View style={{ marginTop: space(2), gap: space(2) }}>
        <Button title={STR.apEdit} variant="secondary" disabled={busy} onPress={() => onEdit(p)} />
        <Button title={STR.apDelete} variant="danger" disabled={busy} onPress={() => void onDelete(p)} />
      </View>
    </Card>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Notice message={STR.apEffect} tone="info" />

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{editId ? STR.apEditing : STR.apAdd}</Body>
          <Field label={STR.hxFrom} value={from} onChangeText={setFrom} placeholder={STR.hxDateHint} />
          <Field
            label={STR.hxTo}
            value={to}
            onChangeText={setTo}
            placeholder={STR.hxDateHint}
            helper={STR.hxOneDayHint}
          />
          <Field
            label={STR.apLabel}
            value={label}
            onChangeText={setLabel}
            placeholder={STR.apLabelPh}
            autoCapitalize="sentences"
          />
          <Muted style={{ marginTop: space(2) }}>{STR.apWhat}</Muted>
          <ChipRow>
            {KINDS.map((k) => (
              <Chip key={k} label={pauseKindLabel(k)} selected={kinds.includes(k)} onPress={() => toggleKind(k)} />
            ))}
          </ChipRow>
          {formError ? <ErrorBanner message={formError} /> : null}
          {saved ? <Muted>{STR.apSaved}</Muted> : null}
          <View style={{ marginTop: space(2), gap: space(2) }}>
            <Button
              title={STR.apSave}
              onPress={() => void onSave()}
              loading={createState.fetching || updateState.fetching}
              disabled={busy}
            />
            {editId ? <Button title={STR.apCancelEdit} variant="ghost" onPress={reset} /> : null}
          </View>
        </Card>

        {deleteState.error ? <ErrorBanner message={friendlyError(deleteState.error)} /> : null}

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
          <Body style={{ fontWeight: "700" }}>{STR.apUpcoming}</Body>
          {current.length === 0 ? <Muted>{STR.apNone}</Muted> : current.map(renderRow)}
          {past.length > 0 ? (
            <>
              <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.apPast}</Body>
              {past.map(renderRow)}
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
