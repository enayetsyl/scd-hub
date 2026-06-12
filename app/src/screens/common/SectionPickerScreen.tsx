/**
 * SectionPickerScreen — sets the academic-year → class → section selection used
 * by the set/tracker journeys. The server exposes no `academicYears` query, so
 * the academicYearId is entered once (or seeded via EXPO_PUBLIC_DEFAULT_ACADEMIC_YEAR_ID)
 * and classes(academicYearId) drives class/section pick. Registered in both the
 * Sets and Trackers stacks; navigates back on selection.
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { CLASSES_QUERY } from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Card,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
  Divider,
} from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { STR, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

export default function SectionPickerScreen(): React.ReactElement {
  const nav = useNavigation();
  const { selection, setAcademicYearId, setSection } = useSectionContext();
  const ayId = selection.academicYearId;

  const [{ data, fetching, error }, refetch] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: ayId ?? "" },
    pause: !ayId,
  });

  const classes = data?.classes ?? [];

  return (
    <Screen scroll>
      <H2>{STR.pickSection}</H2>
      <AcademicYearSelect label={STR.academicYear} value={ayId ?? ""} onChange={setAcademicYearId} />

      {ayId ? (
        <>
          <Divider />
          {error ? (
            <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
          ) : null}
          {fetching ? (
            <Loader label={STR.loading} />
          ) : classes.length === 0 ? (
            <EmptyState message={STR.empty} />
          ) : (
            classes.map((c) => (
              <Card key={c.id}>
                <Body style={{ fontWeight: "700" }}>
                  {c.nameBn} · {classLevelLabel(c.level)}
                </Body>
                <View style={{ marginTop: space(2) }}>
                  {c.sections.map((s) => {
                    const active = selection.sectionId === s.id;
                    return (
                      <Button
                        key={s.id}
                        title={`${s.nameBn} (${s.code})${active ? "  ✓" : ""}`}
                        variant={active ? "primary" : "secondary"}
                        style={{ marginBottom: space(2) }}
                        onPress={() => {
                          setSection({
                            classId: c.id,
                            sectionId: s.id,
                            classLevel: c.level,
                            classNameBn: c.nameBn,
                            sectionNameBn: s.nameBn,
                          });
                          nav.goBack();
                        }}
                      />
                    );
                  })}
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
