/**
 * AssignClassTeacherScreen (D-#42) — Principal/Office assign (or clear) the CLASS
 * TEACHER for a section: the daily coordinator who runs homework reconciliation +
 * confirm-issue (handoff §9). `roster:manage`-gated. Pick a section, enter a
 * TEACHER user id, assign. Shows the section's current class teacher.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { CLASSES_QUERY, ASSIGN_CLASS_TEACHER } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Badge, Notice, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AssignClassTeacher">;

export default function AssignClassTeacherScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [teacherId, setTeacherId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [, assign] = useMutation(ASSIGN_CLASS_TEACHER);

  const [classesQ, refetchClasses] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: selection.academicYearId ?? "" },
    pause: !selection.academicYearId,
  });
  const section = classesQ.data?.classes
    .find((c) => c.id === selection.classId)
    ?.sections.find((s) => s.id === selection.sectionId);
  const currentCt = section?.classTeacherId ?? null;

  async function run(userId: string | null): Promise<void> {
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
    refetchClasses({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : (
          <>
            <Muted style={{ marginBottom: space(2) }}>{STR.ctHint}</Muted>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.ctCurrent}</Body>
                <Badge text={currentCt ? "✓" : STR.ctNone} tone={currentCt ? "ok" : "muted"} />
              </View>
              {currentCt ? <Muted style={{ marginTop: 4 }}>{currentCt}</Muted> : null}
            </Card>

            <Field label={STR.ctTeacherId} value={teacherId} onChangeText={setTeacherId} />
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button
                title={STR.ctAssign}
                onPress={() => run(teacherId.trim())}
                loading={busy}
                disabled={busy || teacherId.trim() === ""}
              />
              {currentCt ? (
                <Button title={STR.ctClear} variant="danger" onPress={() => run(null)} disabled={busy} />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
