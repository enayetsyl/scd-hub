/**
 * CommentReadBadge (D-#882) — on a sent comment: "অভিভাবক পড়েছেন · time" or "অভিভাবক এখনো
 * পড়েননি". Renders nothing for an unsent comment, one sent before the feature, or a viewer
 * without `student_comments:read_status` (the server returns readConfirmRequired=false to them).
 */
import React from "react";
import { Badge } from "./ui";
import { STR, isoDateTimeLabel } from "../lib/labels";

export function CommentReadBadge({
  c,
}: {
  c: { deliveredAt: string | null; readConfirmRequired: boolean; guardianReadAt: string | null };
}): React.ReactElement | null {
  if (!c.deliveredAt || !c.readConfirmRequired) return null;
  return c.guardianReadAt ? (
    <Badge text={STR.cmrReadAt.replace("{time}", isoDateTimeLabel(c.guardianReadAt))} tone="ok" />
  ) : (
    <Badge text={STR.cmrNotRead} tone="warn" />
  );
}
