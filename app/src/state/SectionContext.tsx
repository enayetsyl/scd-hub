/**
 * Section context — the academic-year → class → section selection that the
 * set/tracker journeys (J3/J4) need. The year comes from the `academicYears`
 * picker (auto-selects the current year) and the class/section from
 * `classes(academicYearId)`, with the teacher's own `myScopes` sections as
 * shortcuts (Slice-4 follow-up — no pasted ids). The selection is persisted so
 * it survives reloads.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { getItem, setItem } from "../lib/storage";

export interface SectionSelection {
  academicYearId: string | null;
  classId: string | null;
  sectionId: string | null;
  classLevel: number | null;
  classNameBn: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
}

const EMPTY: SectionSelection = {
  academicYearId: process.env.EXPO_PUBLIC_DEFAULT_ACADEMIC_YEAR_ID ?? null,
  classId: null,
  sectionId: null,
  classLevel: null,
  classNameBn: null,
  sectionCode: null,
  sectionNameBn: null,
};

const STORAGE_KEY = "scd_section_ctx";

interface SectionContextValue {
  selection: SectionSelection;
  hasSection: boolean;
  setAcademicYearId: (id: string) => void;
  setSection: (s: Omit<SectionSelection, "academicYearId">) => void;
  clearSection: () => void;
}

const SectionContext = createContext<SectionContextValue | null>(null);

export function SectionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [selection, setSelection] = useState<SectionSelection>(EMPTY);

  useEffect(() => {
    (async () => {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<SectionSelection>;
          setSelection({ ...EMPTY, ...parsed });
        } catch {
          /* ignore corrupt persisted value */
        }
      }
    })();
  }, []);

  const persist = useCallback((next: SectionSelection) => {
    setSelection(next);
    void setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const setAcademicYearId = useCallback(
    (id: string) => {
      persist({ ...EMPTY, academicYearId: id.trim() || null });
    },
    [persist],
  );

  const setSection = useCallback(
    (s: Omit<SectionSelection, "academicYearId">) => {
      setSelection((prev) => {
        const next = { ...prev, ...s };
        void setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const clearSection = useCallback(() => {
    setSelection((prev) => {
      const next = {
        ...prev,
        classId: null,
        sectionId: null,
        classLevel: null,
        classNameBn: null,
        sectionCode: null,
        sectionNameBn: null,
      };
      void setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<SectionContextValue>(
    () => ({
      selection,
      hasSection: !!(selection.classId && selection.sectionId),
      setAcademicYearId,
      setSection,
      clearSection,
    }),
    [selection, setAcademicYearId, setSection, clearSection],
  );

  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

export function useSectionContext(): SectionContextValue {
  const ctx = useContext(SectionContext);
  if (!ctx) throw new Error("useSectionContext must be used within SectionProvider");
  return ctx;
}
