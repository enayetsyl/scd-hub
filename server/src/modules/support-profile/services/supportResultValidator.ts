/**
 * The import validator (docs/prd-child-support-profile.md §6.11 V-1 … V-14, §6.6 rules 1–16;
 * NORMATIVE, D-#1587). PURE: it takes the raw text and a context built from the batch, and returns
 * what is valid and what is rejected, with a reason code from SUPPORT_IMPORT_REASONS. The same code
 * checks an uploaded file (Mode B) and a provider's reply (Mode A, CSP-7). The server trusts none of
 * the model's claims: levels, counts and settings are recomputed; the word lists and the safeguarding
 * list are re-run on every piece of model-written text; unknown fields and ids are refused.
 */
import {
  SUPPORT_ITEM_SCHEMA,
  SUPPORT_REPORT_RESULT_SCHEMA,
  SUPPORT_RESULT_LIMITS,
  SUPPORT_RESULT_SCHEMA,
  SUPPORT_RESULT_SCHEMA_NAME,
  SUPPORT_SECTIONS,
  SUPPORT_SECTION_MIN_LEVEL,
  SUPPORT_THRESHOLDS,
  bannedProfileWordIn,
  blockedTermIn,
  checkMiniSchema,
  evidenceLevel,
  functionTagAllowed,
  insideWindow,
  levelRank,
  normaliseSupportText,
  safeguardingTermIn,
  scanSupportTerms,
  severityFor,
  sideOfSection,
  termOccurs,
  type EvidenceReport,
  type EvidenceSummary,
  type SafeguardingSign,
  type SupportCategory,
  type SupportImportReason,
  type SupportLevel,
  type SupportReportSource,
  type SupportReportStatus,
  type SupportResult,
  type SupportSection,
  type SupportSeverity,
  type SupportTone,
} from "@scd/shared";

export const MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const OTHER_CHILD_MASK = "[অন্য শিশু]";

/** One report as the pack showed it (masked texts) plus what the server knows (never sent). */
export interface CtxReport {
  code: string;
  childCode: string;
  isNew: boolean;
  status: SupportReportStatus;
  source: SupportReportSource;
  authorCode: string;
  occurredOn: string;
  slot: string;
  setting: string;
  result: SupportResult | null;
  tone: SupportTone;
  goodThingCounts: boolean;
  gotOrAvoided: string[];
  /** The masked text of each flag field, exactly as in the pack. */
  texts: Record<string, string>;
}

export interface ValidationCtx {
  batchCode: string;
  nonce: string;
  methodVersion: string;
  /** The batch can still take a result (OPEN or RESULT_PENDING) and its code map exists. */
  open: boolean;
  todayKey: string;
  reports: Map<string, CtxReport>;
  children: Set<string>;
  strategies: Set<string>;
  /** Strategy code → child code (COMPARE strategy ids must be this child's, §6.4). */
  strategyChildren?: Map<string, string>;
  items: Set<string>;
  /** Every roster name (children, guardians, staff): none may sit in a model sentence (V-11). */
  rosterNames: string[];
}

export interface ValidFlag {
  id: string;
  category: SupportCategory;
  severity: SupportSeverity;
  field: string;
  quote: string;
  whyBn: string;
  askBn: string;
  suggestionBn: string | null;
  byServer: boolean;
}

export interface ValidReportResult {
  code: string;
  verdict: "READY" | "NEEDS_REWRITE";
  flags: ValidFlag[];
  toneCheck: { teacherTone: string; textReads: string };
  strategyCandidate: { present: boolean; titleBn: string; starterKey: string | null; punitive: boolean } | null;
  safeguarding: { present: boolean; signs: SafeguardingSign[]; confidence: "LOW" | "HIGH" };
  compare: unknown | null;
}

export interface ValidItem {
  section: SupportSection;
  ref: string;
  textBn: string;
  evidence: string[];
  provisional: string[];
  counter: string[];
  claimedLevel: SupportLevel;
  computed: EvidenceSummary;
  /** The level from APPROVED citations only (rule 15: shown twice where they differ). */
  approvedOnly: EvidenceSummary;
  strategyId: string | null;
  kind: string | null;
  insteadOfItem: string | null;
  needTag: string | null;
  functionTag: string | null;
  skillKey: string | null;
  settings: string[];
  actionable: { verbFirst: boolean; observable: boolean; specific: boolean; doable: boolean } | null;
  replacesItemId: string | null;
  baselineBn: string | null;
  expectedBn: string | null;
}

export interface ValidChildResult {
  code: string;
  draft: { items: ValidItem[]; card: { doItems: string[]; avoidItems: string[]; strengthItems: string[]; goalItem: string | null }; changeNoteBn: string } | null;
  safeguardingBanner: boolean;
}

export interface Rejection {
  itemRef: string;
  reasonCode: SupportImportReason;
  field?: string | null;
}

export interface ValidationOutcome {
  fileError: SupportImportReason | null;
  reports: ValidReportResult[];
  children: ValidChildResult[];
  rejected: Rejection[];
  warnings: string[];
  /** The model-written text of rejected items, for the preview only (deleted ≤ 24 h). */
  previewText: { itemRef: string; text: string }[];
  /** New reports with no valid result — back to TO_PROCESS (V-13). */
  noResult: string[];
}

const empty = (fileError: SupportImportReason): ValidationOutcome => ({ fileError, reports: [], children: [], rejected: [], warnings: [], previewText: [], noResult: [] });

/** V-1: one JSON object — raw, inside the first fenced block, or pasted. */
export function parseResultText(raw: string): unknown | null {
  const t = raw.replace(/^﻿/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    /* try a fenced block */
  }
  const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(t);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(t.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const LINK_OR_HTML = /https?:\/\/|www\.|<\/?[a-z][^>]*>|```|<script/i;
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const asciiDigits = (s: string): string => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const numbersIn = (s: string): string[] => asciiDigits(s).match(/\d+/g) ?? [];

function nameIn(text: string, roster: string[]): string | null {
  const norm = normaliseSupportText(text);
  for (const n of roster) if (n.trim().length >= 3 && termOccurs(norm, n)) return n;
  return null;
}

/** A model-written text must be plain and hold no bracket token but [S] (and ___ in suggestions). */
const otherToken = (s: string): boolean => /\[(?!S\])[^\]]*\]/.test(s);

function textProblem(text: string, ctx: ValidationCtx, childCode: string | null): SupportImportReason | null {
  if (LINK_OR_HTML.test(text)) return "LINK_OR_HTML";
  if (safeguardingTermIn(text)) return "SAFEGUARDING_TERM";
  if (blockedTermIn(text)) return "LABEL_TERM";
  // {{DATE:R-…}} must name a report of this child; then strip it before the code scan.
  let rest = text;
  for (const m of text.matchAll(/\{\{DATE:(R-\d{3})\}\}/g)) {
    const r = ctx.reports.get(m[1]);
    if (!r || (childCode && r.childCode !== childCode)) return "TOKEN_OR_NAME";
    rest = rest.replace(m[0], " ");
  }
  if (/\{\{/.test(rest)) return "TOKEN_OR_NAME";
  if (otherToken(rest)) return "TOKEN_OR_NAME";
  if (/\b[CTRSIB]-\d{2,4}\b/.test(rest)) return "TOKEN_OR_NAME";
  if (nameIn(rest, ctx.rosterNames)) return "TOKEN_OR_NAME";
  if (bannedProfileWordIn(rest)) return "FREQUENCY_WORD";
  return null;
}

const FIELD_OF: Record<string, string> = { result: "resultNote" };

function validateReport(
  raw: Record<string, unknown>,
  ctx: ValidationCtx,
  out: ValidationOutcome,
): ValidReportResult | null {
  const code = String(raw.report ?? "");
  const ref = code || "R-???";
  const rep = ctx.reports.get(code);
  if (!rep) {
    out.rejected.push({ itemRef: ref, reasonCode: "UNKNOWN_CODE" });
    return null;
  }
  if (!rep.isNew) {
    out.rejected.push({ itemRef: ref, reasonCode: "NOT_NEW" });
    return null;
  }
  // V-12: at most 8 flags — the extra ones are rejected, the rest go on.
  const check = (raw.check ?? {}) as Record<string, unknown>;
  if (Array.isArray(check.flags) && check.flags.length > SUPPORT_RESULT_LIMITS.flags) {
    for (const f of check.flags.slice(SUPPORT_RESULT_LIMITS.flags)) out.rejected.push({ itemRef: `${ref}/${(f as { id?: string })?.id ?? "flag"}`, reasonCode: "TOO_BIG" });
    check.flags = check.flags.slice(0, SUPPORT_RESULT_LIMITS.flags);
  }
  const bad = checkMiniSchema(raw, SUPPORT_REPORT_RESULT_SCHEMA);
  if (bad) {
    out.rejected.push({ itemRef: ref, reasonCode: bad.kind, field: bad.path });
    return null;
  }
  const c = raw.check as {
    verdict: "READY" | "NEEDS_REWRITE";
    flags: { id: string; category: SupportCategory; severity: SupportSeverity; field: string; quote: string; whyBn: string; askBn: string; suggestionBn: string }[];
    toneCheck: { teacherTone: string; textReads: string };
    strategyCandidate: { present: boolean; titleBn: string; starterKey: string | null; punitive: boolean };
    safeguarding: { present: boolean; signs: SafeguardingSign[]; confidence: "LOW" | "HIGH"; quote: string };
  };
  const flags: ValidFlag[] = [];
  for (const f of c.flags) {
    const fieldText = rep.texts[FIELD_OF[f.field] ?? f.field] ?? "";
    // V-6: the quote must occur in the named field.
    if (!f.quote || !normaliseSupportText(fieldText).includes(normaliseSupportText(f.quote))) {
      out.rejected.push({ itemRef: `${ref}/${f.id}`, reasonCode: "BAD_VALUE", field: "quote" });
      continue;
    }
    if (rep.source === "GUARDIAN_INFO" && f.category === "MISSING_PART") continue;
    // V-9 / V-10 on the model's question: a safeguarding or label term drops the question.
    if (safeguardingTermIn(`${f.askBn} ${f.whyBn}`) || blockedTermIn(`${f.askBn} ${f.whyBn}`) || LINK_OR_HTML.test(`${f.askBn} ${f.whyBn}`)) {
      out.rejected.push({ itemRef: `${ref}/${f.id}`, reasonCode: safeguardingTermIn(`${f.askBn} ${f.whyBn}`) ? "SAFEGUARDING_TERM" : "LABEL_TERM" });
      continue;
    }
    let suggestion: string | null = f.suggestionBn || null;
    if (suggestion) {
      const known = new Set(numbersIn(fieldText));
      const newNumber = numbersIn(suggestion).some((n) => !known.has(n));
      const badToken = /\[(?!S\])[^\]]*\]/.test(suggestion.replace(/_{3,}/g, ""));
      const hasName = !!nameIn(suggestion, ctx.rosterNames);
      if (newNumber || badToken || hasName || blockedTermIn(suggestion) || safeguardingTermIn(suggestion) || LINK_OR_HTML.test(suggestion)) {
        out.rejected.push({ itemRef: `${ref}/${f.id}/suggestion`, reasonCode: newNumber || badToken || hasName ? "TOKEN_OR_NAME" : "LABEL_TERM" });
        suggestion = null;
      }
    }
    const askLabel = f.category === "LABEL" && f.severity === "ASK";
    flags.push({ id: f.id, category: f.category, severity: severityFor(f.category, f.field, askLabel), field: f.field, quote: f.quote, whyBn: f.whyBn, askBn: f.askBn, suggestionBn: suggestion, byServer: false });
  }
  // The server's own lists run again on the report and add their flags (V-6, S-6).
  const texts = { ...rep.texts, goodThing: rep.texts.goodThing ?? "" };
  for (const h of scanSupportTerms(texts)) {
    if (flags.some((x) => x.category === h.category && normaliseSupportText(x.quote).includes(normaliseSupportText(h.term)))) continue;
    flags.push({
      id: `s${flags.length + 1}`,
      category: h.category,
      severity: h.severity,
      field: h.field === "resultNote" ? "result" : h.field,
      quote: h.term,
      whyBn: h.severity === "BLOCK" ? "এই শব্দটি শিশুর সম্পর্কে রায়, ঘটনা নয়।" : "এই শব্দটি স্বভাব বোঝায়।",
      askBn: "এই শব্দের বদলে ঠিক কী দেখেছেন বা শুনেছেন লিখুন।",
      suggestionBn: null,
      byServer: true,
    });
  }
  for (const [field, text] of Object.entries(rep.texts)) {
    if (text.includes(OTHER_CHILD_MASK) && !flags.some((x) => x.category === "OTHER_CHILD")) {
      flags.push({ id: `s${flags.length + 1}`, category: "OTHER_CHILD", severity: "BLOCK", field: field === "resultNote" ? "result" : field, quote: OTHER_CHILD_MASK, whyBn: "অন্য শিশুর পরিচয় রিপোর্টে থাকবে না।", askBn: "নামটি বাদ দিয়ে 'এক সহপাঠী' লিখুন।", suggestionBn: null, byServer: true });
    }
  }
  // COMPARE (§6.4, V-5): every report / strategy id must be this child's and in this batch's map.
  let compare = (raw.compare as Record<string, unknown> | null) ?? null;
  if (compare) {
    const cmp = compare as {
      agreement: { otherReportIds: string[]; noteBn: string; claim: string }[];
      functionHint: { reportIds: string[] };
      safeguardingPattern: { reportIds: string[] };
      strategyMatches: { strategyId: string }[];
      authorSkew: { status: string; noteBn: string };
      principalSummaryBn: string;
    };
    const ids = [...cmp.agreement.flatMap((a) => a.otherReportIds), ...cmp.functionHint.reportIds, ...cmp.safeguardingPattern.reportIds];
    const badReport = ids.some((x) => ctx.reports.get(x)?.childCode !== rep.childCode);
    const badStrategy = cmp.strategyMatches.some(
      (m) => m.strategyId !== "NEW" && (!ctx.strategies.has(m.strategyId) || (ctx.strategyChildren && ctx.strategyChildren.get(m.strategyId) !== rep.childCode)),
    );
    if (badReport || badStrategy) {
      out.rejected.push({ itemRef: ref, reasonCode: "UNKNOWN_CODE", field: "compare" });
      return null;
    }
    // authorSkew only with ≥ 3 reports from this author and ≥ 3 from others on this child (§6.4).
    const childReps = [...ctx.reports.values()].filter((x) => x.childCode === rep.childCode);
    const mine = childReps.filter((x) => x.authorCode === rep.authorCode).length;
    const others = childReps.length - mine;
    if (mine < 3 || others < 3) cmp.authorSkew = { status: "TOO_FEW", noteBn: "" };
    // V-10 on the model's notes: a label / diagnosis or a link drops that note.
    const clean = (t: string) => (blockedTermIn(t) || LINK_OR_HTML.test(t) ? "" : t);
    for (const a of cmp.agreement) {
      a.noteBn = clean(a.noteBn);
      a.claim = clean(a.claim);
    }
    cmp.authorSkew.noteBn = clean(cmp.authorSkew.noteBn);
    cmp.principalSummaryBn = clean(cmp.principalSummaryBn);
    compare = cmp as unknown as Record<string, unknown>;
  }
  const anyBlock = flags.some((f) => f.severity === "BLOCK");
  return {
    code,
    verdict: anyBlock ? "NEEDS_REWRITE" : c.verdict,
    flags,
    toneCheck: c.toneCheck,
    strategyCandidate: c.strategyCandidate.present && !blockedTermIn(c.strategyCandidate.titleBn) && !safeguardingTermIn(c.strategyCandidate.titleBn) && !c.strategyCandidate.punitive ? c.strategyCandidate : null,
    safeguarding: { present: c.safeguarding.present, signs: c.safeguarding.signs, confidence: c.safeguarding.confidence },
    compare,
  };
}

function toEvidence(r: CtxReport, viaGoodThing = false): EvidenceReport {
  return { id: r.code, authorId: r.authorCode, occurredOn: r.occurredOn, slot: r.slot, setting: r.setting, source: r.source, result: r.result, viaGoodThing };
}

function validateChild(raw: Record<string, unknown>, ctx: ValidationCtx, ready: Set<string>, out: ValidationOutcome): ValidChildResult | null {
  const code = String(raw.child ?? "");
  if (!ctx.children.has(code)) {
    out.rejected.push({ itemRef: code || "C-???", reasonCode: "UNKNOWN_CODE" });
    return null;
  }
  const draftRaw = raw.profileDraft as Record<string, unknown> | null | undefined;
  // V-12: at most 12 items a section — the extra ones are rejected before the schema runs.
  if (draftRaw && draftRaw.sections && typeof draftRaw.sections === "object") {
    for (const [sec, list] of Object.entries(draftRaw.sections as Record<string, unknown>)) {
      if (Array.isArray(list) && list.length > SUPPORT_RESULT_LIMITS.sectionItems) {
        for (const it of list.slice(SUPPORT_RESULT_LIMITS.sectionItems)) {
          out.rejected.push({ itemRef: `${code}/${sec}/${(it as { ref?: string })?.ref ?? "?"}`, reasonCode: "TOO_BIG" });
          out.previewText.push({ itemRef: `${code}/${sec}/${(it as { ref?: string })?.ref ?? "?"}`, text: String((it as { textBn?: string })?.textBn ?? "").slice(0, 300) });
        }
        (draftRaw.sections as Record<string, unknown[]>)[sec] = list.slice(0, SUPPORT_RESULT_LIMITS.sectionItems);
      }
    }
  }
  // Items one by one, so one bad item never sinks the draft (item-level V-4).
  const items: ValidItem[] = [];
  let banner = false;
  const sections = (draftRaw?.sections ?? {}) as Record<string, unknown[]>;
  if (draftRaw) {
    for (const k of Object.keys(sections)) {
      if (!(SUPPORT_SECTIONS as readonly string[]).includes(k)) {
        out.rejected.push({ itemRef: `${code}/${k}`, reasonCode: "UNKNOWN_FIELD" });
        delete sections[k];
      }
    }
  }
  for (const section of SUPPORT_SECTIONS) {
    const list = Array.isArray(sections[section]) ? sections[section] : [];
    for (const it of list) {
      const itRaw = it as Record<string, unknown>;
      const ref = `${code}/${section}/${String(itRaw?.ref ?? "?")}`;
      const reject = (reasonCode: SupportImportReason, field?: string) => {
        out.rejected.push({ itemRef: ref, reasonCode, field: field ?? null });
        out.previewText.push({ itemRef: ref, text: String(itRaw?.textBn ?? "").slice(0, 300) });
      };
      const bad = checkMiniSchema(itRaw, SUPPORT_ITEM_SCHEMA);
      if (bad) {
        reject(bad.kind, bad.path);
        continue;
      }
      const item = itRaw as unknown as {
        ref: string; textBn: string; evidence: string[]; counterEvidence: string[]; claimedLevel: SupportLevel; strategyId?: string | null; kind?: string | null;
        insteadOfItem?: string | null; needTag?: string | null; functionTag?: string | null; skillKey?: string | null; settings: string[];
        actionable?: ValidItem["actionable"]; replacesItemId?: string | null; baselineBn?: string | null; expectedBn?: string | null;
      };
      const tp = textProblem(item.textBn, ctx, code);
      if (tp) {
        if (tp === "SAFEGUARDING_TERM") banner = true;
        reject(tp, "textBn");
        continue;
      }
      // V-5: every code must exist in this batch's map.
      const allCodes = [...item.evidence, ...item.counterEvidence];
      if (allCodes.some((x) => !ctx.reports.has(x)) || (item.strategyId && item.strategyId !== "NEW" && !ctx.strategies.has(item.strategyId)) || (item.replacesItemId && !ctx.items.has(item.replacesItemId))) {
        reject("UNKNOWN_CODE");
        continue;
      }
      const side = sideOfSection(section);
      // V-7: a citation counts only if APPROVED (inside its window) or a READY new report of this file.
      const allowed = (c: string): "APPROVED" | "PROVISIONAL" | null => {
        const r = ctx.reports.get(c)!;
        if (r.childCode !== code) return null;
        if (r.status === "APPROVED" && (!side || insideWindow(side, r.occurredOn, ctx.todayKey))) return "APPROVED";
        if (r.isNew && ready.has(c)) return "PROVISIONAL";
        return null;
      };
      // E-2: on the positive side a CONCERN report counts only through a concrete good thing.
      const usable = (c: string): boolean => {
        const r = ctx.reports.get(c)!;
        if (side === "POSITIVE" && r.tone === "CONCERN" && !r.goodThingCounts) return false;
        return true;
      };
      const evidence = [...new Set(item.evidence)].filter((c) => allowed(c) && usable(c));
      const counter = [...new Set(item.counterEvidence)].filter((c) => allowed(c));
      if (evidence.length === 0) {
        reject("NO_EVIDENCE");
        continue;
      }
      const evRep = (c: string) => {
        const r = ctx.reports.get(c)!;
        return toEvidence(r, side === "POSITIVE" && r.tone === "CONCERN" && r.goodThingCounts);
      };
      const isStrategy = section === "works";
      const computed = evidenceLevel({ side: side ?? "POSITIVE", evidence: evidence.map(evRep), counter: counter.map(evRep), isStrategy, todayKey: ctx.todayKey });
      const approvedEv = evidence.filter((c) => allowed(c) === "APPROVED");
      const approvedOnly = evidenceLevel({ side: side ?? "POSITIVE", evidence: approvedEv.map(evRep), counter: counter.filter((c) => allowed(c) === "APPROVED").map(evRep), isStrategy, todayKey: ctx.todayKey });
      // Rule 3: a works item needs a WORKED or PARTLY report.
      if (isStrategy && !evidence.some((c) => ["WORKED", "PARTLY"].includes(ctx.reports.get(c)!.result ?? ""))) {
        reject("NO_WORKED");
        continue;
      }
      if (section === "goals") {
        if (!item.skillKey || !item.baselineBn || !item.expectedBn) {
          reject("BAD_VALUE", "goal");
          continue;
        }
      } else {
        // Rule 7 / V-8: never above the computed level; never below the section's minimum.
        if (!computed.level) {
          reject("BELOW_MIN");
          continue;
        }
        if (levelRank(item.claimedLevel) > levelRank(computed.level)) {
          reject("OVERCLAIM");
          continue;
        }
        const min = SUPPORT_SECTION_MIN_LEVEL[section];
        if (min && levelRank(computed.level) < levelRank(min)) {
          reject("BELOW_MIN");
          continue;
        }
        // Rule 9: a concern-side sentence below STRONG names its setting.
        if (side === "CONCERN" && computed.level !== "STRONG" && item.settings.length === 0) {
          reject("NO_SETTING");
          continue;
        }
        // Rule 12: guardian information alone never makes a concern item (evidenceLevel gives null).
      }
      // Rule 11: a possible reason needs ≥ 3 observations from ≥ 2 teachers that share it.
      let functionTag = item.functionTag ?? null;
      if (functionTag) {
        const sharing = evidence.map((c) => ctx.reports.get(c)!).filter((r) => r.gotOrAvoided.includes(functionTag!));
        const obs = new Set(sharing.map((r) => `${r.occurredOn}|${r.slot}`)).size;
        const teachers = new Set(sharing.map((r) => r.authorCode)).size;
        if (!functionTagAllowed(obs, teachers)) functionTag = null;
      }
      items.push({
        section,
        ref: item.ref,
        textBn: item.textBn,
        evidence: approvedEv,
        provisional: evidence.filter((c) => allowed(c) === "PROVISIONAL"),
        counter,
        claimedLevel: item.claimedLevel,
        computed,
        approvedOnly,
        strategyId: item.strategyId ?? null,
        kind: item.kind ?? null,
        insteadOfItem: item.insteadOfItem ?? null,
        needTag: item.needTag ?? null,
        functionTag,
        skillKey: item.skillKey ?? null,
        settings: computed.settings,
        actionable: item.actionable ?? null,
        replacesItemId: item.replacesItemId ?? null,
        baselineBn: item.baselineBn ?? null,
        expectedBn: item.expectedBn ?? null,
      });
    }
  }
  // Rule 14: at most 2 active goals.
  const goals = items.filter((i) => i.section === "goals");
  for (const g of goals.slice(SUPPORT_THRESHOLDS.maxActiveGoals)) {
    out.rejected.push({ itemRef: `${code}/goals/${g.ref}`, reasonCode: "TOO_BIG" });
    items.splice(items.indexOf(g), 1);
  }
  // The card (rule 13, §16.7): only valid refs, the right sections, the limits.
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const cardRaw = (draftRaw?.card ?? { doItems: [], avoidItems: [], strengthItems: [], goalItem: null }) as { doItems?: unknown; avoidItems?: unknown; strengthItems?: unknown; goalItem?: unknown };
  const pick = (list: unknown, ok: (i: ValidItem) => boolean, max: number, label: string): string[] => {
    const outList: string[] = [];
    for (const r of Array.isArray(list) ? list : []) {
      const it = typeof r === "string" ? byRef.get(r) : undefined;
      if (!it || !ok(it)) {
        out.rejected.push({ itemRef: `${code}/card/${label}/${String(r)}`, reasonCode: "NOT_ACTIONABLE" });
        continue;
      }
      if (outList.length >= max) {
        out.rejected.push({ itemRef: `${code}/card/${label}/${String(r)}`, reasonCode: "TOO_BIG" });
        continue;
      }
      outList.push(it.ref);
    }
    return outList;
  };
  const actionable = (i: ValidItem) => !!i.actionable && i.actionable.verbFirst && i.actionable.observable && i.actionable.specific && i.actionable.doable;
  const card = {
    doItems: pick(cardRaw.doItems, (i) => i.section === "works" && actionable(i) && [...i.textBn].length <= SUPPORT_THRESHOLDS.cardTextChars && !i.computed.mixed, SUPPORT_THRESHOLDS.cardDo, "do"),
    avoidItems: pick(cardRaw.avoidItems, (i) => i.section === "avoid" && !!i.insteadOfItem && byRef.has(i.insteadOfItem) && !i.computed.mixed, SUPPORT_THRESHOLDS.cardAvoid, "avoid"),
    strengthItems: pick(cardRaw.strengthItems, (i) => i.section === "strengths", SUPPORT_THRESHOLDS.cardStrengths, "strength"),
    goalItem: typeof cardRaw.goalItem === "string" && byRef.get(cardRaw.goalItem)?.section === "goals" ? cardRaw.goalItem : null,
  };
  const changeNoteBn = typeof draftRaw?.changeNoteBn === "string" && !textProblem(draftRaw.changeNoteBn, ctx, code) ? draftRaw.changeNoteBn.slice(0, SUPPORT_RESULT_LIMITS.note) : "";
  return { code, draft: draftRaw ? { items, card, changeNoteBn } : null, safeguardingBanner: banner };
}

/** The whole validator: file level first (V-1 … V-3), then item by item (V-4 … V-12), then V-13. */
export function validateSupportResult(rawText: string, ctx: ValidationCtx): ValidationOutcome {
  if (Buffer.byteLength(rawText, "utf8") > MAX_RESULT_BYTES) return empty("TOO_LARGE");
  const parsed = parseResultText(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty("NOT_JSON");
  const top = parsed as Record<string, unknown>;
  // V-3 / envelope types (reports and children are checked item by item below).
  const envelope = checkMiniSchema({ ...top, reports: [], children: [] }, SUPPORT_RESULT_SCHEMA);
  if (envelope?.kind === "UNKNOWN_FIELD") return empty("UNKNOWN_FIELD");
  // V-2: it belongs to this open batch, this nonce, this method version.
  if (top.schema !== SUPPORT_RESULT_SCHEMA_NAME) return empty("WRONG_BATCH");
  if (top.batch !== ctx.batchCode || top.nonce !== ctx.nonce) return empty("WRONG_BATCH");
  if (!ctx.open) return empty("BATCH_CLOSED");
  if (top.methodVersion !== ctx.methodVersion) return empty("WRONG_METHOD");
  if (envelope) return empty("BAD_VALUE");

  const out: ValidationOutcome = { fileError: null, reports: [], children: [], rejected: [], warnings: [], previewText: [], noResult: [] };
  const reports = Array.isArray(top.reports) ? (top.reports as Record<string, unknown>[]) : [];
  // V-5: two results for one report → both rejected.
  const count = new Map<string, number>();
  for (const r of reports) count.set(String(r?.report), (count.get(String(r?.report)) ?? 0) + 1);
  for (const r of reports) {
    const code = String(r?.report);
    if ((count.get(code) ?? 0) > 1) {
      out.rejected.push({ itemRef: code, reasonCode: "DUPLICATE" });
      continue;
    }
    const v = validateReport(r ?? {}, ctx, out);
    if (v) out.reports.push(v);
  }
  const ready = new Set(out.reports.filter((r) => r.verdict === "READY" && !r.safeguarding.present).map((r) => r.code));
  for (const c of Array.isArray(top.children) ? (top.children as Record<string, unknown>[]) : []) {
    const v = validateChild(c ?? {}, ctx, ready, out);
    if (v) out.children.push(v);
  }
  // V-13: coverage.
  const done = new Set(out.reports.map((r) => r.code));
  out.noResult = [...ctx.reports.values()].filter((r) => r.isNew && !done.has(r.code)).map((r) => r.code);
  if (top.complete === false) out.warnings.push("ফলাফল অসম্পূর্ণ (complete: false)");
  const sc = top.selfCheck as { reportsDone?: number; childrenDone?: number } | undefined;
  if (sc && (sc.reportsDone !== reports.length || sc.childrenDone !== (Array.isArray(top.children) ? top.children.length : 0)))
    out.warnings.push("স্ব-যাচাইয়ের সংখ্যা ফলাফলের সাথে মেলেনি");
  return out;
}
