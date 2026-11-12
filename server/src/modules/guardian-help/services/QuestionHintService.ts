/**
 * QuestionHintService — the hint loader (GH-1, docs/prd-guardian-help.md §2, D-#1520/#1521).
 *
 *  - importQuestionHints(json, actor, { dryRun }) — input is the agents' file format
 *    `{ hints: [{ qid, steps: [s1, s2, s3] }] }` (docs/hint-guideline.md).
 *    Upsert by qid. The dry run is the same computation the apply uses (nothing written).
 *  - An entry is REFUSED (the rest still load) when: the qid has no current bank question, it does
 *    not have exactly 3 non-empty steps, a step is over-long, a qid repeats in the file, or a step
 *    contains the item's answer — the whole-word rule of tools/check_hints.py, ported 1:1.
 *
 * The answer set: correct option text, `blanks[].accepted`, `answer_key.accepted`, matching right
 * sides. English grammar words (a, an, is …) only WARN (they appear in rule statements).
 * `tf_answer` is also only a WARNING (the generation checker does not check it, and the guideline
 * has step 3 judge a similar statement with its own verdict word, which may legitimately repeat it).
 */
import { Types } from "mongoose";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { writeAudit } from "../../platform/services/AuditService";
import { QuestionHint } from "../models/QuestionHint";

export interface HintActor {
  userId: string;
  role: string;
}

export const HINT_STEP_MAX = [220, 220, 420] as const;

// ---------------------------------------------------------------------------
// The leak rule (port of tools/check_hints.py)
// ---------------------------------------------------------------------------

export function normHint(s: unknown): string {
  const t = String(s).normalize("NFC").toLowerCase().replace(/[\s‌‍]+/g, " ");
  return t.replace(/^[ .।,;:!?'"()[\]]+|[ .।,;:!?'"()[\]]+$/g, "");
}

/** English function words appear in any rule statement ("an comes before a vowel"): warning only. */
export const HINT_GRAMMAR_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "am", "is", "are", "he", "she", "it", "they", "this", "that", "these", "those",
  "in", "on", "under", "and", "but", "i", "we", "you", "has", "have", "was", "were",
]);
const BOUND = "[\\s(=:,.;।?!'\"‘’“”\\-—/+×÷]";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An answer leaks when it appears as a whole word / phrase (not inside another word). */
export function leakedAnswer(step: string, answers: Iterable<string>): string | null {
  const t = ` ${normHint(step)} `;
  for (const a of answers) {
    if (new RegExp(`(^|${BOUND})${escapeRe(a)}($|${BOUND})`).test(t)) return a;
  }
  return null;
}

type Payload = Record<string, unknown>;

/** Every string that is (part of) the item's answer, normalised. */
export function answersOfPayload(p: Payload): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const n = normHint(v ?? "");
    if (n) out.add(n);
  };
  for (const o of (p.options as Array<Record<string, unknown>> | undefined) ?? []) {
    if (o && o.is_correct && o.text) add(o.text);
  }
  for (const b of (p.blanks as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const a of (b?.accepted as unknown[] | undefined) ?? []) add(a);
  }
  const ak = p.answer_key as Record<string, unknown> | undefined;
  if (ak && typeof ak === "object") for (const a of (ak.accepted as unknown[] | undefined) ?? []) add(a);
  for (const pr of (p.pairs as Array<Record<string, unknown>> | undefined) ?? []) {
    if (pr && pr.right) add(pr.right);
  }
  return out;
}

const TF_WORDS: Record<string, string[]> = { true: ["true", "সত্য"], false: ["false", "মিথ্যা"] };

export interface StepCheck {
  problems: string[];
  warnings: string[];
}

/** Check one entry's steps against the item payload. */
export function checkHintSteps(steps: unknown, payload: Payload): StepCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(steps) || steps.length !== 3) {
    problems.push(`${Array.isArray(steps) ? steps.length : 0} ধাপ (৩টি দরকার)`);
    return { problems, warnings };
  }
  const ans = [...answersOfPayload(payload)];
  const hard = ans.filter((a) => !HINT_GRAMMAR_WORDS.has(a));
  const soft = ans.filter((a) => HINT_GRAMMAR_WORDS.has(a));
  steps.forEach((raw, i) => {
    const s = typeof raw === "string" ? raw : "";
    const n = i + 1;
    if (!s.trim()) {
      problems.push(`step ${n} empty`);
      return;
    }
    if (s.length > HINT_STEP_MAX[i]) {
      problems.push(`step ${n} too long (${s.length})`);
      return;
    }
    const hit = leakedAnswer(s, hard);
    if (hit) {
      problems.push(`step ${n} contains the answer '${hit}'`);
      return;
    }
    const g = leakedAnswer(s, soft);
    if (g) warnings.push(`step ${n} names the grammar word '${g}' (rule statement? check)`);
    if (typeof payload?.tf_answer === "boolean") {
      const w = leakedAnswer(s, TF_WORDS[String(payload.tf_answer)]);
      if (w) warnings.push(`step ${n} says '${w}' — the item's true/false word (fine only in a different example)`);
    }
  });
  return { problems, warnings };
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

export interface HintEntryProblem {
  qid: string;
  message: string;
}

export interface HintImportReport {
  ok: boolean;
  dryRun: boolean;
  total: number;
  /** New hints (would be) written / existing ones (would be) replaced / identical ones skipped. */
  created: number;
  updated: number;
  unchanged: number;
  refused: number;
  problems: HintEntryProblem[];
  warnings: HintEntryProblem[];
  /** Set when the whole file was unreadable. */
  fileError: string | null;
}

const emptyReport = (dryRun: boolean, fileError: string | null): HintImportReport => ({
  ok: false, dryRun, total: 0, created: 0, updated: 0, unchanged: 0, refused: 0, problems: [], warnings: [], fileError,
});

export interface HintImportOptions {
  dryRun: boolean;
  /** "agent" (the generated files, default) or "teacher". */
  source?: "agent" | "teacher";
}

export async function importQuestionHints(input: string | unknown, actor: HintActor, opts: HintImportOptions): Promise<HintImportReport> {
  const dryRun = opts.dryRun;
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return emptyReport(dryRun, "JSON পড়া যায়নি।");
    }
  }
  const list = raw && typeof raw === "object" ? (raw as { hints?: unknown }).hints : undefined;
  if (!Array.isArray(list)) return emptyReport(dryRun, 'ফাইলে "hints" তালিকা নেই।');

  const rep = emptyReport(dryRun, null);
  rep.total = list.length;
  const entries = list as Array<{ qid?: unknown; steps?: unknown; language?: unknown }>;
  const qids = [...new Set(entries.map((e) => (typeof e?.qid === "string" ? e.qid.trim() : "")).filter(Boolean))];

  // The current bank question per qid (chunked queries, never one per entry).
  const bank = new Map<string, { subject: string; classToken: string; payload: Payload }>();
  const existing = new Map<string, { version: number; steps: string }>();
  for (let i = 0; i < qids.length; i += 500) {
    const chunk = qids.slice(i, i + 500);
    const rows = await ContentArtifact.find({ docType: "question", current: true, "envelopeJson.payload.qid": { $in: chunk } })
      .select("subject classLevel envelopeJson")
      .lean();
    for (const r of rows) {
      const payload = ((r.envelopeJson as Record<string, unknown>)?.payload ?? {}) as Payload;
      bank.set(String(payload.qid), { subject: r.subject, classToken: `C${r.classLevel}`, payload });
    }
    const had = await QuestionHint.find({ qid: { $in: chunk } }).select("qid version steps").lean();
    for (const r of had) existing.set(r.qid, { version: r.version, steps: JSON.stringify(r.steps.map((s) => s.textBn)) });
  }

  const seen = new Set<string>();
  const ops: Parameters<typeof QuestionHint.bulkWrite>[0] = [];
  const by = new Types.ObjectId(actor.userId);
  for (const e of entries) {
    const qid = typeof e?.qid === "string" ? e.qid.trim() : "";
    const refuse = (message: string) => {
      rep.refused++;
      rep.problems.push({ qid: qid || "(no qid)", message });
    };
    if (!qid) {
      refuse("qid নেই");
      continue;
    }
    if (seen.has(qid)) {
      refuse("duplicate entry");
      continue;
    }
    seen.add(qid);
    const q = bank.get(qid);
    if (!q) {
      refuse("এই qid-র কোনো বর্তমান প্রশ্ন নেই");
      continue;
    }
    const chk = checkHintSteps(e.steps, q.payload);
    for (const w of chk.warnings) rep.warnings.push({ qid, message: w });
    if (chk.problems.length > 0) {
      refuse(chk.problems.join("; "));
      continue;
    }
    const texts = (e.steps as string[]).map((s) => s.trim());
    const prev = existing.get(qid);
    if (prev && prev.steps === JSON.stringify(texts)) {
      rep.unchanged++;
      continue;
    }
    if (prev) rep.updated++;
    else rep.created++;
    ops.push({
      updateOne: {
        filter: { qid },
        update: {
          $set: {
            classToken: q.classToken,
            subject: q.subject,
            steps: texts.map((textBn, i) => ({ n: (i + 1) as 1 | 2 | 3, textBn })),
            language: e.language === "en" ? "en" : "bn",
            source: opts.source ?? "agent",
            version: (prev?.version ?? 0) + 1,
            updatedBy: by,
          },
          $setOnInsert: { qid },
        },
        upsert: true,
      },
    });
  }
  rep.ok = rep.refused === 0;
  if (!dryRun && ops.length > 0) {
    await QuestionHint.bulkWrite(ops, { ordered: false });
    void writeAudit({
      eventKind: "QUESTION_HINTS_IMPORTED",
      actorId: actor.userId,
      actorRole: actor.role,
      targetKind: "QuestionHint",
      meta: { total: rep.total, created: rep.created, updated: rep.updated, unchanged: rep.unchanged, refused: rep.refused },
    });
  }
  return rep;
}
