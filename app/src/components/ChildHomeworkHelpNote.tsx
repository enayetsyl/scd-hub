/**
 * ChildHomeworkHelpNote (AL-12, AC-H4, R16 + R32, D-#1676) - the guardian's GENTLE note on the homework screen: after the
 * school looked into a case and the outcome was "the guardian did it", the subject shows "বাড়ির কাজ শিশুকে নিজে করতে
 * দিন" until the end of that term. The answer carries a subject code only - no case, no number, no objective - and an
 * unclear or child-did outcome never produces it. Own query, outside the screen's gate; a failed read shows nothing.
 */
import React from "react";
import { useQuery } from "urql";
import { CHILD_HOMEWORK_HELP_NOTES, type HomeworkHelpNoteT } from "../graphql/homeworkIntegrity";
import { Notice } from "./ui";
import { STR, subjectLabel } from "../lib/labels";

export function ChildHomeworkHelpNote({ studentId }: { studentId: string }): React.ReactElement | null {
  const [q] = useQuery({ query: CHILD_HOMEWORK_HELP_NOTES, variables: { studentId }, pause: !studentId });
  const rows = (q.data?.childHomeworkHelpNotes ?? []) as HomeworkHelpNoteT[];
  if (rows.length === 0) return null;
  return <Notice message={`${STR.hiGuardianNote} — ${rows.map((r) => subjectLabel(r.subject)).join(", ")}`} tone="info" />;
}
