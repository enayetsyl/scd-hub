/**
 * The guardian's Teacher-comment and Saturday-revision rows — one rendering shared by
 * the Today cards and the two screens the guardian sidebar opens (D-#769). Moved
 * verbatim out of GuardianHomeScreen; the queries stay with each caller (Today also
 * reads the comments for its "new comment" alert).
 *
 * Comments: DELIVERED daily comments only (CM-6 / CM-5, J-CM8, D-#68); the
 * childComments query structurally omits authorUserId / sectionId / deliveryChannels.
 * Revision: DELIVERED Saturdays only (SR-4); childRevision omits teacherUserId /
 * deliveryChannels.
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted, Badge, Button } from "./ui";
import type { GuardianStudentCommentT } from "../graphql/comments";
import type { GuardianRevisionEntryT } from "../graphql/revision";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../lib/files";
import {
  STR,
  bnNum,
  commentTypeLabel,
  commentSentimentLabel,
  revCategoryLabel,
  isoDateLabel,
} from "../lib/labels";
import { space } from "../theme/tokens";

export function ChildCommentRows({
  rows,
  openingId,
  runOpen,
}: {
  rows: GuardianStudentCommentT[];
  openingId: string | null;
  runOpen: (id: string, fn: () => void | Promise<void>) => Promise<void>;
}): React.ReactElement {
  if (rows.length === 0) return <Muted style={{ marginTop: space(2) }}>{STR.gpNoComments}</Muted>;
  return (
    <>
      {rows.map((c) => (
        <View key={c.id} style={{ marginTop: space(2) }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Muted>
              {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)}
            </Muted>
            <Muted>{isoDateLabel(c.createdAt)}</Muted>
          </View>
          <Body style={{ marginTop: space(1) }}>{c.text}</Body>
          {c.attachmentIds.length > 0 && FILE_VIEW_SUPPORTED ? (
            <View style={{ marginTop: space(1) }}>
              {c.attachmentIds.map((fid) => (
                <Button
                  key={fid}
                  title={STR.cmOpenAttachment}
                  variant="ghost"
                  loading={openingId === fid}
                  disabled={!!openingId}
                  onPress={() => runOpen(fid, () => openStoredFile(fid).catch(() => {}))}
                />
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

export function ChildRevisionRows({ rows }: { rows: GuardianRevisionEntryT[] }): React.ReactElement {
  if (rows.length === 0) return <Muted style={{ marginTop: space(2) }}>{STR.gpNoRevision}</Muted>;
  return (
    <>
      {rows.map((e) => (
        <View key={e.id} style={{ marginTop: space(2) }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            {/* `date` arrives as a full ISO timestamp; printed raw it read
                "২০২৬-১০-১৭T০০:০০:০০.০০০Z". Same formatter as the comment rows. */}
            <Body style={{ fontWeight: "700" }}>{isoDateLabel(e.date)}</Body>
            <Badge text={e.present ? STR.revPresent : STR.revAbsent} tone={e.present ? "brand" : "muted"} />
          </View>
          {e.present
            ? e.juzRecords.map((r, i) => (
                <Muted key={i} style={{ marginTop: space(1) }}>
                  {revCategoryLabel(r.category)} · {STR.revJuz} {bnNum(r.juz)} · {bnNum(r.amountJuz)} · {STR.revTanbih}{" "}
                  {bnNum(r.tanbih)} · {STR.revFath} {bnNum(r.fath)} · {STR.revMistakes}{" "}
                  {bnNum(r.mistakes.harf + r.mistakes.ghunnah + r.mistakes.madd + r.mistakes.other)}
                </Muted>
              ))
            : null}
          {e.teacherComment ? (
            <Body style={{ marginTop: space(1) }}>
              {STR.revComment}: {e.teacherComment}
            </Body>
          ) : null}
        </View>
      ))}
    </>
  );
}
