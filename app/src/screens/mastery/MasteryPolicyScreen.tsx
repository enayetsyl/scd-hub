/**
 * MasteryPolicyScreen (M-0, mock A3 right) — every threshold the engine and the assignment
 * builder use (D-#779/#780/#781), for the whole school or one class × subject override, and
 * the add-on switch per academic year × class × subject (D-#775).
 *
 * An override stores ONLY the fields changed here; everything else shows "from school" and
 * follows later school changes. The server validates on the resolved values, so a bad
 * combination is refused with a sentence saying which rule it broke.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  MASTERY_CYCLE_KEYS,
  MASTERY_CYCLE_QUERY,
  MASTERY_COVERAGE_QUERY,
  MASTERY_ENABLEMENTS_QUERY,
  MASTERY_POLICY_QUERY,
  SAVE_MASTERY_POLICY,
  SAVE_MASTERY_LEVEL_LABELS,
  SET_MASTERY_ENABLEMENT,
  type MasteryCoverageRow,
} from "../../graphql/mastery";
import type { MasteryLevelLabels } from "@scd/shared";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { ACADEMIC_YEARS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, H2 } from "../../components/ui";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR, hwSubjectLabel, masteryClassLabel, masteryPolicyLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryPolicy">;

type PolicyValues = Record<string, number | boolean>;

const LEVEL_ROWS = [
  { hint: () => STR.msLevelTop, bn: "domainBn", en: "domainEn" },
  { hint: () => STR.msLevelMiddle, bn: "objectiveBn", en: "objectiveEn" },
  { hint: () => STR.msLevelSmall, bn: "subBn", en: "subEn" },
] as const;

/**
 * Level names (D-#923) — ONE school setting; every screen, PDF and guardian message reads it
 * (app: useMasteryLevelLabels, server: masteryLevelLabels). Blank returns a name to its default.
 */
function LevelNamesCard({ canManage }: { canManage: boolean }): React.ReactElement {
  const toast = useToast();
  const levels = useMasteryLevelLabels();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [save, saveLabels] = useMutation(SAVE_MASTERY_LEVEL_LABELS);
  const value = (k: keyof MasteryLevelLabels): string => draft[k] ?? levels.raw[k];

  async function onSave(): Promise<void> {
    setErr(null);
    const res = await saveLabels(draft);
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setDraft({});
    levels.refetch();
    toast.show(STR.msLevelSaved);
  }

  return (
    <Card>
      <H2>{STR.msLevelNames}</H2>
      <Muted>{STR.msLevelNamesHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {LEVEL_ROWS.map((r) => (
        <View key={r.bn} style={{ gap: space(1), paddingVertical: space(1) }}>
          <Body style={{ fontWeight: "700" }}>{r.hint()}</Body>
          <Field
            label={STR.msLevelBangla}
            value={value(r.bn)}
            onChangeText={(t) => setDraft((d) => ({ ...d, [r.bn]: t }))}
            editable={canManage}
          />
          <Field
            label={STR.msLevelEnglish}
            value={value(r.en)}
            onChangeText={(t) => setDraft((d) => ({ ...d, [r.en]: t }))}
            editable={canManage}
          />
        </View>
      ))}
      {canManage ? (
        <Button title={STR.msSave} onPress={() => void onSave()} loading={save.fetching} disabled={Object.keys(draft).length === 0} />
      ) : null}
    </Card>
  );
}

/**
 * "সাপ্তাহিক চক্র" (AL-6b, PRD §3.5) — the school-wide 2027 keys (release switch, weekly cap, per-day hours, subjects
 * a week, minutes per mark, draft / marking / summary timing). School row only; a class × subject cannot override them.
 * The two homework-check keys are NOT here (they sit on the হোমওয়ার্ক যাচাই screen, AL-12).
 *
 * The existing save replaces the OLDER keys wholesale (the server keeps only the 2027 keys it is not sent), so this
 * card sends the school's current older values together with its own keys — saving here never resets them.
 */
function WeeklyCycleCard({ canManage, olderValues }: { canManage: boolean; olderValues: Record<string, number | boolean> }): React.ReactElement | null {
  const toast = useToast();
  // PRD §3.6: only the Principal turns the release switch on or off (the server refuses anyone else too).
  const { role } = useAuth();
  const canSwitch = canManage && role === "PRINCIPAL";
  const [{ data, fetching }, refetch] = useQuery({ query: MASTERY_CYCLE_QUERY, requestPolicy: "cache-and-network" });
  const resolved = data?.masteryPolicy?.resolved as Record<string, number | boolean> | undefined;
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [save, savePolicy] = useMutation(SAVE_MASTERY_POLICY);

  useEffect(() => {
    if (!resolved) return;
    const next: Record<string, string | boolean> = {};
    for (const k of MASTERY_CYCLE_KEYS) {
      const v = resolved[k];
      if (v !== undefined && v !== null) next[k] = typeof v === "boolean" ? v : String(v);
    }
    setDraft(next);
  }, [resolved]);

  if (!resolved) return fetching ? <Loader /> : null;
  const switchChanged = draft.academicLoop2027On !== undefined && draft.academicLoop2027On !== resolved.academicLoop2027On;

  async function doSave(): Promise<void> {
    setAsking(false);
    setErr(null);
    const values: Record<string, number | boolean> = { ...olderValues };
    for (const k of MASTERY_CYCLE_KEYS) {
      const v = draft[k];
      if (typeof v === "boolean") values[k] = v;
      else if (typeof v === "string") {
        const n = v.trim() === "" ? NaN : Number(v.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
        if (!Number.isFinite(n)) {
          setErr(`${masteryPolicyLabel(k)}: ${STR.al6FieldInvalid}`);
          return;
        }
        values[k] = n;
      }
    }
    const res = await savePolicy({ classToken: null, subject: null, values });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    toast.show(STR.al6PolicySaved);
    // The older keys went through unchanged, so the card above this one (and its unsaved edits) is left alone.
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <H2>{STR.al6PolicyCard}</H2>
      <Muted>{STR.al6PolicyHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {MASTERY_CYCLE_KEYS.map((k) => {
        const isBool = typeof resolved[k] === "boolean";
        return (
          <View key={k} style={{ gap: space(1), paddingVertical: space(1) }}>
            <Body>{masteryPolicyLabel(k)}</Body>
            {isBool ? (
              <ChipRow>
                <Chip label={STR.msActive} selected={draft[k] === true} onPress={() => (k === "academicLoop2027On" ? canSwitch : canManage) && setDraft((d) => ({ ...d, [k]: true }))} />
                <Chip label={STR.msInactive} selected={draft[k] === false} onPress={() => (k === "academicLoop2027On" ? canSwitch : canManage) && setDraft((d) => ({ ...d, [k]: false }))} />
              </ChipRow>
            ) : (
              <Field value={String(draft[k] ?? "")} onChangeText={(t) => setDraft((d) => ({ ...d, [k]: t }))} keyboardType="decimal-pad" editable={canManage} />
            )}
          </View>
        );
      })}
      {!canSwitch ? <Muted>{STR.al6SwitchPrincipalOnly}</Muted> : null}
      {canManage ? <Button title={STR.msSave} onPress={() => (switchChanged ? setAsking(true) : void doSave())} loading={save.fetching} /> : null}
      <ConfirmSheet visible={asking} message={STR.al6SwitchAsk} confirmLabel={STR.msSave} tone="primary" onCancel={() => setAsking(false)} onConfirm={() => void doSave()} />
    </Card>
  );
}

export default function MasteryPolicyScreen(_props: Props): React.ReactElement {
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("mastery:settings");
  const [scope, setScope] = useState<string>("SCHOOL");
  const [own, setOwn] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [yearId, setYearId] = useState<string | null>(null);

  const [classToken, subject] = scope === "SCHOOL" ? [null, null] : scope.split(":");
  const [{ data: cov }] = useQuery({ query: MASTERY_COVERAGE_QUERY });
  const pairs = (cov?.masteryCoverage ?? []) as MasteryCoverageRow[];
  const [{ data, fetching, error: qErr }, refetch] = useQuery({
    query: MASTERY_POLICY_QUERY,
    variables: { classToken, subject },
  });
  const [save, savePolicy] = useMutation(SAVE_MASTERY_POLICY);
  const policy = data?.masteryPolicy as { scopeKey: string; ownKeys: string[]; resolved: PolicyValues } | undefined;

  // Load this scope's own values into the editable state whenever the scope (or its row) changes.
  useEffect(() => {
    if (!policy) return;
    const next: Record<string, string | boolean> = {};
    const keys = scope === "SCHOOL" ? Object.keys(policy.resolved).filter((k) => k !== "__typename") : policy.ownKeys;
    for (const k of keys) {
      const v = policy.resolved[k];
      next[k] = typeof v === "boolean" ? v : String(v);
    }
    setOwn(next);
  }, [policy, scope]);

  const keys = useMemo(() => (policy ? Object.keys(policy.resolved).filter((k) => k !== "__typename") : []), [policy]);

  async function onSave(clear = false): Promise<void> {
    setError(null);
    // A stale read (the scope chip changed, the new scope has not loaded) must never be saved onto the wrong row.
    if (!policy || (scope === "SCHOOL") !== (policy.scopeKey === "SCHOOL")) return;
    const values: Record<string, number | boolean> = {};
    if (!clear) {
      for (const [k, v] of Object.entries(own)) {
        if (typeof v === "boolean") values[k] = v;
        else {
          const n = v.trim() === "" ? NaN : Number(v.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
          if (!Number.isFinite(n)) {
            setError(`${masteryPolicyLabel(k)}: ${STR.al6FieldInvalid}`);
            return;
          }
          values[k] = n;
        }
      }
    }
    const res = await savePolicy({ classToken, subject, values });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.msPolicySaved);
    refetch({ requestPolicy: "network-only" });
  }

  // --- the switch ---
  const [{ data: years }] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearList = (years?.academicYears ?? []) as { id: string; label: string; current: boolean }[];
  const activeYear = yearId ?? yearList.find((y) => y.current)?.id ?? yearList[0]?.id ?? null;
  const [{ data: en }, refetchEn] = useQuery({
    query: MASTERY_ENABLEMENTS_QUERY,
    variables: { academicYearId: activeYear ?? "" },
    pause: !activeYear,
  });
  const [toggle, setEnablement] = useMutation(SET_MASTERY_ENABLEMENT);
  const enabled = new Set(
    ((en?.masteryEnablements ?? []) as { classToken: string; subject: string; enabled: boolean }[])
      .filter((e) => e.enabled)
      .map((e) => `${e.classToken}:${e.subject}`),
  );

  async function onToggle(p: MasteryCoverageRow, on: boolean): Promise<void> {
    if (!activeYear) return;
    setError(null);
    const res = await setEnablement({ academicYearId: activeYear, classToken: p.classToken, subject: p.subject, enabled: on });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.msSaved);
    refetchEn({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.msPolicy}</H2>
      <ChipRow>
        <Chip label={STR.msSchool} selected={scope === "SCHOOL"} onPress={() => setScope("SCHOOL")} />
        {pairs.map((p) => {
          const k = `${p.classToken}:${p.subject}`;
          return (
            <Chip key={k} label={`${masteryClassLabel(p.classToken)} ${hwSubjectLabel(p.subject)}`} selected={scope === k} onPress={() => setScope(k)} />
          );
        })}
      </ChipRow>
      {scope !== "SCHOOL" ? <Muted>{STR.msOverride}</Muted> : null}
      {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {fetching && !policy ? <Loader /> : null}

      {policy ? (
        <Card>
          {keys.map((k) => {
            const resolved = policy.resolved[k];
            const isOwn = k in own;
            const isBool = typeof resolved === "boolean";
            return (
              <View key={k} style={{ gap: space(1), paddingVertical: space(1) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                  <Body style={{ flexShrink: 1 }}>{masteryPolicyLabel(k)}</Body>
                  {scope !== "SCHOOL" ? <Badge text={isOwn ? STR.msOwnValue : STR.msInherited} tone={isOwn ? "brand" : "muted"} /> : null}
                </View>
                {isBool ? (
                  <ChipRow>
                    <Chip
                      label={STR.msActive}
                      selected={(isOwn ? own[k] : resolved) === true}
                      onPress={() => canManage && setOwn((o) => ({ ...o, [k]: true }))}
                    />
                    <Chip
                      label={STR.msInactive}
                      selected={(isOwn ? own[k] : resolved) === false}
                      onPress={() => canManage && setOwn((o) => ({ ...o, [k]: false }))}
                    />
                  </ChipRow>
                ) : (
                  <Field
                    value={isOwn ? String(own[k]) : String(resolved)}
                    onChangeText={(t) => setOwn((o) => ({ ...o, [k]: t }))}
                    keyboardType="decimal-pad"
                    editable={canManage}
                  />
                )}
                {scope !== "SCHOOL" && isOwn && canManage ? (
                  <Button
                    title={STR.msInherited}
                    variant="ghost"
                    onPress={() =>
                      setOwn((o) => {
                        const n = { ...o };
                        delete n[k];
                        return n;
                      })
                    }
                  />
                ) : null}
              </View>
            );
          })}
          {canManage ? (
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button title={STR.msSave} onPress={() => void onSave()} loading={save.fetching} />
              {scope !== "SCHOOL" && policy.ownKeys.length > 0 ? (
                <Button title={STR.msClearOverride} variant="secondary" onPress={() => void onSave(true)} />
              ) : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      {scope === "SCHOOL" && policy?.scopeKey === "SCHOOL" ? (
        <WeeklyCycleCard
          canManage={canManage}
          olderValues={Object.fromEntries(Object.entries(policy.resolved).filter(([k, v]) => k !== "__typename" && (typeof v === "number" || typeof v === "boolean"))) as Record<string, number | boolean>}
        />
      ) : null}
      {scope === "SCHOOL" ? <LevelNamesCard canManage={canManage} /> : null}

      <H2>{STR.msSwitch}</H2>
      <Muted>{STR.msAcademicYear}</Muted>
      <ChipRow>
        {yearList.map((y) => (
          <Chip key={y.id} label={y.label} selected={y.id === activeYear} onPress={() => setYearId(y.id)} />
        ))}
      </ChipRow>
      {pairs.map((p) => {
        const k = `${p.classToken}:${p.subject}`;
        const on = enabled.has(k);
        return (
          <Card key={k}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700" }}>
                {masteryClassLabel(p.classToken)} · {hwSubjectLabel(p.subject)}
              </Body>
              <Badge text={on ? STR.msActive : STR.msInactive} tone={on ? "ok" : "muted"} />
            </View>
            {p.lockedCount === 0 ? <Muted>{STR.msSwitchNeedsLock}</Muted> : null}
            {canManage ? (
              <Button
                title={on ? STR.msInactive : STR.msActive}
                variant={on ? "secondary" : "primary"}
                onPress={() => void onToggle(p, !on)}
                disabled={!on && p.lockedCount === 0}
                loading={toggle.fetching}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
