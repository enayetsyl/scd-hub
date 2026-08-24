/**
 * useSyllabusPickers (SY-4/SY-6) — the exam + class selection three screens share.
 *
 * Written once rather than three times because the wiring is fiddly in the same
 * way each time: the year list resolves the CURRENT year, the current year
 * resolves the class list, and both selections have to survive the lists arriving
 * asynchronously in either order.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../graphql/operations";
import { EXAMS, type ExamT } from "../graphql/exams";

export interface SyllabusPickerClass {
  id: string;
  level: number;
  label: string;
}

export interface SyllabusPickers {
  academicYearId: string | null;
  exams: ExamT[];
  examId: string | null;
  setExamId: (id: string) => void;
  classes: SyllabusPickerClass[];
  classId: string | null;
  setClassId: (id: string) => void;
  /** True while either list is still loading and nothing has been chosen yet. */
  loading: boolean;
  refetch: () => void;
}

export function useSyllabusPickers(): SyllabusPickers {
  const [yearsQ, refetchYears] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const academicYearId = useMemo(() => {
    const years = yearsQ.data?.academicYears ?? [];
    return (years.find((y) => y.current) ?? years[0])?.id ?? null;
  }, [yearsQ.data?.academicYears]);

  const [examsQ, refetchExams] = useQuery({
    query: EXAMS,
    variables: { academicYearId },
    pause: !academicYearId,
  });
  const exams = useMemo(() => examsQ.data?.exams ?? [], [examsQ.data?.exams]);

  const [classesQ, refetchClasses] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: academicYearId ?? "" },
    pause: !academicYearId,
  });
  const classes = useMemo<SyllabusPickerClass[]>(
    () =>
      (classesQ.data?.classes ?? [])
        .filter((c) => c.active !== false)
        // Roster order, never alphabetical: Nursery is −1 and KG is 0, so sorting
        // by name would put them in the middle of the primary classes.
        .sort((a, b) => a.level - b.level)
        .map((c) => ({ id: c.id, level: c.level, label: c.nameBn })),
    [classesQ.data?.classes],
  );

  const [examId, setExamId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  useEffect(() => {
    if (examId === null && exams.length > 0) setExamId(exams[0].id);
  }, [exams, examId]);

  useEffect(() => {
    if (classId === null && classes.length > 0) setClassId(classes[0].id);
  }, [classes, classId]);

  return {
    academicYearId,
    exams,
    examId,
    setExamId,
    classes,
    classId,
    setClassId,
    loading: (yearsQ.fetching || examsQ.fetching || classesQ.fetching) && !examId,
    refetch: () => {
      refetchYears({ requestPolicy: "network-only" });
      refetchExams({ requestPolicy: "network-only" });
      refetchClasses({ requestPolicy: "network-only" });
    },
  };
}
