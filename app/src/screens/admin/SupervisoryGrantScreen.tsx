/**
 * SupervisoryGrantScreen (D-#262) — grant / revoke a teacher's READ-OVERSIGHT
 * access at a configurable extent (ADR-017 / D-#17): whole_school, subject_dept
 * (one subject across all classes), grade_class (one class across all subjects),
 * or explicit_set (hand-picked class+subject pairs). Requires user:manage
 * (Principal). A supervisory grant is read-only — it lets the teacher SEE content
 * (lesson plans) + trackers at the chosen scope, never write them.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { Role } from "@scd/shared";
import {
  GRANT_SUPERVISORY,
  REVOKE_SUPERVISORY,
  SUPERVISORY_GRANTS_QUERY,
  CLASSES_QUERY,
  SUBJECTS_QUERY,
  TEACHERS_QUERY,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Button, Select, Notice, Divider, EmptyState, Loader } from "../../components/ui";
import { TeacherSelect, SubjectSelect, AcademicYearSelect } from "../../components/selects";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "SupervisoryGrant">;

type Extent = "whole_school" | "subject_dept" | "grade_class" | "explicit_set";
type Pair = { classId: string; subjectId: string };

export default function SupervisoryGrantScreen(_props: Props): React.ReactElement {
  const { user, can } = useAuth();
  const { confirmAction } = useConfirm();
  const canManage = !!user && can("user:manage");

  // Assign form
  const [teacherId, setTeacherId] = useState("");
  const [extent, setExtent] = useState<Extent | "">("");
  const [subjectId, setSubjectId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  // explicit_set pair builder
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairClassId, setPairClassId] = useState("");
  const [pairSubjectId, setPairSubjectId] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Revoke
  const [revokeId, setRevokeId] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);

  const [, grantSupervisory] = useMutation(GRANT_SUPERVISORY);
  const [, revokeSupervisory] = useMutation(REVOKE_SUPERVISORY);

  // Lookups for the grant list display
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY, pause: !canManage });
  const [{ data: subjectData }] = useQuery({ query: SUBJECTS_QUERY, pause: !canManage });
  const teacherById = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const subjectById = new Map((subjectData?.subjects ?? []).map((s) => [s.id, s.nameBn]));

  // Class options driven by the selected year (classes are year-scoped).
  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });
  const classes = classData?.classes ?? [];
  const classOptions = classes.map((c) => ({ label: c.nameBn, value: c.id }));
  const classById = new Map(classes.map((c) => [c.id, c.nameBn]));

  // Existing supervisory grants for the selected teacher (or all, if none picked).
  const [{ data: grantData, fetching: grantsFetching }, refetchGrants] = useQuery({
    query: SUPERVISORY_GRANTS_QUERY,
    variables: { teacherId: teacherId || null },
    pause: !canManage,
  });
  const grants = grantData?.supervisoryGrants ?? [];
  const reloadGrants = (): void => refetchGrants({ requestPolicy: "network-only" });

  const extentOptions = [
    { label: STR.sgWholeSchool, value: "whole_school" },
    { label: STR.sgSubjectDept, value: "subject_dept" },
    { label: STR.sgGradeClass, value: "grade_class" },
    { label: STR.sgExplicitSet, value: "explicit_set" },
  ];

  const teacherName = (id: string | null): string => (id ? teacherById.get(id) ?? id : "—");
  const subjectName = (id: string | null): string => (id ? subjectById.get(id) ?? id : "—");
  const className = (id: string | null): string => (id ? classById.get(id) ?? id : "—");

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

  async function removePair(i: number): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    setPairs((cur) => cur.filter((_, idx) => idx !== i));
  }

  /** Human label for a saved grant's extent + target. */
  function describe(g: (typeof grants)[number]): string {
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

  async function onGrant(): Promise<void> {
    if (!teacherId || !extent || busy) return;
    const vars: {
      teacherId: string;
      extent: string;
      subjectId?: string | null;
      classId?: string | null;
      explicitSet?: Pair[] | null;
    } = { teacherId, extent };
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
    const res = await grantSupervisory(vars);
    setBusy(false);
    if (res.error || !res.data?.grantSupervisory) {
      setErr(friendlyError(res.error));
      return;
    }
    setOk(STR.sgGranted);
    setExtent("");
    setSubjectId("");
    setClassId("");
    setPairs([]);
    reloadGrants();
  }

  async function onRevoke(grantId: string): Promise<void> {
    if (revokeBusy) return;
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    setRevokeId(grantId);
    setRevokeBusy(true);
    setOk(null);
    setErr(null);
    const res = await revokeSupervisory({ grantId });
    setRevokeBusy(false);
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setRevokeId("");
    setOk(STR.sgRemoved);
    reloadGrants();
  }

  const needsYearClass = extent === "grade_class" || extent === "explicit_set";

  return (
    <Screen scroll>
      <H2>{STR.sgManage}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.sgHint}</Muted>

      <Card>
        <TeacherSelect label={STR.stTeacher} value={teacherId} onChange={setTeacherId} />
        <Select
          label={STR.sgScope}
          value={extent === "" ? null : extent}
          options={extentOptions}
          onChange={(v) => setExtent(v as Extent)}
          placeholder={STR.sgPickExtent}
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
                <Button title={STR.remove} variant="danger" onPress={() => removePair(i)} />
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

        {err ? <Notice message={err} tone="danger" /> : null}
        {ok ? <Notice message={ok} tone="ok" /> : null}
        <Button
          title={busy ? STR.saving : STR.sgGrant}
          onPress={onGrant}
          loading={busy}
          disabled={busy || !teacherId || extent === ""}
          style={{ marginTop: space(2) }}
        />
      </Card>

      <Divider />

      <H2>{STR.sgCurrent}</H2>
      {grantsFetching ? (
        <Loader label={STR.loading} />
      ) : grants.length === 0 ? (
        <EmptyState message={STR.sgNone} />
      ) : (
        grants.map((g) => (
          <Card key={g.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{teacherName(g.teacherId)}</Body>
                <Muted>{describe(g)}</Muted>
              </View>
              <Button
                title={revokeBusy && revokeId === g.id ? STR.saving : STR.remove}
                variant="danger"
                loading={revokeBusy && revokeId === g.id}
                onPress={() => onRevoke(g.id)}
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
