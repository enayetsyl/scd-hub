/**
 * StaffMistakeSettingsScreen — ভুলের রেকর্ড: নিয়ম (D-#1005): the warning steps (how many
 * counted mistakes in how many days), what one mistake of each tier weighs, the time to
 * explain, and which places record mistakes at all. Reviewers read it; only
 * `staff_mistakes:settings` (the Principal by default) saves it.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { STAFF_MISTAKE_KINDS, STAFF_MISTAKE_DEADLINES } from "@scd/shared";
import { SET_STAFF_MISTAKE_SETTINGS, STAFF_MISTAKE_SETTINGS, type StaffMistakeSettingsT } from "../../graphql/staffMistakes";
import { Screen, H2, Body, Muted, Card, Button, Chip, ChipRow, Field, Loader, ErrorBanner } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { staffMistakeKindLabel, staffWarningStepLabel } from "../../lib/staffMistakeLabels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const str = (key: string): string => (STR as unknown as Record<string, string>)[key] ?? key;

/** Bangla or ASCII digits → number; NaN when not a number. */
function num(text: string): number {
  const ascii = text.trim().replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  return ascii === "" ? NaN : Number(ascii);
}

type Draft = {
  rungs: { step: string; count: string; windowDays: string }[];
  w1: string;
  w2: string;
  w3: string;
  deadline: string;
  disabled: string[];
};

const toDraft = (s: StaffMistakeSettingsT): Draft => ({
  rungs: s.rungs.map((r) => ({ step: r.step, count: String(r.count), windowDays: String(r.windowDays) })),
  w1: String(s.tier1Weight),
  w2: String(s.tier2Weight),
  w3: String(s.tier3Weight),
  deadline: s.deadline,
  disabled: s.disabledKinds,
});

export default function StaffMistakeSettingsScreen(): React.ReactElement {
  const { can } = useAuth();
  const canEdit = can("staff_mistakes:settings");
  const [q, refetch] = useQuery({ query: STAFF_MISTAKE_SETTINGS, requestPolicy: "cache-and-network" });
  const [save, doSave] = useMutation(SET_STAFF_MISTAKE_SETTINGS);
  const toast = useToast();
  const [d, setD] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    if (q.data?.staffMistakeSettings && !d) setD(toDraft(q.data.staffMistakeSettings));
  }, [q.data, d]);

  async function onSave(): Promise<void> {
    if (!d) return;
    const rungs = d.rungs.map((r) => ({ step: r.step, count: num(r.count), windowDays: num(r.windowDays) }));
    const weights = [num(d.w1), num(d.w2), num(d.w3)];
    if ([...rungs.flatMap((r) => [r.count, r.windowDays]), ...weights].some((n) => Number.isNaN(n))) {
      return toast.show(STR.smxBadNumber, "danger");
    }
    const res = await doSave({
      rungs,
      tier1Weight: weights[0]!,
      tier2Weight: weights[1]!,
      tier3Weight: weights[2]!,
      deadline: d.deadline,
      disabledKinds: d.disabled,
    });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    setD(toDraft(res.data!.setStaffMistakeSettings));
    toast.show(STR.smxSaved, "ok");
  }

  if (q.error) return <Screen><ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /></Screen>;
  if (!d) return <Screen><Loader label={STR.loading} /></Screen>;

  const setRung = (i: number, key: "count" | "windowDays", v: string) =>
    setD({ ...d, rungs: d.rungs.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });

  return (
    <Screen scroll>
      <H2>{STR.smxTitle}</H2>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.smxLadder}</Body>
        {d.rungs.map((r, i) => (
          <View key={r.step} style={{ marginTop: space(2) }}>
            <Body>{staffWarningStepLabel(r.step)}</Body>
            <View style={{ flexDirection: "row", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Field label={STR.smxCount} value={r.count} onChangeText={(v) => setRung(i, "count", v)} keyboardType="number-pad" editable={canEdit} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={STR.smxDays} value={r.windowDays} onChangeText={(v) => setRung(i, "windowDays", v)} keyboardType="number-pad" editable={canEdit} />
              </View>
            </View>
          </View>
        ))}
      </Card>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.smxWeights}</Body>
        <Field label={STR.smxTier1} value={d.w1} onChangeText={(v) => setD({ ...d, w1: v })} keyboardType="decimal-pad" editable={canEdit} />
        <Field label={STR.smxTier2} value={d.w2} onChangeText={(v) => setD({ ...d, w2: v })} keyboardType="decimal-pad" editable={canEdit} />
        <Field label={STR.smxTier3} value={d.w3} onChangeText={(v) => setD({ ...d, w3: v })} keyboardType="decimal-pad" editable={canEdit} />
      </Card>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.smxDeadline}</Body>
        <ChipRow>
          {STAFF_MISTAKE_DEADLINES.map((k) => (
            <Chip key={k} label={str(`smxDl_${k}`)} selected={d.deadline === k} onPress={() => canEdit && setD({ ...d, deadline: k })} />
          ))}
        </ChipRow>
      </Card>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.smxPlaces}</Body>
        <ChipRow>
          {STAFF_MISTAKE_KINDS.map((k) => {
            const on = !d.disabled.includes(k);
            return (
              <Chip
                key={k}
                label={staffMistakeKindLabel(k)}
                selected={on}
                onPress={() => canEdit && setD({ ...d, disabled: on ? [...d.disabled, k] : d.disabled.filter((x) => x !== k) })}
              />
            );
          })}
        </ChipRow>
      </Card>
      {canEdit ? <Button title={STR.smpSave} onPress={() => void onSave()} loading={save.fetching} /> : <Muted>{STR.smrCardSettingsHelp}</Muted>}
    </Screen>
  );
}
