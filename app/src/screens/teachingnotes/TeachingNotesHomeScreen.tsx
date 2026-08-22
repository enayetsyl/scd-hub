/**
 * TeachingNotesHomeScreen (TN-1, prd-teaching-notes) — the (class × subject)
 * note library. The class and subject pickers are driven by the caller's OWN
 * scope pairs, so a teacher only ever sees combinations they teach and the
 * subject list re-narrows when the class changes. Principal/Office get the full
 * grid. Notes group by kind; the upload entry is gated to roster:manage.
 *
 * This screen is registered FIRST in its stack — a param-requiring screen in
 * that position becomes the stack's initial route and crashes the tab at
 * runtime, which neither tsc nor `expo export` catches.
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import {
  TEACHING_NOTES,
  TEACHING_NOTE_MY_SCOPE,
  type TeachingNoteT,
} from "../../graphql/teachingNotes";
import type { TeachingNotesStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Select, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { teachingNoteKindLabel, TEACHING_NOTE_SUBJECT_ORDER } from "../../lib/teachingNotes";
import { STR, bnNum, classLevelLabel, routineSubjectLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TeachingNotesStackParamList, "TeachingNotesHome">;

export default function TeachingNotesHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canUpload = can("roster:manage");

  const [scopeQ, refetchScope] = useQuery({ query: TEACHING_NOTE_MY_SCOPE });
  const pairs = useMemo(
    () => scopeQ.data?.teachingNoteMyScope ?? [],
    [scopeQ.data?.teachingNoteMyScope],
  );

  const levels = useMemo(
    () => [...new Set(pairs.map((p) => p.classLevel))].sort((a, b) => a - b),
    [pairs],
  );

  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  // The subjects available FOR THE CHOSEN CLASS — not the caller's whole subject
  // set. Offering a subject they teach elsewhere would produce a picker that
  // returns a refusal.
  const subjects = useMemo(() => {
    if (classLevel === null) return [];
    const forClass = pairs.filter((p) => p.classLevel === classLevel).map((p) => p.subject);
    return [...new Set(forClass)].sort(
      (a, b) =>
        TEACHING_NOTE_SUBJECT_ORDER.indexOf(a as never) -
        TEACHING_NOTE_SUBJECT_ORDER.indexOf(b as never),
    );
  }, [pairs, classLevel]);

  React.useEffect(() => {
    if (classLevel === null && levels.length > 0) setClassLevel(levels[0]);
  }, [levels, classLevel]);

  // Keep the subject valid whenever the class changes.
  React.useEffect(() => {
    if (subjects.length === 0) {
      if (subject !== null) setSubject(null);
    } else if (subject === null || !subjects.includes(subject)) {
      setSubject(subjects[0]);
    }
  }, [subjects, subject]);

  const [notesQ, refetchNotes] = useQuery({
    query: TEACHING_NOTES,
    variables: { classLevel, subject },
    pause: classLevel === null || subject === null,
  });
  const notes = notesQ.data?.teachingNotes ?? [];

  const byKind = useMemo(() => {
    const map = new Map<string, TeachingNoteT[]>();
    for (const n of notes) {
      const list = map.get(n.kind) ?? [];
      list.push(n);
      map.set(n.kind, list);
    }
    return [...map.entries()];
  }, [notes]);

  const [openKind, setOpenKind] = useState<string | null>(null);
  const effectiveOpen = openKind ?? (byKind.length > 0 ? byKind[0][0] : null);

  const retry = (): void => {
    refetchScope({ requestPolicy: "network-only" });
    refetchNotes({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(scopeQ.fetching || notesQ.fetching, retry);

  // A fresh upload should be visible on return from the upload screen.
  useFocusEffect(
    React.useCallback(() => {
      if (classLevel !== null && subject !== null) {
        refetchNotes({ requestPolicy: "network-only" });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [classLevel, subject]),
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {canUpload ? (
          <View style={{ marginBottom: space(2) }}>
            <Button
              title={`⬆ ${STR.tnUpload}`}
              variant="secondary"
              onPress={() => navigation.navigate("TeachingNoteUpload", {})}
            />
          </View>
        ) : null}

        <QueryGate
          results={classLevel === null || subject === null ? [scopeQ] : [scopeQ, notesQ]}
          onRetry={retry}
          isEmpty={!scopeQ.fetching && pairs.length === 0}
          empty={<EmptyState message={STR.tnNoScope} />}
          loaderLabel={STR.loading}
        >
          {levels.length > 1 ? (
            <Select
              label={STR.tnPickClass}
              value={classLevel === null ? null : String(classLevel)}
              options={levels.map((l) => ({ label: classLevelLabel(l), value: String(l) }))}
              onChange={(v) => {
                setClassLevel(Number(v));
                setOpenKind(null);
              }}
            />
          ) : levels.length === 1 ? (
            <Muted style={{ marginBottom: space(2) }}>{classLevelLabel(levels[0])}</Muted>
          ) : null}

          {subjects.length > 1 ? (
            <Select
              label={STR.tnPickSubject}
              value={subject}
              options={subjects.map((s) => ({ label: routineSubjectLabel(s), value: s }))}
              onChange={(v) => {
                setSubject(v);
                setOpenKind(null);
              }}
            />
          ) : subjects.length === 1 ? (
            <Muted style={{ marginBottom: space(2) }}>{routineSubjectLabel(subjects[0])}</Muted>
          ) : null}

          {notes.length === 0 && !notesQ.fetching ? (
            <EmptyState message={STR.tnEmpty} />
          ) : (
            byKind.map(([kind, rows]) => {
              const isOpen = effectiveOpen === kind;
              return (
                <Card key={kind}>
                  <Pressable
                    onPress={() => setOpenKind(isOpen ? "" : kind)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Body style={{ fontWeight: "700" }}>
                      {isOpen ? "▾" : "▸"} {teachingNoteKindLabel(kind)}
                    </Body>
                    <Muted>({bnNum(rows.length)})</Muted>
                  </Pressable>
                  {isOpen
                    ? rows.map((r) => (
                        <Pressable
                          key={r.id}
                          onPress={() =>
                            navigation.navigate("TeachingNoteDoc", { noteId: r.id, title: r.title })
                          }
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            paddingVertical: space(2),
                          }}
                        >
                          <View style={{ flex: 1, marginRight: space(2) }}>
                            <Body style={{ fontWeight: "600" }}>{r.title}</Body>
                            <Muted>
                              {r.uploadedByName ?? "—"}
                              {rows.length > 1 ? ` · ${bnNum(r.seq)}` : ""}
                            </Muted>
                          </View>
                          <View
                            style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}
                          >
                            {r.openCommentCount > 0 ? (
                              <Badge text={`💬 ${bnNum(r.openCommentCount)}`} tone="warn" />
                            ) : r.commentCount > 0 ? (
                              <Badge text={`💬 ${bnNum(r.commentCount)}`} tone="muted" />
                            ) : null}
                            {(r.format ?? "MD") !== "MD" ? (
                              <Badge text={r.format} tone="info" />
                            ) : null}
                            <Badge text={`v${bnNum(r.version)}`} tone="muted" />
                          </View>
                        </Pressable>
                      ))
                    : null}
                </Card>
              );
            })
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
