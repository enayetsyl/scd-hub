/**
 * printTarget — what a doc's send-to-print card picks (English Drive, teaching notes):
 * the copies mode and WHO the print is for — a class, plus its section once the class
 * is split (C4/C5 বালক/বালিকা, D-#721).
 *
 * Its own import-free module (not PrintRequestService) so the doc services' suites,
 * which mock PrintRequestService wholesale, still get the real mapping.
 */

export interface PrintTargetInput {
  copiesMode?: string | null;
  copiesClassId?: string | null;
  classId?: string | null;
  sectionId?: string | null;
}

export interface PrintTargetFields {
  copiesMode?: string;
  copiesClassId?: string;
  classId?: string;
  sectionId?: string;
}

/** Map a picked target onto the job: it TAGS the job (history, the assignment print
 *  gap) and, for a per-present job, is the class whose count prints — narrowed to the
 *  section by `countingSectionIdOf`, since the count class IS the tagged class. An
 *  older client sends only `copiesClassId`; that is kept and no tag is invented. */
export function printTargetFields(input: PrintTargetInput): PrintTargetFields {
  return {
    copiesMode: input.copiesMode ?? undefined,
    copiesClassId:
      input.copiesClassId ?? (input.copiesMode === "CLASS_PRESENT" ? input.classId : null) ?? undefined,
    classId: input.classId ?? undefined,
    sectionId: input.sectionId ?? undefined,
  };
}
