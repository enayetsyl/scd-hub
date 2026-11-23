/**
 * AssignmentOfficeWeeksScreen (AL-8, journey C6) — the Office / Principal's view of every শাখা's weekly assignments
 * (drafts and finalised weeks) for one week, paged (D-#761). A row opens the draft review, where a comment can be left
 * (`assignment:comment`) — the subject teacher is told.
 */
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ASSIGNMENT_OFFICE_WEEKS_PAGE_QUERY, type AssignmentOfficeWeekRow } from "../../graphql/mastery";
import { Screen, Body, Muted, Badge, Field, Loader, Notice, EmptyState, H2 } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { STR, bnNum } from "../../lib/labels";
import { reviewWeekThursday } from "../../lib/asWeek";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "AssignmentOfficeWeeks">;

export default function AssignmentOfficeWeeksScreen({ navigation, route }: Props): React.ReactElement {
  const colors = useColors();
  const [dueDate, setDueDate] = useState(route.params?.dueDate ?? reviewWeekThursday());
  const [page, setPage] = useState(1);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSIGNMENT_OFFICE_WEEKS_PAGE_QUERY,
    variables: { dueDate, page, pageSize: 30 },
    pause: !dateOk,
    requestPolicy: "cache-and-network",
  });
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);
  const pg = data?.assignmentOfficeWeeksPage as { rows: AssignmentOfficeWeekRow[]; total: number; page: number; pageSize: number } | undefined;
  const rows = pg?.rows ?? [];

  return (
    <Screen scroll>
      <H2>{STR.al8OfficeTitle}</H2>
      <Muted>{STR.al8OfficeHint}</Muted>
      <Field
        label={STR.msAsDueDate}
        value={dueDate}
        onChangeText={(v) => {
          setDueDate(v);
          setPage(1);
        }}
      />
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && rows.length === 0 ? <Loader /> : null}
      {!fetching && !error && rows.length === 0 ? <EmptyState message={STR.al8OfficeEmpty} /> : null}
      {rows.map((r) => (
        <Pressable
          key={r.assignmentId}
          accessibilityRole="link"
          onPress={() => navigation.navigate("AssignmentDraftReview", { assignmentId: r.assignmentId, sectionId: r.sectionId, subject: r.subject })}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space(3), gap: space(1) }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>
              {r.sectionLabelBn} · {r.subjectBn}
            </Body>
            <Badge text={r.status === "SENT" ? STR.al8StateSent : STR.al8StateDraft} tone={r.status === "SENT" ? "ok" : "info"} />
          </View>
          <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
            {r.builtBy ? <Badge text={r.builtBy === "ENGINE" ? STR.al8BuiltEngine : STR.al8BuiltTeacher} tone="muted" /> : null}
            {r.edited ? <Badge text={STR.al8Edited} tone="warn" /> : null}
            {r.needsReviewCount > 0 ? <Badge text={fill(STR.al8NeedsReview, { n: bnNum(r.needsReviewCount) })} tone="gold" /> : null}
            {r.minutes !== null ? <Badge text={`${bnNum(r.minutes)} ${STR.asMinutes}`} tone="muted" /> : null}
            {r.commentCount > 0 ? <Badge text={fill(STR.al8CommentCount, { n: bnNum(r.commentCount) })} tone="info" /> : null}
          </View>
        </Pressable>
      ))}
      <Pager page={pg?.page ?? page} pageSize={pg?.pageSize ?? 30} total={pg?.total ?? 0} onPage={setPage} />
    </Screen>
  );
}
