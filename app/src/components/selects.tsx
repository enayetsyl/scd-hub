/**
 * Entity name-pickers — thin wrappers over <Select> that self-fetch their options
 * so screens bind an id without the user ever pasting one. Each shows the human
 * name (with a disambiguating hint where useful) and yields the entity's id.
 */
import React from "react";
import { useQuery } from "urql";
import { Select } from "./ui";
import { TEACHERS_QUERY, ROOMS_QUERY, ACADEMIC_YEARS_QUERY, STAFF_QUERY, SUBJECTS_QUERY } from "../graphql/operations";
import { STR, hrCategoryLabel } from "../lib/labels";

/** Pick a staff member by name → yields the StaffProfile id (HR admin surfaces).
 *  Reads the manager-gated staff roster; the hint shows the HR category. */
export function StaffSelect({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [{ data }] = useQuery({ query: STAFF_QUERY, variables: {} });
  const options = (data?.staff ?? []).map((s) => ({
    label: s.nameBn || s.name,
    value: s.id,
    hint: hrCategoryLabel(s.category),
  }));
  return (
    <Select
      label={label}
      value={value === "" ? null : value}
      options={options}
      onChange={onChange}
      placeholder={STR.hrSelectStaff}
      emptyText={STR.hrNoStaff}
    />
  );
}

/** Pick a teacher by name → yields the teacher's User id. */
export function TeacherSelect({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const [{ data }] = useQuery({ query: TEACHERS_QUERY });
  const options = (data?.teachers ?? []).map((t) => ({
    label: t.name,
    value: t.id,
    hint: t.phone ?? undefined,
  }));
  return (
    <Select
      label={label}
      value={value === "" ? null : value}
      options={options}
      onChange={onChange}
      placeholder={placeholder ?? STR.selectTeacher}
      emptyText={STR.noTeachers}
    />
  );
}

/** Pick a room by name → yields the room id. */
export function RoomSelect({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const [{ data }] = useQuery({ query: ROOMS_QUERY });
  const options = (data?.rooms ?? []).map((r) => ({
    label: r.nameBn,
    value: r.id,
    hint: r.code,
  }));
  return (
    <Select
      label={label}
      value={value === "" ? null : value}
      options={options}
      onChange={onChange}
      placeholder={placeholder ?? STR.selectRoom}
      emptyText={STR.noRooms}
    />
  );
}

/** Pick a subject by name → yields the subject id. */
export function SubjectSelect({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const [{ data }] = useQuery({ query: SUBJECTS_QUERY });
  const options = (data?.subjects ?? []).map((s) => ({
    label: s.nameBn,
    value: s.id,
    hint: s.code,
  }));
  return (
    <Select
      label={label}
      value={value === "" ? null : value}
      options={options}
      onChange={onChange}
      placeholder={placeholder ?? STR.selectSubject}
      emptyText={STR.noSubjects}
    />
  );
}

/** Pick an academic year → yields the year id. Auto-selects the current year while
 *  the value is still empty, so most screens land on the right year with no tap. */
export function AcademicYearSelect({
  label,
  value,
  onChange,
  variant = "auto",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  /** "auto" (default) hides the picker on operational screens once the active year
   *  is applied (design-A); "filter" always shows it (reporting / search / history). */
  variant?: "auto" | "filter";
}): React.ReactElement | null {
  const [{ data }] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = data?.academicYears ?? [];
  React.useEffect(() => {
    if (value === "" && years.length > 0) {
      const current = years.find((y) => y.current) ?? years[0];
      onChange(current.id);
    }
  }, [years, value, onChange]);
  // Operational screens default to the active year silently — when there is only one
  // year (or none yet) there is nothing to choose, so the picker is hidden (design-A).
  // It returns only where switching matters: multiple years, or an explicit filter.
  if (variant === "auto" && years.length <= 1) return null;
  const options = years.map((y) => ({ label: y.current ? `${y.label} ✓` : y.label, value: y.id }));
  return (
    <Select
      label={label}
      value={value === "" ? null : value}
      options={options}
      onChange={onChange}
      placeholder={STR.selectYear}
    />
  );
}
