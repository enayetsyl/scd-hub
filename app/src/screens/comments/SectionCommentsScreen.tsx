/**
 * SectionCommentsScreen (CM-6, tracker:read/write) — pick a section (year →
 * class/section), then list the section's students and its existing daily
 * comments (newest first). Tap a student → a new comment; tap an undelivered
 * comment → edit/deliver it. Delivered comments are sealed (read-only). The
 * reads ride tracker:read, the entry actions ride tracker:write — the Bangla
 * deny surfaces inline on the entry screen. Refetches on focus.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { STUDENTS_QUERY } from "../../graphql/operations";
import { SECTION_STUDENT_COMMENTS_QUERY } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Button, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect } from "../../components/selects";
import { STR, commentTypeLabel, commentSentimentLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function SectionCommentsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [yearId, setYearId] = useState("");
  const [section, setSection] = useState<SectionPick | null>(null);
  const sectionId = section?.sectionId ?? "";

  const [studentsQ, refetchStudents] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId }, pause: !sectionId });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of studentsQ.data?.studentsInSection ?? []) m.set(s.id, s.name);
    return m;
  }, [studentsQ.data]);

  const [commentsQ, refetchComments] = useQuery({
    query: SECTION_STUDENT_COMMENTS_QUERY,
    variables: { sectionId },
    pause: !sectionId,
  });
  // Newest first.
  const comments = useMemo(
    () =>
      [...(commentsQ.data?.sectionStudentComments ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [commentsQ.data],
  );

  useEffect(() => {
    const unsub = nav.addListener("focus", () => {
      if (sectionId) refetchComments({ requestPolicy: "network-only" });
    });
    return unsub;
  }, [nav, sectionId, refetchComments]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.cmPickSection}</Body>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
        </Card>

        {!section ? (
          <Card>
            <Muted>{STR.cmNoSection}</Muted>
          </Card>
        ) : (
          <QueryGate
            results={[studentsQ, commentsQ]}
            onRetry={() => {
              refetchStudents({ requestPolicy: "network-only" });
              refetchComments({ requestPolicy: "network-only" });
            }}
            loaderLabel={STR.loading}
          >
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.cmStudents}</Body>
              {students.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.cmNoStudents}</Muted>
              ) : (
                students.map((s) => (
                  <View
                    key={s.id}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(3) }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                      <Muted>{s.schoolId}</Muted>
                    </View>
                    <Button
                      title={STR.cmNewComment}
                      variant="secondary"
                      onPress={() =>
                        nav.navigate("CommentEntry", { sectionId, studentId: s.id, studentName: s.name })
                      }
                    />
                  </View>
                ))
              )}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.cmCommentsFor}</Body>
              {comments.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.cmNoComments}</Muted>
              ) : (
                comments.map((c) => {
                  const delivered = !!c.deliveredAt;
                  return (
                    <Card
                      key={c.id}
                      onPress={() =>
                        nav.navigate("CommentEntry", {
                          sectionId,
                          studentId: c.studentId,
                          studentName: nameById.get(c.studentId) ?? c.studentId,
                          commentId: c.id,
                        })
                      }
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexShrink: 1 }}>
                          <Body style={{ fontWeight: "700" }}>{nameById.get(c.studentId) ?? c.studentId}</Body>
                          <Muted>
                            {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)}
                          </Muted>
                        </View>
                        <Badge
                          text={delivered ? STR.cmDeliveredBadge : STR.cmDraftBadge}
                          tone={delivered ? "ok" : "muted"}
                        />
                      </View>
                      <Body style={{ marginTop: space(1) }}>{c.text}</Body>
                    </Card>
                  );
                })
              )}
            </Card>
          </QueryGate>
        )}
      </ScrollView>
    </Screen>
  );
}
