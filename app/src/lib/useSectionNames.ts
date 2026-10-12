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
import { classSectionLabel } from "./labels";

interface SectionInfo {
  classLevel: number;
  /** Null for a whole-class name (মূল / সম্মিলিত). */
  nameBn: string | null;
}

function useSectionInfo(): Map<string, SectionInfo> {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId =
    yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId ?? "" },
    pause: !yearId,
  });
  return useMemo(() => {
    const m = new Map<string, SectionInfo>();
    for (const c of classesQ.data?.classes ?? []) {
      for (const s of c.sections) {
        m.set(s.id, { classLevel: c.level, nameBn: isWholeClassSectionName(s.nameBn) ? null : s.nameBn });
      }
    }
    return m;
  }, [classesQ.data]);
}

export function useSectionNames(): (sectionId: string | null | undefined) => string | null {
  const info = useSectionInfo();
  return useCallback((sectionId) => (sectionId ? info.get(sectionId)?.nameBn ?? null : null), [info]);
}

/** A section id → "৪র্থ শ্রেণি বালক" (D-#723), for a screen that knows only the section
 *  (the assignment reconcile / chase lists). Null for an unknown id. */
export function useSectionLabel(): (sectionId: string | null | undefined) => string | null {
  const info = useSectionInfo();
  return useCallback(
    (sectionId) => {
      const s = sectionId ? info.get(sectionId) : undefined;
      return s ? classSectionLabel(s.classLevel, s.nameBn) : null;
    },
    [info],
  );
}
