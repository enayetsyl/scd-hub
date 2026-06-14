/**
 * Vocab pickers (VC-5) — thin <Select> wrappers shared by the vocab screens so a
 * program / class-level / class+section is chosen by name, never by pasted id.
 */
import React from "react";
import { useQuery } from "urql";
import { VOCAB_PROGRAMS, ROSTER_CLASS_LEVELS } from "@scd/shared";
import { Select } from "./ui";
import { CLASSES_QUERY } from "../graphql/operations";
import { STR, vocabProgramLabel, classLevelLabel } from "../lib/labels";

/** Pick a vocab program (ENGLISH/BANGLA/ARABIC). */
export function ProgramSelect({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (v: string) => void;
  label?: string;
}): React.ReactElement {
  return (
    <Select
      label={label ?? STR.vbProgram}
      value={value}
      options={VOCAB_PROGRAMS.map((p) => ({ label: vocabProgramLabel(p), value: p }))}
      onChange={onChange}
      placeholder={STR.vbPickProgram}
    />
  );
}

/** Pick a roster class level → yields the level as a string ("1".."5", "0", "-1"). */
export function ClassLevelSelect({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (v: string) => void;
  label?: string;
}): React.ReactElement {
  return (
    <Select
      label={label ?? STR.class}
      value={value}
      options={ROSTER_CLASS_LEVELS.map((l) => ({ label: classLevelLabel(l), value: String(l) }))}
      onChange={onChange}
      placeholder={STR.vbPickClass}
    />
  );
}

export interface SectionPick {
  classId: string;
  sectionId: string;
  classLevel: number;
  sectionName: string;
}

/** Pick a class then a section for an academic year → yields the full SectionPick
 *  (so the caller has the classLevel a vocab test needs without a second lookup). */
export function ClassSectionSelect({
  academicYearId,
  value,
  onChange,
}: {
  academicYearId: string;
  value: SectionPick | null;
  onChange: (v: SectionPick | null) => void;
}): React.ReactElement {
  const [{ data }] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId }, pause: !academicYearId });
  const classes = (data?.classes ?? []).filter((c) => c.active);
  const [classId, setClassId] = React.useState<string | null>(value?.classId ?? null);
  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  return (
    <>
      <Select
        label={STR.class}
        value={classId}
        options={classes.map((c) => ({ label: c.nameBn, value: c.id }))}
        onChange={(v) => {
          setClassId(v);
          onChange(null);
        }}
        placeholder={STR.vbPickClass}
      />
      {selectedClass ? (
        <Select
          label={STR.section}
          value={value?.sectionId ?? null}
          options={selectedClass.sections.filter((s) => s.active).map((s) => ({ label: s.nameBn, value: s.id }))}
          onChange={(sid) => {
            const sec = selectedClass.sections.find((s) => s.id === sid);
            onChange({
              classId: selectedClass.id,
              sectionId: sid,
              classLevel: selectedClass.level,
              sectionName: `${selectedClass.nameBn} ${sec?.nameBn ?? ""}`.trim(),
            });
          }}
          placeholder={STR.vbPickSection}
        />
      ) : null}
    </>
  );
}
