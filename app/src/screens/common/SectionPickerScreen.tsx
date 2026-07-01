/**
 * SectionPickerScreen — sets the academic-year → class → section selection used
 * by the set/tracker journeys. The year comes from the `academicYears` picker
 * (auto-selects the current year — no pasted ids) and a teacher's own granted
 * sections (`myScopes` class/section ids, Slice-4 follow-up) surface as one-tap
 * shortcuts above the full class list. Registered in both the Sets and Trackers
 * stacks; navigates back on selection.
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { CLASSES_QUERY, MY_SCOPES_QUERY } from "../../graphql/operations";
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
import { STR, classLevelLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

export default function SectionPickerScreen(): React.ReactElement {
  const nav = useNavigation();
  const { selection, setAcademicYearId, setSection } = useSectionContext();
  const lang = getActiveLang();
  const ayId = selection.academicYearId;

  const [{ data, fetching, error }, refetch] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: ayId ?? "" },
    pause: !ayId,
  });

  const classes = data?.classes ?? [];

  // The caller's granted sections (teaching/proxy) → one-tap shortcuts.
  const [{ data: scopeData }] = useQuery({ query: MY_SCOPES_QUERY });
  const grantedSectionIds = new Set(
    (scopeData?.myScopes ?? []).filter((g) => g.sectionId).map((g) => g.sectionId as string),
  );
  const mySections = classes.flatMap((c) =>
    c.sections.filter((s) => grantedSectionIds.has(s.id)).map((s) => ({ cls: c, sec: s })),
  );

  function pick(c: (typeof classes)[number], s: (typeof classes)[number]["sections"][number]): void {
    setSection({
      classId: c.id,
      sectionId: s.id,
      classLevel: c.level,
      classNameBn: c.nameBn,
      sectionCode: s.code,
      sectionNameBn: s.nameBn,
    });
    nav.goBack();
  }

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
            <>
              {mySections.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.mySections}</Body>
                  <View style={{ marginTop: space(2) }}>
                    {mySections.map(({ cls, sec }) => {
                      const active = selection.sectionId === sec.id;
                      const classLabel = lang === "en" ? classLevelLabel(cls.level) : cls.nameBn;
                      const sectionLabel = lang === "en" ? sec.code : sec.nameBn;
                      return (
                        <Button
                          key={sec.id}
                          title={`${classLabel} · ${sectionLabel}${lang === "en" ? "" : ` (${sec.code})`}${active ? "  ✓" : ""}`}
                          variant={active ? "primary" : "secondary"}
                          style={{ marginBottom: space(2) }}
                          onPress={() => pick(cls, sec)}
                        />
                      );
                    })}
                  </View>
                </Card>
              ) : null}
              {classes.map((c) => (
                <Card key={c.id}>
                  <Body style={{ fontWeight: "700" }}>
                    {lang === "en" ? classLevelLabel(c.level) : c.nameBn}
                  </Body>
                  <View style={{ marginTop: space(2) }}>
                    {c.sections.map((s) => {
                      const active = selection.sectionId === s.id;
                      const sectionLabel = lang === "en" ? s.code : s.nameBn;
                      return (
                        <Button
                          key={s.id}
                          title={`${sectionLabel}${lang === "en" ? "" : ` (${s.code})`}${active ? "  ✓" : ""}`}
                          variant={active ? "primary" : "secondary"}
                          style={{ marginBottom: space(2) }}
                          onPress={() => pick(c, s)}
                        />
                      );
                    })}
                  </View>
                </Card>
              ))}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
