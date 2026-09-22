/**
 * ScholarshipHomeScreen (SC-1) — the practice papers of one section.
 *
 * Entry point for the whole module: pick the class/section and subject, see what has
 * been declared, and go on to score a paper or read the analysis. `classPercent` is
 * shown only once somebody is scored — a 0% on an unscored paper would read as a
 * disastrous result rather than an empty one.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SCHOLARSHIP_PAPERS_QUERY } from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  H2,
  Button,
  Badge,
  Chip,
  ChipRow,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import { useAccessibleClasses, type MyClass } from "../../components/ClassSectionDashboard";
import { SCHOLARSHIP_CLASS_LEVELS } from "@scd/shared";
import { STR, bnNum, classLevelLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ScholarshipStackParamList>;

const SUBJECTS = ["ENG", "BAN", "MATH", "SCI", "BGS"] as const;

function statusLabel(status: string): string {
  if (status === "DRAFT") return STR.scStatusDraft;
  if (status === "DECLARED") return STR.scStatusDeclared;
  if (status === "PUBLISHED") return STR.scStatusPublished;
  return STR.scStatusScored;
}

function statusTone(status: string): "muted" | "warn" | "ok" {
  if (status === "DRAFT") return "muted";
  if (status === "DECLARED") return "warn";
  return "ok";
}

export default function ScholarshipHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { can } = useAuth();
  const { myClasses, fetching: classesFetching } = useAccessibleClasses();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  // Flatten to the sections the caller can actually reach — the picker must never offer
  // a section whose reads the server will refuse — and then narrow to the classes this
  // module is FOR (D-#696). The scholarship exam is sat in class five; offering নার্সারি
  // through class four gave seven chips of which six led to an empty screen, and made
  // the one that works something you had to tap on every visit (it sorted first).
  const sections = useMemo(
    () =>
      myClasses
        .flatMap((c: MyClass) =>
          c.sections.map((s) => ({
            id: s.id,
            classLevel: c.cls.level,
            label: `${classLevelLabel(c.cls.level)} · ${s.nameBn ?? s.code}`,
          })),
        )
        .filter((s) => SCHOLARSHIP_CLASS_LEVELS.includes(s.classLevel)),
    [myClasses],
  );

  const active = sectionId ?? sections[0]?.id ?? null;
  const activeSection = sections.find((s) => s.id === active) ?? null;

  const [{ data, fetching, error }] = useQuery({
    query: SCHOLARSHIP_PAPERS_QUERY,
    variables: { sectionId: active ?? "", subject },
    pause: !active,
  });

  const papers = data?.scholarshipPapers ?? [];

  if (classesFetching) return <Screen><Loader /></Screen>;

  // Narrowing the picker created a state that could not happen before: a teacher with
  // no class-five section now has NOTHING to select, the papers query stays paused, and
  // the screen would render as a blank page with a subject row. Say why instead.
  if (sections.length === 0) {
    return (
      <Screen>
        <EmptyState message={STR.scClassFiveOnly} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {sections.length > 1 ? (
        <ChipRow>
          {sections.map((s) => (
            <Chip key={s.id} label={s.label} selected={s.id === active} onPress={() => setSectionId(s.id)} />
          ))}
        </ChipRow>
      ) : null}

      <ChipRow>
        {SUBJECTS.map((s) => (
          <Chip
            key={s}
            label={hwSubjectLabel(s)}
            selected={subject === s}
            onPress={() => setSubject(subject === s ? null : s)}
          />
        ))}
      </ChipRow>

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching ? <Loader /> : null}

      {!fetching && papers.length === 0 ? <EmptyState message={STR.scNoPapers} /> : null}

      {papers.map((p: Record<string, never>) => {
        const row = p as unknown as {
          id: string;
          paperId: string;
          name: string;
          subjects: string[];
          paperDate: string | null;
          totalMarks: number;
          itemCount: number;
          status: string;
          scoredCount: number;
          presentCount: number;
          classPercent: number | null;
        };
        return (
          <Card key={row.id} onPress={() => nav.navigate("ScholarshipMarks", { paperId: row.id, title: row.name })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
              <Body style={{ flexShrink: 1, fontWeight: "700" }}>{row.name}</Body>
              <Badge text={statusLabel(row.status)} tone={statusTone(row.status)} />
            </View>
            <Muted>
              {row.paperId} · {row.subjects.map(hwSubjectLabel).join(" + ")} ·{" "}
              {bnNum(row.totalMarks)} {STR.scItemMarks} · {bnNum(row.itemCount)} {STR.scItems}
            </Muted>
            <Muted>
              {bnNum(row.presentCount)} {STR.scRosterStudents}
              {row.classPercent !== null ? ` · ${STR.scClassAvg} ${bnNum(row.classPercent)}%` : ""}
            </Muted>
          </Card>
        );
      })}

      {activeSection ? (
        <View style={{ gap: space(3), marginTop: space(2) }}>
          <H2>{STR.scAnalysis}</H2>
          <Button
            title={STR.scClassAnalysis}
            variant="secondary"
            onPress={() =>
              nav.navigate("ScholarshipClass", {
                sectionId: activeSection.id,
                classLevel: activeSection.classLevel,
                subject: subject ?? undefined,
              })
            }
          />
          {can("scholarship:manage") ? (
            <>
              <Button
                title={STR.scNewPaper}
                onPress={() =>
                  nav.navigate("ScholarshipDeclare", {
                    sectionId: activeSection.id,
                    classLevel: activeSection.classLevel,
                  })
                }
              />
              <Button
                title={STR.scCandidates}
                variant="ghost"
                onPress={() => nav.navigate("ScholarshipCandidates", { sectionId: activeSection.id })}
              />
              <Button
                title={STR.scTopics}
                variant="ghost"
                onPress={() => nav.navigate("ScholarshipTopics", { classLevel: activeSection.classLevel })}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
