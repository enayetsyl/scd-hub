/**
 * RosterScreen — read-only student roster for a picked section (Office/Principal,
 * roster:manage). Surfaces the operational fields loaded from the real roster
 * import (D-#31): Bangla/English name, ID, gender, DOB, phone, address, blood
 * group, and linked guardian contacts. Reuses the shared SectionContext picker.
 */
import React, { useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ROSTER_QUERY, type RosterStudentT } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Button,
  Field,
  Divider,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, classLevelLabel, genderLabel, relationLabel, bnNum } from "../../lib/labels";
import { getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useSectionContext } from "../../state/SectionContext";
import { space, useColors } from "../../theme";

type Nav = NativeStackNavigationProp<AdminStackParamList>;

/** ISO timestamp → DD/MM/YYYY in Bangla numerals. */
function formatDob(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return bnNum(`${d}/${m}/${y}`);
}

function StudentCard({ s }: { s: RosterStudentT }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{s.nameBn || s.name}</Body>
      {s.nameBn ? <Muted>{s.name}</Muted> : null}
      <Divider />
      <Row label={STR.studentId} value={s.schoolId} />
      <Row label={STR.gender} value={genderLabel(s.gender)} />
      <Row label={STR.dob} value={formatDob(s.dob)} />
      <Row label={STR.phone} value={s.phone ?? "—"} />
      <Row label={STR.bloodGroup} value={s.bloodGroup ?? "—"} />
      {s.address ? <Row label={STR.address} value={s.address} /> : null}
      <Divider />
      <Muted style={{ marginBottom: space(1) }}>{STR.guardians}</Muted>
      {s.guardians.length === 0 ? (
        <Muted>{STR.noGuardians}</Muted>
      ) : (
        s.guardians.map((g) => (
          <Row
            key={g.id}
            label={relationLabel(g.relation)}
            value={`${g.name}${g.phone ? ` · ${g.phone}` : ""}`}
          />
        ))
      )}
    </Card>
  );
}

export default function RosterScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { selection } = useSectionContext();
  const lang = getActiveLang();
  const sectionId = selection.sectionId;

  const [{ data, fetching, error }, refetch] = useQuery({
    query: ROSTER_QUERY,
    variables: { sectionId: sectionId ?? "" },
    pause: !sectionId,
  });

  const students = data?.studentsInSection ?? [];

  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = q
    ? students.filter(
        (s) =>
          (s.nameBn ?? "").toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.schoolId ?? "").toLowerCase().includes(q) ||
          (s.phone ?? "").toLowerCase().includes(q),
      )
    : students;

  // UX-7: FlatList (91 students × guardian rows is the app's densest screen)
  // + pull-to-refresh.
  const colors = useColors();
  const { refreshing, onRefresh } = usePullRefresh(fetching, () => refetch({ requestPolicy: "network-only" }));

  const header = (
    <>
      <H2>{STR.roster}</H2>

      {sectionId ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>
            {lang === "en" ? classLevelLabel(selection.classLevel ?? 0) : selection.classNameBn ?? classLevelLabel(selection.classLevel ?? 0)}
            {selection.sectionId
              ? ` · ${lang === "en" ? selection.sectionCode ?? selection.sectionNameBn : selection.sectionNameBn ?? ""}`
              : ""}
          </Body>
          <Muted>{`${bnNum(students.length)} ${STR.rosterCount}`}</Muted>
          <Button
            title={STR.changeSection}
            variant="secondary"
            style={{ marginTop: space(2) }}
            onPress={() => nav.navigate("SectionPicker")}
          />
        </Card>
      ) : (
        <>
          <Notice message={STR.noSectionSelected} tone="warn" />
          <Button title={STR.pickSection} onPress={() => nav.navigate("SectionPicker")} />
        </>
      )}

      {sectionId && !error && !fetching && students.length > 0 ? (
        <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.searchStudents} />
      ) : null}
    </>
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={sectionId && !error && !fetching ? shown : []}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space(4) }}
        refreshControl={
          sectionId ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          !sectionId ? null : error ? (
            <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
          ) : fetching ? (
            <Loader label={STR.loading} />
          ) : students.length === 0 ? (
            <EmptyState message={STR.empty} />
          ) : (
            <EmptyState message={STR.noMatches} />
          )
        }
        renderItem={({ item: s }) => <StudentCard s={s} />}
      />
    </Screen>
  );
}
