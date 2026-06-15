/**
 * AssignClassTeacherScreen (D-#42, CT-1) — Principal/Office manage a section's
 * daily-coordinator (CLASS TEACHER) + its SUPPORT teachers, with an overview of all
 * sections (unassigned flagged + per-teacher load) and the append-only assignment
 * history. `roster:manage`.
 */
import React, { useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  CLASSES_QUERY,
  ASSIGN_CLASS_TEACHER,
  SET_SUPPORT_TEACHER,
  CLASS_TEACHER_HISTORY_QUERY,
  TEACHERS_QUERY,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Badge, Notice, EmptyState } from "../../components/ui";
import { TeacherSelect } from "../../components/selects";
import { SectionBar } from "../../components/SectionBar";
import { STR, classLevelLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AssignClassTeacher">;

export default function AssignClassTeacherScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection, setSection } = useSectionContext();
  const [teacherId, setTeacherId] = useState("");
  const [supportId, setSupportId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [, assign] = useMutation(ASSIGN_CLASS_TEACHER);
  const [, setSupport] = useMutation(SET_SUPPORT_TEACHER);

  const [classesQ, refetchClasses] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: selection.academicYearId ?? "" },
    pause: !selection.academicYearId,
  });
  const [historyQ, refetchHistory] = useQuery({
    query: CLASS_TEACHER_HISTORY_QUERY,
    variables: { sectionId: selection.sectionId ?? "" },
    pause: !selection.sectionId,
  });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const nameOf = (id: string): string => teacherName.get(id) ?? id;

  const classes = classesQ.data?.classes ?? [];
  const section = classes.find((c) => c.id === selection.classId)?.sections.find((s) => s.id === selection.sectionId);
  const currentCt = section?.classTeacherId ?? null;
  const support = section?.supportTeacherIds ?? [];

  // Per-teacher class-teacher load (CT1.4 — over-loading visible).
  const ctCount = new Map<string, number>();
  for (const c of classes) for (const s of c.sections) if (s.classTeacherId) ctCount.set(s.classTeacherId, (ctCount.get(s.classTeacherId) ?? 0) + 1);

  function refresh(): void {
    refetchClasses({ requestPolicy: "network-only" });
    refetchHistory({ requestPolicy: "network-only" });
  }

  async function runAssign(userId: string | null): Promise<void> {
    if (!selection.sectionId) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await assign({ sectionId: selection.sectionId, userId });
    setBusy(false);
    if (res.error || !res.data?.assignClassTeacher) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(userId ? STR.ctAssigned : STR.ctCleared);
    setTeacherId("");
    refresh();
  }

  async function runSupport(userId: string, add: boolean): Promise<void> {
    if (!selection.sectionId || userId.trim() === "") return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await setSupport({ sectionId: selection.sectionId, userId: userId.trim(), add });
    setBusy(false);
    if (res.error || !res.data?.setSupportTeacher) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(add ? STR.ctSupportAdded : STR.ctSupportRemoved);
    setSupportId("");
    refresh();
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {/* Overview of all sections (CT1.3/CT1.4) — tap a row to manage that section. */}
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.ctOverview}</Body>
        <Muted style={{ marginBottom: space(2) }}>{STR.ctTapToManage}</Muted>
        {classes.map((c) => (
          <Card key={c.id}>
            <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{classLevelLabel(c.level)}</Muted>
            {c.sections.map((s) => {
              const n = s.classTeacherId ? ctCount.get(s.classTeacherId) ?? 1 : 0;
              const active = selection.sectionId === s.id;
              const supportIds = s.supportTeacherIds ?? [];
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSection({ classId: c.id, sectionId: s.id, classLevel: c.level, classNameBn: c.nameBn, sectionNameBn: s.nameBn })}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: space(1), gap: space(2) }}
                >
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: active ? "700" : "400" }}>
                      {s.nameBn}
                      {active ? "  ✓" : ""}
                    </Body>
                    {s.classTeacherId ? (
                      <Muted>{nameOf(s.classTeacherId)}{n > 1 ? ` · ${bnNum(n)} ${STR.ctSections}` : ""}</Muted>
                    ) : (
                      <Muted>{STR.ctUnassigned}</Muted>
                    )}
                    {supportIds.length > 0 ? (
                      <Muted>{STR.ctSupport}: {supportIds.map(nameOf).join(", ")}</Muted>
                    ) : null}
                  </View>
                  {s.classTeacherId ? (
                    <Badge text={n > 1 ? `${bnNum(n)} ${STR.ctSections}` : "✓"} tone={n > 1 ? "warn" : "ok"} />
                  ) : (
                    <Badge text={STR.ctUnassigned} tone="muted" />
                  )}
                </Pressable>
              );
            })}
          </Card>
        ))}

        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : (
          <>
            <Muted style={{ marginTop: space(3), marginBottom: space(2) }}>{STR.ctHint}</Muted>

            {/* Class teacher (CT1.1) */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.ctCurrent}</Body>
                <Badge text={currentCt ? "✓" : STR.ctNone} tone={currentCt ? "ok" : "muted"} />
              </View>
              {currentCt ? <Muted style={{ marginTop: 4 }}>{nameOf(currentCt)}</Muted> : null}
            </Card>
            <TeacherSelect label={STR.ctTeacherId} value={teacherId} onChange={setTeacherId} />
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button title={STR.ctAssign} onPress={() => runAssign(teacherId.trim())} loading={busy} disabled={busy || teacherId.trim() === ""} />
              {currentCt ? <Button title={STR.ctClear} variant="danger" onPress={() => runAssign(null)} disabled={busy} /> : null}
            </View>

            {/* Support teachers (CT1.5) */}
            <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.ctSupport}</Body>
            {support.length === 0 ? <Muted>{STR.ctNone}</Muted> : null}
            {support.map((id) => (
              <Card key={id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Muted style={{ flex: 1 }}>{nameOf(id)}</Muted>
                  <Button title={STR.remove} variant="danger" onPress={() => runSupport(id, false)} disabled={busy} />
                </View>
              </Card>
            ))}
            <TeacherSelect label={STR.ctSupportId} value={supportId} onChange={setSupportId} />
            <Button title={STR.ctSupportAdd} variant="secondary" onPress={() => runSupport(supportId, true)} disabled={busy || supportId.trim() === ""} style={{ marginTop: space(2) }} />

            {/* History (CT1.6) */}
            <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.ctHistory}</Body>
            {(historyQ.data?.classTeacherHistory ?? []).length === 0 ? <Muted>{STR.ctNoHistory}</Muted> : null}
            {(historyQ.data?.classTeacherHistory ?? []).map((h) => (
              <Card key={h.id}>
                <Body style={{ fontWeight: "700" }}>
                  {h.role} · {h.op}
                </Body>
                <Muted>
                  {h.teacherId ? nameOf(h.teacherId) : "—"} · {new Date(h.at).toLocaleString()}
                </Muted>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
