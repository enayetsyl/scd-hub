/**
 * useTaughtSubjects (D-#306) — the subject CODES the signed-in user actively
 * teaches on a section: teaching grants plus subject-scoped proxy covers, from
 * `myScopes` mapped to codes via `subjects`. Returns `null` when the view
 * should not fold at all: no subject grants on the section (Principal/Office,
 * class-teacher-only, whole-section legacy proxy) or queries still loading.
 * Display default only, never an access decision — the server's
 * allowedSubjectCodesForSection already gates what the caller may see.
 */
import { useMemo } from "react";
import { useQuery } from "urql";
import { MY_SCOPES_QUERY, SUBJECTS_QUERY } from "../graphql/operations";

export function useTaughtSubjects(sectionId: string | null): Set<string> | null {
  const [{ data: scopeData }] = useQuery({ query: MY_SCOPES_QUERY, pause: !sectionId });
  const [{ data: subjectData }] = useQuery({ query: SUBJECTS_QUERY, pause: !sectionId });

  return useMemo(() => {
    if (!sectionId || !scopeData?.myScopes || !subjectData?.subjects) return null;
    const codeById = new Map(subjectData.subjects.map((s) => [s.id, s.code]));
    const codes = new Set<string>();
    for (const g of scopeData.myScopes) {
      if (!g.active || g.sectionId !== sectionId) continue;
      if (g.kind === "proxy" && !g.subjectId) return null; // pre-D-#257 whole-section cover
      if ((g.kind === "teaching" || g.kind === "proxy") && g.subjectId) {
        const code = codeById.get(g.subjectId);
        if (code) codes.add(code);
      }
    }
    return codes.size > 0 ? codes : null;
  }, [sectionId, scopeData, subjectData]);
}
