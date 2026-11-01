/**
 * useWritableSubjects — the WRITE half of the workspace fold (owner report 2026-11-01).
 * useTaughtSubjects decides which subjects fold away (display); this decides whether a
 * folded card keeps its controls, from the server's own write gate. A teacher who also
 * holds a whole-school delegation or edit_all reach sees other subjects folded but
 * actionable, instead of "the subject teacher handles this" over work he may do.
 * Returns a predicate; false while loading or on error — the old read-only fold.
 */
import { useCallback } from "react";
import { useQuery } from "urql";
import { MY_WRITABLE_SUBJECTS_QUERY } from "../graphql/operations";

export function useWritableSubjects(
  sectionId: string | null,
  tracker: "HOMEWORK" | "ASSIGNMENT",
): (subject: string) => boolean {
  const [{ data }] = useQuery({
    query: MY_WRITABLE_SUBJECTS_QUERY,
    variables: { sectionId: sectionId ?? "", tracker },
    pause: !sectionId,
  });
  const list = data?.myWritableSubjects;
  return useCallback(
    (subject: string) => (data === undefined ? false : list === null || !!list?.includes(subject)),
    [data, list],
  );
}
