/**
 * sectionPicks — which of a class's sections a picker should offer.
 *
 * PURE module (no React / React Native import) so the server suite can unit-test it,
 * the `giftGrouping.ts` posture — the app workspace has no test runner.
 *
 * When C4/C5 split into বালক/বালিকা (2026-10-01) the সম্মিলিত section stayed
 * `active: true` with zero students — on purpose: deactivating it would strand that
 * class's past attendance (the Principal's mark-any-past-date screen lists only active
 * sections). So `active` alone no longer means "a section you can work in", and every
 * picker that filtered on it offered a third, empty section. A job tagged to it matches
 * nothing (the not-printed gap stays open) and a schedule entry on it can never be
 * delivered (empty roster).
 */

export interface PickableSection {
  active: boolean;
  /** Active students now in the section. Absent (an older query shape) → kept. */
  studentCount?: number | null;
}

/**
 * The active sections, minus an EMPTY one whose class has another section holding
 * students — the emptied সম্মিলিত beside its বালক/বালিকা. A class whose sections are
 * ALL empty keeps every one (a new year before enrolment must still be pickable).
 */
export function pickableSections<T extends PickableSection>(sections: readonly T[]): T[] {
  const active = sections.filter((s) => s.active);
  const someoneEnrolled = active.some((s) => (s.studentCount ?? 0) > 0);
  if (!someoneEnrolled) return active;
  return active.filter((s) => s.studentCount == null || s.studentCount > 0);
}

export interface PickableClass<S extends PickableSection & { id: string; nameBn: string }> {
  id: string;
  level: number;
  active: boolean;
  sections: readonly S[];
}

/** One "who is this print for" choice: a class, narrowed to a section when split. */
export interface PrintTarget {
  key: string;
  classId: string;
  classLevel: number;
  /** The section to tag — the sole section of an unsplit class, else the chosen half. */
  sectionId: string | null;
  /** Set only when the class is split, so the chip can say "৪র্থ শ্রেণি বালক". */
  sectionNameBn: string | null;
}

/**
 * The print-for chips (D-#721), Nursery first: one per class, or one per section where
 * a class has more than one pickable section (C4/C5 বালক/বালিকা). A per-present count
 * then counts that section alone, and the job carries a real section tag.
 */
export function printTargets<S extends PickableSection & { id: string; nameBn: string }>(
  classes: readonly PickableClass<S>[],
): PrintTarget[] {
  const out: PrintTarget[] = [];
  for (const c of [...classes].filter((x) => x.active).sort((a, b) => a.level - b.level)) {
    const sections = pickableSections(c.sections);
    if (sections.length <= 1) {
      const sectionId = sections[0]?.id ?? null;
      out.push({ key: `${c.id}|${sectionId ?? "-"}`, classId: c.id, classLevel: c.level, sectionId, sectionNameBn: null });
      continue;
    }
    for (const s of sections) {
      out.push({ key: `${c.id}|${s.id}`, classId: c.id, classLevel: c.level, sectionId: s.id, sectionNameBn: s.nameBn });
    }
  }
  return out;
}

/** Section names that just mean "the whole class" — not worth printing as a label. */
const WHOLE_CLASS_SECTION_NAMES = new Set(["মূল", "সম্মিলিত"]);

/** True when a section label adds nothing beside the class name (মূল / সম্মিলিত). */
export function isWholeClassSectionName(nameBn: string | null | undefined): boolean {
  return !nameBn || WHOLE_CLASS_SECTION_NAMES.has(nameBn);
}
