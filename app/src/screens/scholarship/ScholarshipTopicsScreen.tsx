/**
 * ScholarshipTopicsScreen (SC-0) — the per-(subject, class) topic catalogue.
 *
 * Nothing can be declared before this list exists, so it is reachable on its own rather
 * than buried in the declare form. `axis` is picked per topic (D-#665): skill for
 * ENG/BAN, content (a chapter) for SCI/BGS — the picker says which so the analysis
 * heading can read দক্ষতা or অধ্যায় without branching on subject.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { SAVE_SCHOLARSHIP_TOPIC, SCHOLARSHIP_TOPICS_QUERY } from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  Badge,
  Button,
  Chip,
  ChipRow,
  Field,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipTopics">;

const SUBJECTS = ["ENG", "BAN", "MATH", "SCI", "BGS"] as const;

/** The subjects whose printed items are FORMATS rather than skills, so their topics are
 *  chapters (D-#665). Used only to pre-select the axis — the teacher can override. */
const CONTENT_SUBJECTS = new Set(["SCI", "BGS"]);

export default function ScholarshipTopicsScreen({ route }: Props): React.ReactElement {
  const { classLevel } = route.params;
  const toast = useToast();
  const [subject, setSubject] = useState<string>("ENG");
  const [label, setLabel] = useState("");
  const [chapters, setChapters] = useState("");
  const [axis, setAxis] = useState<"skill" | "content">("skill");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [{ data, fetching }, refetch] = useQuery({
    query: SCHOLARSHIP_TOPICS_QUERY,
    variables: { classLevel, subject },
  });
  const [, saveTopic] = useMutation(SAVE_SCHOLARSHIP_TOPIC);

  const topics = (data?.scholarshipTopics ?? []) as {
    code: string;
    labelBn: string;
    axis: string;
    chapters: number[];
  }[];

  function pickSubject(s: string): void {
    setSubject(s);
    setAxis(CONTENT_SUBJECTS.has(s) ? "content" : "skill");
  }

  async function onAdd(): Promise<void> {
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    const nums = chapters
      .split(/[,\s]+/)
      .map((c) => Number(c.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const res = await saveTopic({
      subject,
      classLevel,
      labelBn: label.trim(),
      axis,
      chapters: nums,
      order: topics.length + 1,
    });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setLabel("");
    setChapters("");
    toast.show(STR.scTopicSaved);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <ChipRow>
        {SUBJECTS.map((s) => (
          <Chip key={s} label={hwSubjectLabel(s)} selected={s === subject} onPress={() => pickSubject(s)} />
        ))}
      </ChipRow>

      {fetching ? <Loader /> : null}
      {!fetching && topics.length === 0 ? <EmptyState message={STR.scNoTopics} /> : null}

      {topics.map((t) => (
        <Card key={t.code}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
            <Body style={{ flexShrink: 1 }}>{t.labelBn}</Body>
            <Badge
              text={t.axis === "content" ? STR.scAxisChapter : STR.scAxisSkill}
              tone={t.axis === "content" ? "info" : "brand"}
            />
          </View>
          {t.chapters.length > 0 ? (
            <Muted>
              {STR.scChapterShort} {t.chapters.map((c) => bnNum(c)).join(", ")}
            </Muted>
          ) : null}
        </Card>
      ))}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.scAddTopic}</Body>
        <Field label={STR.scTopicLabel} value={label} onChangeText={setLabel} />
        <Field label={STR.scItemChapters} value={chapters} onChangeText={setChapters} keyboardType="number-pad" />
        <Muted>{STR.scTopicAxis}</Muted>
        <ChipRow>
          <Chip label={STR.scAxisSkill} selected={axis === "skill"} onPress={() => setAxis("skill")} />
          <Chip label={STR.scAxisChapter} selected={axis === "content"} onPress={() => setAxis("content")} />
        </ChipRow>
        {error ? <Notice message={error} tone="danger" /> : null}
        <Button title={STR.scAddTopic} onPress={() => void onAdd()} loading={busy} disabled={busy || !label.trim()} />
      </Card>
    </Screen>
  );
}
