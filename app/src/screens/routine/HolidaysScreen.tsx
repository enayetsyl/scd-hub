/**
 * HolidaysScreen — the admin face of `HolidayException` (D-#50): the ad-hoc closures
 * (Eid, a govt holiday, a special one-off) that OVERRIDE a day to no-school. On a
 * covered date no routine resolves, attendance is not expected, and no homework or
 * assignment chase goes out.
 *
 * The mutation has existed since R-1 but was wired to no screen, so the only way to
 * declare a holiday was a script against the database — which is how 2026-08-05 was
 * recorded. This is that missing screen. `routine:manage` (Principal/Office) only.
 *
 * Removing RETIRES rather than deletes: every read site filters `active: true`, so
 * the flag withdraws the holiday everywhere at once while the record of what was
 * declared, and later withdrawn, survives.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  HOLIDAYS_QUERY,
  CREATE_HOLIDAY,
  RETIRE_HOLIDAY,
  type HolidayT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Button, Badge, Field, Select, Notice, ErrorBanner } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, isoDateLabel, dhakaDateKey, holidayTypeLabel, holidayTypeOptions } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function HolidaysScreen(): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: HOLIDAYS_QUERY, requestPolicy: "cache-and-network" });
  const [createState, create] = useMutation(CREATE_HOLIDAY);
  const [retireState, retire] = useMutation(RETIRE_HOLIDAY);

  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [type, setType] = React.useState("govt");
  const [nameBn, setNameBn] = React.useState("");
  const [note, setNote] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const busy = createState.fetching || retireState.fetching;

  const onSave = async (): Promise<void> => {
    setSaved(false);
    // A single-day closure is the common case, so an empty to-date means "same day"
    // rather than an error — the server still receives an explicit range.
    const f = from.trim();
    const t = to.trim() || f;
    if (!ISO_DAY.test(f) || !ISO_DAY.test(t)) {
      setFormError(STR.hxBadDate);
      return;
    }
    if (f > t) {
      setFormError(STR.hxBadRange);
      return;
    }
    if (!nameBn.trim()) {
      setFormError(STR.hxNeedName);
      return;
    }
    setFormError(null);

    const res = await create({
      fromDate: f,
      toDate: t,
      type,
      nameBn: nameBn.trim(),
      note: note.trim() || null,
    });
    if (res.error) {
      setFormError(friendlyError(res.error));
      return;
    }
    setFrom("");
    setTo("");
    setNameBn("");
    setNote("");
    setSaved(true);
    refetch({ requestPolicy: "network-only" });
  };

  const onRemove = async (h: HolidayT): Promise<void> => {
    // House rule R-Confirm: a danger action confirms on its first line.
    if (!(await confirmAction({ title: h.nameBn, message: STR.hxRemoveConfirm, confirmLabel: STR.hxRemove })))
      return;
    const res = await retire({ id: h.id });
    if (!res.error) refetch({ requestPolicy: "network-only" });
  };

  // Split at TODAY, because the two lists answer different questions: what is coming
  // (worth checking, still withdrawable) versus what the calendar already spent.
  const today = dhakaDateKey();
  const live = (q.data?.holidays ?? []).filter((h) => h.active);
  const upcoming = live.filter((h) => h.toDate.slice(0, 10) >= today);
  const past = live.filter((h) => h.toDate.slice(0, 10) < today).reverse();

  const renderRow = (h: HolidayT): React.ReactElement => (
    <Card key={h.id}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>{h.nameBn}</Body>
          <Muted>
            {isoDateLabel(h.fromDate)}
            {h.toDate.slice(0, 10) !== h.fromDate.slice(0, 10) ? ` — ${isoDateLabel(h.toDate)}` : ""}
          </Muted>
          {h.note ? <Muted>{h.note}</Muted> : null}
        </View>
        <Badge text={holidayTypeLabel(h.type)} tone="brand" />
      </View>
      <View style={{ marginTop: space(2) }}>
        <Button title={STR.hxRemove} variant="danger" disabled={busy} onPress={() => void onRemove(h)} />
      </View>
    </Card>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Notice message={STR.hxEffect} tone="info" />

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hxAdd}</Body>
          <Field label={STR.hxFrom} value={from} onChangeText={setFrom} placeholder={STR.hxDateHint} />
          <Field
            label={STR.hxTo}
            value={to}
            onChangeText={setTo}
            placeholder={STR.hxDateHint}
            helper={STR.hxOneDayHint}
          />
          <Select label={STR.hxType} value={type} options={holidayTypeOptions()} onChange={setType} />
          <Field
            label={STR.hxName}
            value={nameBn}
            onChangeText={setNameBn}
            placeholder={STR.hxNamePlaceholder}
            autoCapitalize="sentences"
          />
          <Field label={STR.hxNote} value={note} onChangeText={setNote} autoCapitalize="sentences" />
          {formError ? <ErrorBanner message={formError} /> : null}
          {saved ? <Muted>{STR.hxSaved}</Muted> : null}
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.hxSave} onPress={() => void onSave()} loading={createState.fetching} disabled={busy} />
          </View>
        </Card>

        {retireState.error ? <ErrorBanner message={friendlyError(retireState.error)} /> : null}

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
          <Body style={{ fontWeight: "700" }}>{STR.hxUpcoming}</Body>
          {upcoming.length === 0 ? <Muted>{STR.hxNone}</Muted> : upcoming.map(renderRow)}

          {past.length > 0 ? (
            <>
              <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.hxPast}</Body>
              {past.map(renderRow)}
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
