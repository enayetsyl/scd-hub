/**
 * RoutineHomeScreen (R-3) — routine landing. Anyone with `routine:read` can view
 * their own routine, a section's grid, or a Quran/Arabic group's grid; holders of
 * `routine:manage` (Principal/Office) also get the editor entry points.
 */
import React from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import { SUBJECT_GROUPS_QUERY } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Badge, Loader } from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, periodTrackLabel, getActiveLang } from "../../lib/labels";
import { useSectionContext } from "../../state/SectionContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<RoutineStackParamList, "RoutineHome">;

export default function RoutineHomeScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const { role, user } = useAuth();
  const lang = getActiveLang();
  const canManage = !!role && roleHasPermission(role, "routine:manage");
  const [groupsQ] = useQuery({ query: SUBJECT_GROUPS_QUERY, variables: { track: null } });
  const sectionLabel = lang === "en" ? selection.sectionCode ?? selection.sectionNameBn : selection.sectionNameBn;
  const routineTitle = sectionLabel ?? STR.rtSectionRoutine;

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
      </View>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Button title={STR.rtMyRoutine} onPress={() => navigation.navigate("MyRoutine")} />
        {user?.id ? (
          <Button
            title={STR.clMyLoad}
            variant="secondary"
            onPress={() =>
              navigation.navigate("TeacherClassLoadDetail", { teacherId: user.id, teacherName: user.name ?? undefined })
            }
          />
        ) : null}
        {canManage ? (
          <>
            <Button title={STR.rtMasterGrid} onPress={() => navigation.navigate("RoutineMaster")} />
            <Button title={STR.rtBellSchedule} variant="secondary" onPress={() => navigation.navigate("BellSchedule")} />
            <Button title={STR.rtNoteReportTitle} variant="secondary" onPress={() => navigation.navigate("ClassNoteReport")} />
            <Button title={STR.cnClassNotesAdmin} variant="secondary" onPress={() => navigation.navigate("ClassNotesAdmin")} />
          </>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.rtSectionRoutine}</Body>
          {hasSection && selection.sectionId ? (
            <View style={{ gap: space(2) }}>
              <Muted>{sectionLabel ?? selection.sectionId}</Muted>
              <Button
                title={STR.rtView}
                variant="secondary"
                onPress={() =>
                  navigation.navigate("GroupRoutine", {
                    groupType: "section",
                    groupId: selection.sectionId!,
                    title: routineTitle,
                  })
                }
              />
              <Button
                title={STR.rtClassNote}
                variant="secondary"
                onPress={() =>
                  navigation.navigate("DailyNote", {
                    groupType: "section",
                    groupId: selection.sectionId!,
                    title: routineTitle,
                  })
                }
              />
              {canManage ? (
                <>
                  <Button
                    title={STR.rtEdit}
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate("RoutineEditor", {
                        groupType: "section",
                        groupId: selection.sectionId!,
                        title: routineTitle,
                      })
                    }
                  />
                  <Button
                    title={STR.rtCover}
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate("CoverManage", {
                        groupType: "section",
                        groupId: selection.sectionId!,
                        title: routineTitle,
                      })
                    }
                  />
                </>
              ) : null}
            </View>
          ) : (
            <Muted>{STR.pickSection}</Muted>
          )}
        </Card>

        <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.rtSubjectGroups}</Body>
        {groupsQ.fetching ? <Loader /> : null}
        {groupsQ.data && groupsQ.data.subjectGroups.length === 0 ? <Muted>{STR.empty}</Muted> : null}
        {groupsQ.data?.subjectGroups.map((g) => (
          <Card key={g.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{g.nameBn}</Body>
                <Muted>
                  {periodTrackLabel(g.track)} · {g.level}
                </Muted>
              </View>
              <Badge text={g.code} tone="brand" />
            </View>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              <Button
                title={STR.rtView}
                variant="secondary"
                onPress={() => navigation.navigate("GroupRoutine", { groupType: "subjectgroup", groupId: g.id, title: g.nameBn })}
              />
              <Button
                title={STR.rtClassNote}
                variant="secondary"
                onPress={() => navigation.navigate("DailyNote", { groupType: "subjectgroup", groupId: g.id, title: g.nameBn })}
              />
              {canManage ? (
                <>
                  <Button
                    title={STR.rtEdit}
                    variant="secondary"
                    onPress={() => navigation.navigate("RoutineEditor", { groupType: "subjectgroup", groupId: g.id, title: g.nameBn })}
                  />
                  <Button
                    title={STR.rtCover}
                    variant="secondary"
                    onPress={() => navigation.navigate("CoverManage", { groupType: "subjectgroup", groupId: g.id, title: g.nameBn })}
                  />
                </>
              ) : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
