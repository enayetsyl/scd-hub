/**
 * useSectionNames (D-#722) — a section id → its Bangla name, for labels that would
 * otherwise read only "শ্রেণি ৪". Since C4/C5 split into বালক/বালিকা (2026-10-01) a
 * teacher with Science in both halves saw two identical class-test cards.
 *
 * Read from the current year's CLASSES_QUERY (already cached by most screens) rather
 * than a per-row server lookup on every list. Returns null for a whole-class name
 * (মূল / সম্মিলিত) — it adds nothing beside the class — and for an unknown id.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "urql";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../graphql/operations";
import { isWholeClassSectionName } from "./sectionPicks";

export function useSectionNames(): (sectionId: string | null | undefined) => string | null {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId =
    yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId ?? "" },
    pause: !yearId,
  });
  const byId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classesQ.data?.classes ?? []) {
      for (const s of c.sections) if (!isWholeClassSectionName(s.nameBn)) m.set(s.id, s.nameBn);
    }
    return m;
  }, [classesQ.data]);
  return useCallback((sectionId) => (sectionId ? byId.get(sectionId) ?? null : null), [byId]);
}
