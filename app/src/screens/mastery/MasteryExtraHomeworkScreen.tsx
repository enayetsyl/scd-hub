/**
 * MasteryExtraHomeworkScreen (PR-D, D-#1322/#1323) — "দুর্বলদের বাড়তি বাড়ির কাজ" for one শাখা × subject.
 * The app proposes, per weak child, up to the policy's number of gold questions the child has not seen
 * (oldest weak row first), each with a one-line reason; children with nothing to give are listed with
 * the cause. The teacher unticks children or questions, then sends: one extra sheet (per-child items)
 * that appears in the normal sheet list with a badge. The server re-checks everything.
 */
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  CREATE_MASTERY_EXTRA_HOMEWORK,
  MASTERY_EXTRA_HOMEWORK_PREVIEW_QUERY,
  type MasteryExtraHomeworkStudent,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Loader, Notice, H2, EmptyState } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryExtraHomework">;

const todayDhaka = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

export default function MasteryExtraHomeworkScreen({ route, navigation }: Props): React.ReactElement {
  const { sectionId, subject } = route.params;
  const toast = useToast();
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_EXTRA_HOMEWORK_PREVIEW_QUERY,
    variables: { sectionId, subject },
    requestPolicy: "network-only",
  });
  const [send, createExtra] = useMutation(CREATE_MASTERY_EXTRA_HOMEWORK);
  // Unticked keys: "s:<studentId>" for a whole child, "q:<studentId>:<artifactId>" for one question.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const rows = (data?.masteryExtraHomeworkPreview ?? []) as MasteryExtraHomeworkStudent[];
  const toggle = (k: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const sheets = useMemo(
    () =>
      rows
        .filter((r) => r.items.length > 0 && !off.has(`s:${r.studentId}`))
        .map((r) => ({
          studentId: r.studentId,
          items: r.items.filter((i) => !off.has(`q:${r.studentId}:${i.artifactId}`)).map((i) => ({ artifactId: i.artifactId, loCode: i.loCode })),
        }))
        .filter((s) => s.items.length > 0),
    [rows, off],
  );

  async function onSend(): Promise<void> {
    setErr(null);
    const res = await createExtra({ sectionId, subject, date: todayDhaka(), sheets });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    toast.show(STR.msExtraSent, "ok");
    const paperId = res.data?.createMasteryExtraHomework?.paperId as string;
    navigation.replace("MasteryEntry", { paperId });
  }

  if (fetching && rows.length === 0) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen>
        <Notice message={friendlyError(error)} tone="danger" />
      </Screen>
    );
  }
  const given = rows.filter((r) => r.items.length > 0);
  const none = rows.filter((r) => r.items.length === 0);

  return (
    <Screen scroll>
      <H2>
        {STR.msExtraTitle} · {hwSubjectLabel(subject)}
      </H2>
      <Muted>{STR.msExtraIntro}</Muted>
      {given.length === 0 ? <EmptyState message={STR.msExtraNotWeak} /> : null}
      {given.map((r) => {
        const childOff = off.has(`s:${r.studentId}`);
        return (
          <Card key={r.studentId}>
            <Pressable onPress={() => toggle(`s:${r.studentId}`)} style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{childOff ? "☐" : "☑"}</Body>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                {r.rollNumber ? `${bnNum(r.rollNumber)}. ` : ""}
                {r.name}
              </Body>
            </Pressable>
            {r.items.map((i) => {
              const k = `q:${r.studentId}:${i.artifactId}`;
              const on = !childOff && !off.has(k);
              return (
                <Pressable key={k} onPress={() => toggle(k)} disabled={childOff} style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1) }}>
                  <Body>{on ? "☑" : "☐"}</Body>
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <Body>{i.textBn ?? i.qid}</Body>
                    <Muted>
                      {i.reasonBn} · {bnNum(i.marks)}
                    </Muted>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        );
      })}
      {none.length > 0 ? (
        <Card>
          {none.map((r) => (
            <View key={r.studentId} style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Body style={{ flexShrink: 1 }}>{r.name}</Body>
              <Badge text={r.cause === "NO_UNSEEN_QUESTION" ? STR.msExtraNoUnseen : STR.msExtraNotWeak} tone="muted" />
            </View>
          ))}
        </Card>
      ) : null}
      {err ? <Notice message={err} tone="danger" /> : null}
      <Button title={`${STR.msExtraSend} (${bnNum(sheets.length)})`} onPress={() => void onSend()} loading={send.fetching} disabled={sheets.length === 0} />
    </Screen>
  );
}
