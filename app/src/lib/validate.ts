/**
 * Client-side required-field validation (UX-1, house rule R-Validate —
 * docs/prd-ux-improvements.md §3/§4.1): validation names the offending field in
 * the field's own `error` prop AND toasts the first error message; `errGeneric`
 * is reserved for truly unknown failures.
 *
 * Usage:
 *   const { firstErrorKey, errors } = required({
 *     subject: { value: subject, message: STR.hwSubject },
 *     topics:  { value: selectedTopics, message: STR.hwTopicRequired },
 *   });
 *   setErrors(errors);
 *   if (firstErrorKey) return toast.show(errors[firstErrorKey], "danger");
 */
export type RequiredFieldsMap = Record<string, { value: unknown; message: string }>;

export function required(fields: RequiredFieldsMap): {
  firstErrorKey: string | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  let firstErrorKey: string | null = null;
  for (const [key, field] of Object.entries(fields)) {
    const v = field.value;
    const missing =
      v == null ||
      v === false ||
      (typeof v === "string" && v.trim() === "") ||
      (typeof v === "number" && !Number.isFinite(v)) ||
      (Array.isArray(v) && v.length === 0);
    if (missing) {
      errors[key] = field.message;
      if (firstErrorKey === null) firstErrorKey = key;
    }
  }
  return { firstErrorKey, errors };
}
