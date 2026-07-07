/**
 * SectionConfigScreen (D-#62) — the Principal/Office combine a class's gender-split
 * sections (Boys + Girls) into one combined section so the children sit as a single
 * class, and split them back later. Merging moves the students; splitting restores
 * them (originals to their old section, post-merge newcomers by gender). `roster:manage`.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  CLASSES_QUERY,
  ACTIVE_SECTION_MERGES_QUERY,
  MERGE_SECTIONS,
  SPLIT_SECTIONS,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Row, Notice, Loader, Divider } from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { STR, classLevelLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "SectionConfig">;

export default function SectionConfigScreen(_props: Props): React.ReactElement {
  const [yearId, setYearId] = useState("");
  const [combinedName, setCombinedName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);

  const [classesQ, refetchClasses] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });
  const [mergesQ, refetchMerges] = useQuery({ query: ACTIVE_SECTION_MERGES_QUERY });
  const [, mergeSections] = useMutation(MERGE_SECTIONS);
  const [, splitSections] = useMutation(SPLIT_SECTIONS);

  const classes = classesQ.data?.classes ?? [];
  const mergedClassIds = new Set((mergesQ.data?.activeSectionMerges ?? []).map((m) => m.classId));

  function refresh(): void {
    refetchClasses({ requestPolicy: "network-only" });
    refetchMerges({ requestPolicy: "network-only" });
  }

  async function doMerge(classId: string): Promise<void> {
    setBusy(classId);
    setMsg(null);
    const res = await mergeSections({ classId, combinedNameBn: combinedName.trim() || null });
    setBusy(null);
    if (res.error) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setMsg({ text: STR.scMergeDone, tone: "ok" });
    setCombinedName("");
    refresh();
  }

  async function doSplit(classId: string): Promise<void> {
    setBusy(classId);
    setMsg(null);
    const res = await splitSections({ classId });
    setBusy(null);
    if (res.error) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setMsg({ text: STR.scSplitDone, tone: "ok" });
    refresh();
  }

  return (
    <Screen scroll>
      <H2>{STR.sectionConfig}</H2>
      <Muted>{STR.sectionConfigHint}</Muted>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}

      <View style={{ marginTop: space(3) }}>
        <AcademicYearSelect label={STR.academicYear} value={yearId} onChange={setYearId} />
        <Field label={STR.scCombinedName} value={combinedName} onChangeText={setCombinedName} placeholder={STR.scCombinedNamePlaceholder} />
      </View>

      <Divider />

      {classesQ.fetching ? <Loader label={STR.loading} /> : null}
      {classes.map((c) => {
        const merged = mergedClassIds.has(c.id);
        const activeSections = c.sections.filter((s) => s.active);
        return (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {classLevelLabel(c.level)} · {c.nameBn}
              </Body>
              {merged ? <Badge text={STR.scMerged} tone="brand" /> : null}
            </View>

            {activeSections.map((s) => (
              <Row key={s.id} label={s.nameBn} value={`${bnNum(s.studentCount ?? 0)} ${STR.scStudents}`} />
            ))}

            <View style={{ marginTop: space(2) }}>
              {merged ? (
                <Button
                  title={STR.scSplitBtn}
                  variant="secondary"
                  onPress={() => doSplit(c.id)}
                  loading={busy === c.id}
                  disabled={busy !== null}
                />
              ) : activeSections.length >= 2 ? (
                <Button
                  title={STR.scMergeBtn}
                  onPress={() => doMerge(c.id)}
                  loading={busy === c.id}
                  disabled={busy !== null}
                />
              ) : (
                <Muted>{STR.scNeedsTwo}</Muted>
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
