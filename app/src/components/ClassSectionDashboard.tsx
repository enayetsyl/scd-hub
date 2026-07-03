/**
 * ClassSectionDashboard (UX-5, prd-ux-improvements.md §4.5, D-#265) — THE house
 * module-landing pattern, extracted from the per-class Homework dashboard: inline
 * class buttons (the caller's accessible classes; Principal/Office see all), an
 * optional per-class badge, and a section row when the active class has several
 * accessible sections. Selection writes the shared SectionContext, so every
 * downstream screen keeps working unchanged. A caller with exactly ONE accessible
 * section lands straight in (auto-selected on mount).
 *
 * `useAccessibleClasses` is exported separately so a host screen (Homework home)
 * can reuse the same class list to build its badge refs without a second fetch.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "urql";
import { roleHasPermission } from "@scd/shared";
import type { CombinedError } from "urql";
import {
  CLASSES_QUERY,
  MY_ROUTINE_QUERY,
  MY_SCOPES_QUERY,
  MY_SECTIONS_AS_CLASS_TEACHER_QUERY,
  type ClassT,
} from "../graphql/operations";
import { Body, Muted, Badge, Loader, EmptyState, ErrorBanner } from "./ui";
import { STR, bnNum, getActiveLang } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useAuth } from "../auth/AuthContext";
import { useSectionContext } from "../state/SectionContext";
import { space, useColors } from "../theme";

export type SectionT = ClassT["sections"][number];
export interface MyClass {
  cls: ClassT;
  sections: SectionT[];
}

/** Compact class label for the buttons: N / K / Bengali digit. */
function shortClassLabel(level: number): string {
  if (level === -1) return "N";
  if (level === 0) return "K";
  return bnNum(level);
}

/** The caller's accessible classes, grouped with their accessible sections —
 *  teaching scopes ∪ class-teacher sections ∪ routine section slots; admins
 *  (roster:manage / homework supervisor) see every active class. */
export function useAccessibleClasses(): {
  myClasses: MyClass[];
  fetching: boolean;
  error: CombinedError | undefined;
  isAdmin: boolean;
} {
  const { role, user } = useAuth();
  const { selection } = useSectionContext();
  const ayId = selection.academicYearId;
  const isAdmin = (!!role && roleHasPermission(role, "roster:manage")) || !!user?.homeworkSupervisor;

  const [{ data: classesData, fetching, error }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: ayId ?? "" },
    pause: !ayId,
  });
  const [{ data: routineData }] = useQuery({ query: MY_ROUTINE_QUERY, pause: isAdmin });
  const [{ data: scopeData }] = useQuery({ query: MY_SCOPES_QUERY, pause: isAdmin });
  const [{ data: ctData }] = useQuery({ query: MY_SECTIONS_AS_CLASS_TEACHER_QUERY, pause: isAdmin });

  const classes = classesData?.classes ?? [];
  const myClasses = useMemo<MyClass[]>(() => {
    if (isAdmin) {
      return classes
        .map((cls) => ({ cls, sections: cls.sections.filter((s) => s.active) }))
        .filter((x) => x.sections.length > 0)
        .sort((a, b) => a.cls.level - b.cls.level);
    }
    const ids = new Set<string>();
    for (const g of scopeData?.myScopes ?? []) if (g.active && g.sectionId) ids.add(g.sectionId);
    for (const s of ctData?.mySectionsAsClassTeacher ?? []) ids.add(s.id);
    for (const slot of routineData?.myRoutineSlots ?? []) {
      if (slot.groupType === "section" && slot.groupId) ids.add(slot.groupId);
    }
    return classes
      .map((cls) => ({ cls, sections: cls.sections.filter((s) => ids.has(s.id)) }))
      .filter((x) => x.sections.length > 0)
      .sort((a, b) => a.cls.level - b.cls.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, isAdmin, routineData, scopeData, ctData]);

  return { myClasses, fetching, error, isAdmin };
}

export interface ClassBadge {
  count: number;
  tone: "danger" | "warn" | "muted";
}

export function ClassSectionDashboard({
  myClasses: provided,
  badges,
  onSelect,
}: {
  /** Pass the hook's result when the host also needs it (Homework home's badge refs);
   *  omitted → the component fetches its own. */
  myClasses?: { myClasses: MyClass[]; fetching: boolean; error: CombinedError | undefined };
  /** Optional per-class badge (classId → count + tone), e.g. pending-checking counts. */
  badges?: Map<string, ClassBadge>;
  /** Fired after a section lands in SectionContext (single-section auto-pick included). */
  onSelect?: () => void;
}): React.ReactElement {
  const colors = useColors();
  const lang = getActiveLang();
  const { selection, hasSection, setSection } = useSectionContext();
  const own = useAccessibleClasses();
  const { myClasses, fetching, error } = provided ?? own;

  const [activeClassId, setActiveClassId] = useState<string | null>(selection.classId);

  function pickSection(m: MyClass, s: SectionT): void {
    setSection({
      classId: m.cls.id,
      sectionId: s.id,
      classLevel: m.cls.level,
      classNameBn: m.cls.nameBn,
      sectionCode: s.code,
      sectionNameBn: s.nameBn,
    });
    onSelect?.();
  }

  function onClassPress(m: MyClass): void {
    setActiveClassId(m.cls.id);
    if (m.sections.length === 1) {
      pickSection(m, m.sections[0]); // single section → auto-select, no section row
    } else {
      // multi-section → require a section pick; clear any stale section so detail hides
      setSection({
        classId: m.cls.id,
        sectionId: null,
        classLevel: m.cls.level,
        classNameBn: m.cls.nameBn,
        sectionCode: null,
        sectionNameBn: null,
      });
    }
  }

  // A one-section caller lands straight in: exactly one accessible class+section
  // and nothing selected yet → select it without a tap (UX-5 acceptance).
  useEffect(() => {
    if (!hasSection && myClasses.length === 1 && myClasses[0].sections.length === 1) {
      setActiveClassId(myClasses[0].cls.id);
      pickSection(myClasses[0], myClasses[0].sections[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSection, myClasses]);

  const activeClass = myClasses.find((m) => m.cls.id === activeClassId) ?? null;
  const showSectionRow = !!activeClass && activeClass.sections.length > 1;

  return (
    <View>
      <Muted>{STR.hwClassLabel}</Muted>
      {error ? (
        <ErrorBanner message={friendlyError(error)} />
      ) : fetching && myClasses.length === 0 ? (
        <Loader label={STR.loading} />
      ) : myClasses.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(1) }}>
          {myClasses.map((m) => {
            const badge = badges?.get(m.cls.id);
            const selected = selection.classId === m.cls.id || activeClassId === m.cls.id;
            return (
              <Pressable
                key={m.cls.id}
                onPress={() => onClassPress(m)}
                accessibilityRole="button"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: space(2),
                  paddingHorizontal: space(3),
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryContainer : colors.surface,
                  marginRight: space(2),
                  marginBottom: space(2),
                }}
              >
                <Body style={{ fontWeight: "700", color: selected ? colors.onPrimaryContainer : colors.textPrimary }}>
                  {shortClassLabel(m.cls.level)}
                </Body>
                {badge && badge.count > 0 ? <Badge text={bnNum(badge.count)} tone={badge.tone} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Section row — only when the active class has more than one accessible section */}
      {showSectionRow ? (
        <>
          <Muted style={{ marginTop: space(1) }}>{STR.hwSectionLabel}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(1) }}>
            {activeClass!.sections.map((s) => {
              const selected = selection.sectionId === s.id;
              const sectionLabel = lang === "en" ? s.code : s.nameBn;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => pickSection(activeClass!, s)}
                  accessibilityRole="button"
                  style={{
                    paddingVertical: space(2),
                    paddingHorizontal: space(3),
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primaryContainer : colors.surface,
                    marginRight: space(2),
                    marginBottom: space(2),
                  }}
                >
                  <Body style={{ color: selected ? colors.onPrimaryContainer : colors.textPrimary }}>
                    {sectionLabel} {lang === "en" ? "" : `(${s.code})`}
                  </Body>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}
