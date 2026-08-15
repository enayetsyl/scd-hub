/**
 * DelegatedDutiesBlock (ACS-2 — D-#484..#489, docs/prd-access-control-scope.md §8).
 *
 * The EXTENT half of the per-user access editor. The permission list above it answers
 * "what may this person do"; this answers "and WHERE" — letting the Principal say
 * "you may do THIS ONE DUTY across a wider slice of the school than you teach".
 *
 * One screen for both axes on purpose: they compose, and a duty granted here does
 * nothing unless the person also holds the matching permission (tracker:write), which
 * is the list directly above. The note under the heading says so.
 *
 * Only `build` actions are offered — an untagged action would be a silent no-op the
 * Principal believes he granted (D-#486); the server refuses one anyway.
 *
 * Every op is `access:manage`-gated server-side (RESERVED, Principal-only).
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { DELEGATED_ACTIONS, isDelegatedActionActive, type DelegatedAction } from "@scd/shared";
import {
  DELEGATION_GRANTS_QUERY,
  GRANT_DELEGATION,
  REVOKE_DELEGATION,
  type DelegationGrantT,
} from "../../graphql/accessControl";
import { CLASSES_QUERY, SUBJECTS_QUERY } from "../../graphql/operations";
import {
  Body, Muted, Card, Chip, ChipRow, Button, Select, Notice, Divider, EmptyState, Loader,
} from "../../components/ui";
import { SubjectSelect, AcademicYearSelect } from "../../components/selects";
import { STR, delegatedActionName, delegatedActionDesc } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Extent = "whole_school" | "subject_dept" | "grade_class" | "explicit_set";
type Pair = { classId: string; subjectId: string };

/** The duties the Principal may actually hand out today (D-#486). */
const OFFERABLE: DelegatedAction[] = DELEGATED_ACTIONS.filter((a) => isDelegatedActionActive(a));

/** Expiry presets — open-ended is the default; the model takes any future instant. */
const EXPIRY_CHOICES: { key: string; label: string; months: number | null }[] = [
  { key: "never", label: STR.dgExpiryNever, months: null },
  { key: "1m", label: STR.dgExpiry1m, months: 1 },
  { key: "3m", label: STR.dgExpiry3m, months: 3 },
  { key: "6m", label: STR.dgExpiry6m, months: 6 },
];

function expiryIso(months: number | null): string | null {
  if (months === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export default function DelegatedDutiesBlock({ userId }: { userId: string }): React.ReactElement {
  const { confirmAction } = useConfirm();

  const [extent, setExtent] = useState<Extent | "">("");
  const [actions, setActions] = useState<DelegatedAction[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairClassId, setPairClassId] = useState("");
  const [pairSubjectId, setPairSubjectId] = useState("");
  const [expiryKey, setExpiryKey] = useState("never");

  const [busy, setBusy] = useState(false);
  const [revokeId, setRevokeId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [, grantDelegation] = useMutation(GRANT_DELEGATION);
  const [, revokeDelegation] = useMutation(REVOKE_DELEGATION);

  const [{ data: grantData, fetching }, refetchGrants] = useQuery({
    query: DELEGATION_GRANTS_QUERY,
    variables: { teacherId: userId },
  });
  const grants: DelegationGrantT[] = grantData?.delegationGrants ?? [];
  const reload = (): void => refetchGrants({ requestPolicy: "network-only" });

  const [{ data: subjectData }] = useQuery({ query: SUBJECTS_QUERY });
  const subjectById = new Map((subjectData?.subjects ?? []).map((s) => [s.id, s.nameBn]));

  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });
  const classes = classData?.classes ?? [];
  const classOptions = classes.map((c) => ({ label: c.nameBn, value: c.id }));
  const classById = new Map(classes.map((c) => [c.id, c.nameBn]));

  const subjectName = (id: string | null): string => (id ? subjectById.get(id) ?? id : "—");
  const className = (id: string | null): string => (id ? classById.get(id) ?? id : "—");

  const extentOptions = [
    { label: STR.sgWholeSchool, value: "whole_school" },
    { label: STR.sgSubjectDept, value: "subject_dept" },
    { label: STR.sgGradeClass, value: "grade_class" },
    { label: STR.sgExplicitSet, value: "explicit_set" },
  ];

  function toggleAction(a: DelegatedAction): void {
    setActions((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  }

  function onYear(v: string): void {
    setYearId(v);
    setClassId("");
    setPairClassId("");
  }

  function addPair(): void {
    if (!pairClassId || !pairSubjectId) return;
    if (pairs.some((p) => p.classId === pairClassId && p.subjectId === pairSubjectId)) return;
    setPairs([...pairs, { classId: pairClassId, subjectId: pairSubjectId }]);
    setPairSubjectId("");
  }

  /** Human label for a saved grant's extent + target (mirrors SupervisoryGrantScreen). */
  function describeExtent(g: DelegationGrantT): string {
    switch (g.extent) {
      case "whole_school":
        return STR.sgWholeSchool;
      case "subject_dept":
        return `${STR.sgSubjectDept}: ${subjectName(g.subjectId)}`;
      case "grade_class":
        return `${STR.sgGradeClass}: ${className(g.classId)}`;
      case "explicit_set":
        return `${STR.sgExplicitSet}: ${(g.explicitSet ?? [])
          .map((p) => `${className(p.classId)}·${subjectName(p.subjectId)}`)
          .join(", ")}`;
      default:
        return g.extent ?? "—";
    }
  }

  function resetForm(): void {
    setExtent("");
    setActions([]);
    setSubjectId("");
    setClassId("");
    setPairs([]);
    setExpiryKey("never");
  }

  async function onGrant(): Promise<void> {
    if (!extent || busy) return;
    if (actions.length === 0) {
      setErr(STR.dgPickActions);
      return;
    }
    const vars: Parameters<typeof grantDelegation>[0] = {
      teacherId: userId,
      extent,
      actions,
      expiresAt: expiryIso(EXPIRY_CHOICES.find((c) => c.key === expiryKey)?.months ?? null),
    };
    if (extent === "subject_dept") {
      if (!subjectId) {
        setErr(STR.sgSubjectDept);
        return;
      }
      vars.subjectId = subjectId;
    } else if (extent === "grade_class") {
      if (!classId) {
        setErr(STR.sgGradeClass);
        return;
      }
      vars.classId = classId;
    } else if (extent === "explicit_set") {
      if (pairs.length === 0) {
        setErr(STR.sgExplicitSet);
        return;
      }
      vars.explicitSet = pairs;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    const res = await grantDelegation(vars);
    setBusy(false);
    if (res.error || !res.data?.grantDelegation) {
      setErr(friendlyError(res.error));
      return;
    }
    setOk(STR.dgGranted);
    resetForm();
    reload();
  }

  async function onRevoke(grantId: string): Promise<void> {
    if (revokeId) return;
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    setRevokeId(grantId);
    setErr(null);
    setOk(null);
    const res = await revokeDelegation({ grantId });
    setRevokeId("");
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setOk(STR.dgRemoved);
    reload();
  }

  const needsYearClass = extent === "grade_class" || extent === "explicit_set";

  return (
    <View>
      <Divider />
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.dgTitle}</Body>
      <Muted>{STR.dgHint}</Muted>
      <Muted style={{ marginBottom: space(2) }}>{STR.dgNote}</Muted>

      {/* Current duties for this person */}
      <Body style={{ fontWeight: "700", marginTop: space(1) }}>{STR.dgCurrent}</Body>
      {fetching && grants.length === 0 ? (
        <Loader label={STR.loading} />
      ) : grants.length === 0 ? (
        <EmptyState message={STR.dgNone} />
      ) : (
        grants.map((g) => (
          <Card key={g.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>
                  {(g.actions ?? []).map((a) => delegatedActionName(a)).join(", ")}
                </Body>
                <Muted style={{ marginTop: 2 }}>{describeExtent(g)}</Muted>
                {g.expiresAt ? (
                  <Muted style={{ marginTop: 2 }}>
                    {STR.dgExpiresOn}: {new Date(g.expiresAt).toLocaleDateString()}
                  </Muted>
                ) : null}
              </View>
              <Button
                title={revokeId === g.id ? STR.saving : STR.remove}
                variant="danger"
                loading={revokeId === g.id}
                onPress={() => onRevoke(g.id)}
              />
            </View>
          </Card>
        ))
      )}

      {/* Delegate a new duty */}
      <Card style={{ marginTop: space(2) }}>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.dgAdd}</Body>

        <Muted style={{ marginTop: space(1) }}>{STR.dgActions}</Muted>
        <ChipRow>
          {OFFERABLE.map((a) => (
            <Chip
              key={a}
              label={delegatedActionName(a)}
              selected={actions.includes(a)}
              onPress={() => toggleAction(a)}
            />
          ))}
        </ChipRow>
        {actions.length === 1 ? (
          <Muted style={{ marginTop: space(1) }}>{delegatedActionDesc(actions[0])}</Muted>
        ) : null}

        <Select
          label={STR.dgScope}
          value={extent === "" ? null : extent}
          options={extentOptions}
          onChange={(v) => setExtent(v as Extent)}
          placeholder={STR.dgPickScope}
        />

        {extent === "subject_dept" ? (
          <SubjectSelect label={STR.stSubject} value={subjectId} onChange={setSubjectId} />
        ) : null}

        {needsYearClass ? <AcademicYearSelect label={STR.academicYear} value={yearId} onChange={onYear} /> : null}

        {extent === "grade_class" ? (
          <Select
            label={STR.class}
            value={classId === "" ? null : classId}
            options={classOptions}
            onChange={setClassId}
            placeholder={STR.selectClass}
          />
        ) : null}

        {extent === "explicit_set" ? (
          <View>
            <Muted style={{ fontWeight: "700", marginTop: space(2) }}>{STR.sgPairs}</Muted>
            {pairs.map((p, i) => (
              <View
                key={`${p.classId}-${p.subjectId}`}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(1) }}
              >
                <Body>
                  {className(p.classId)} · {subjectName(p.subjectId)}
                </Body>
                <Button
                  title={STR.remove}
                  variant="danger"
                  onPress={() => setPairs((cur) => cur.filter((_, idx) => idx !== i))}
                />
              </View>
            ))}
            <Select
              label={STR.class}
              value={pairClassId === "" ? null : pairClassId}
              options={classOptions}
              onChange={setPairClassId}
              placeholder={STR.selectClass}
            />
            <SubjectSelect label={STR.stSubject} value={pairSubjectId} onChange={setPairSubjectId} />
            <Button
              title={STR.sgAddPair}
              variant="secondary"
              onPress={addPair}
              disabled={!pairClassId || !pairSubjectId}
              style={{ marginTop: space(1) }}
            />
          </View>
        ) : null}

        <Muted style={{ marginTop: space(2) }}>{STR.dgExpiry}</Muted>
        <ChipRow>
          {EXPIRY_CHOICES.map((c) => (
            <Chip key={c.key} label={c.label} selected={expiryKey === c.key} onPress={() => setExpiryKey(c.key)} />
          ))}
        </ChipRow>

        {err ? <Notice message={err} tone="danger" /> : null}
        {ok ? <Notice message={ok} tone="ok" /> : null}
        <Button
          title={busy ? STR.saving : STR.dgGrant}
          onPress={onGrant}
          loading={busy}
          disabled={busy || extent === "" || actions.length === 0}
          style={{ marginTop: space(2) }}
        />
      </Card>
    </View>
  );
}
