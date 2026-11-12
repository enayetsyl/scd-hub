/**
 * useSectionNames (D-#722) — a section id → its Bangla name, for labels that would
 * otherwise read only "শ্রেণি ৪". Since C4/C5 split into বালক/বালিকা (2026-10-01) a
 * teacher with Science in both halves saw two identical class-test cards.
 *
 * Read from the current year's CLASSES_QUERY (already cached by most screens) rather
 * than a per-row server lookup on every list. Returns null for a whole-class name
 * (মূল / সম্মিলিত) — it adds nothing beside the class — and for an unknown id.
 *
 * YC-5: after the year change, old rows still point at the PAST year's sections (a 2026
 * class test, a December report). The lookup therefore also reads the latest earlier year, so
 * a past section id resolves too, and its label says which year it was: "৩য় শ্রেণি বালক (2026)".
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "urql";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../graphql/operations";
import { isWholeClassSectionName } from "./sectionPicks";
import { bnNum, classSectionLabel } from "./labels";
import { pastYearSuffix } from "./yearHandling";

interface SectionInfo {
  classLevel: number;
  /** Null for a whole-class name (মূল / সম্মিলিত). */
  nameBn: string | null;
  /** " (2026)" when the section belongs to a past year, else "". */
  yearSuffix: string;
}

function useSectionInfo(): Map<string, SectionInfo> {
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears;
  const current = years?.find((y) => y.current) ?? years?.[0] ?? null;
  // The latest year that started before the current one (labels are the year, "2026" < "2027").
  const past =
    (years ?? [])
      .filter((y) => current && y.id !== current.id && y.label < current.label)
      .sort((x, y) => (x.label < y.label ? 1 : -1))[0] ?? null;
  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: current?.id ?? "" },
    pause: !current,
  });
  const [pastQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: past?.id ?? "" },
    pause: !past,
  });
  return useMemo(() => {
    const m = new Map<string, SectionInfo>();
    const add = (classes: ReadonlyArray<{ level: number; sections: ReadonlyArray<{ id: string; nameBn: string }> }> | undefined, yearSuffix: string): void => {
      for (const c of classes ?? []) {
        for (const s of c.sections) {
          m.set(s.id, { classLevel: c.level, nameBn: isWholeClassSectionName(s.nameBn) ? null : s.nameBn, yearSuffix });
        }
      }
    };
    add(pastQ.data?.classes, pastYearSuffix(past?.label, current?.label ?? null, bnNum));
    add(classesQ.data?.classes, ""); // the current year wins on any clash
    return m;
  }, [classesQ.data, pastQ.data, past?.label, current?.label]);
}

export function useSectionNames(): (sectionId: string | null | undefined) => string | null {
  const info = useSectionInfo();
  return useCallback(
    (sectionId) => {
      const s = sectionId ? info.get(sectionId) : undefined;
      // A past-year whole-class (মূল) section keeps its year marker too: its name alone is empty.
      if (!s) return null;
      if (s.nameBn) return `${s.nameBn}${s.yearSuffix}`;
      return s.yearSuffix ? s.yearSuffix.trim() : null;
    },
    [info],
  );
}

/** A section id → "৪র্থ শ্রেণি বালক" (D-#723), for a screen that knows only the section
 *  (the assignment reconcile / chase lists). Null for an unknown id. */
export function useSectionLabel(): (sectionId: string | null | undefined) => string | null {
  const info = useSectionInfo();
  return useCallback(
    (sectionId) => {
      const s = sectionId ? info.get(sectionId) : undefined;
      return s ? `${classSectionLabel(s.classLevel, s.nameBn)}${s.yearSuffix}` : null;
    },
    [info],
  );
}
