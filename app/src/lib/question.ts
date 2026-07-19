/**
 * Question payload helpers. Questions are stored as ContentArtifacts and exposed
 * with the full payload serialised as `payloadJson` (the Project-04 LOCKED
 * question payload). We parse it client-side for the bank rows (question_text)
 * and the preview (options / answer carriers).
 */
export interface QuestionOption {
  option_id?: string;
  text?: string;
  is_correct?: boolean;
}

export interface QuestionBlank {
  blank_no?: number | string;
  accepted?: string[];
}

export interface QuestionPair {
  left?: string;
  right?: string;
}

export interface QuestionPayload {
  qid?: string;
  question_text?: string;
  question_type?: string;
  paper_role?: string;
  marks?: number;
  options?: QuestionOption[];
  tf_answer?: boolean;
  blanks?: QuestionBlank[];
  pairs?: QuestionPair[];
  answer_key?: { accepted?: string[]; model_note?: string };
  [k: string]: unknown;
}

export function parsePayload(json: string | null | undefined): QuestionPayload {
  if (!json) return {};
  try {
    return JSON.parse(json) as QuestionPayload;
  } catch {
    return {};
  }
}

export function questionText(json: string | null | undefined): string {
  return parsePayload(json).question_text ?? "";
}

/** Prettify an enum code for display (mcq → MCQ, short_answer → Short Answer). */
export function prettyCode(code?: string | null): string {
  if (!code) return "";
  if (code === "mcq") return "MCQ";
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
