/**
 * Batch helpers for the CSP-2 suites (docs/prd-child-support-profile.md §12 CSP-2).
 * Codes are random per batch, so canned result files are templates filled from the batch's map.
 */
import fs from "node:fs";
import path from "node:path";
import { Types } from "mongoose";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { SupportProducerEval } from "../modules/support-profile/models/SupportProducerEval";
import { loadMethod } from "../modules/support-profile/services/methodDoc";
import { authOf, DECIDE, reportInput, ROSTER, SUBMIT, type SupportFx } from "./supportFixtures";

type Run = (source: string, auth: Record<string, unknown> | null, vars?: Record<string, unknown>) => Promise<{ data?: Record<string, any> | null; errors?: readonly { message: string }[] }>;

export const RESULTS_DIR = path.join(__dirname, "fixtures/support/results");
export const CHAT = "claude.ai";
export const R2_BEHAVIOUR = "পড়া বলার সময় সে দুইবার উঠে দাঁড়িয়েছে";

export const CREATE_BATCH = `mutation($mode: String, $stages: [String!], $childIds: [String!]) { createSupportBatch(mode: $mode, stages: $stages, childIds: $childIds) { id code status reportCount childCount } }`;
export const CANCEL_BATCH = `mutation($b: String!) { cancelSupportBatch(batchId: $b) { status } }`;
export const DOWNLOAD = `mutation($b: String!) { downloadSupportPack(batchId: $b) { fileName content sha256 sizeBytes } }`;
export const UPLOAD = `mutation($b: String!, $t: String!, $c: String) {
  uploadSupportResult(batchId: $b, text: $t, chatLabel: $c) {
    importId status warnings backToQueue
    ok { reportId } returns { reportId questions } safeguarding { reportId }
    drafts { items } rejected { itemRef reasonCode reasonBn text }
  }
}`;
export const APPLY = `mutation($i: String!, $u: [String!]) { applySupportImport(importId: $i, untickReportIds: $u) { status backToQueue } }`;

export const P = (fx: SupportFx) => authOf(fx.principal, "PRINCIPAL");

/** A passed evaluation for the chat label — the upload gate (§16.9). */
export async function passEval(fx: SupportFx, chatLabel = CHAT): Promise<void> {
  const m = loadMethod();
  await SupportProducerEval.create({ kind: "CHAT", chatLabel, methodVersion: m.version, methodHash: m.sha256, passed: true, runBy: fx.principal, runAt: new Date(), marks: {} });
}

export interface BatchSetup {
  batchId: string;
  a1: string;
  r1: string;
  r2: string;
}

/** A1 approved (context), R1 clean positive (class teacher), R2 a concern (routine teacher) → batch. */
export async function setupBatch(run: Run, fx: SupportFx, opts: { skipEval?: boolean } = {}): Promise<BatchSetup> {
  const ct = authOf(fx.classTeacher, "TEACHER");
  const a = await run(SUBMIT, ct, { input: reportInput(fx.child, { behaviour: "দলে অঙ্কের কাজে সে পাশের জনকে দুটি অঙ্ক দেখিয়ে দিয়েছে" }) });
  const a1 = a.data?.submitSupportReport.report.id;
  await run(DECIDE, P(fx), { id: a1, d: "APPROVED" });
  const r1 = (await run(SUBMIT, ct, { input: reportInput(fx.child) })).data?.submitSupportReport.report.id;
  const r2 = (await run(SUBMIT, authOf(fx.routineTeacher, "TEACHER"), { input: reportInput(fx.child, { behaviour: R2_BEHAVIOUR, tone: "CONCERN", result: "PARTLY" }) })).data?.submitSupportReport.report.id;
  if (!opts.skipEval) await passEval(fx);
  const b = await run(CREATE_BATCH, P(fx), {});
  if (b.errors) throw new Error(b.errors[0].message);
  return { batchId: b.data?.createSupportBatch.id, a1, r1, r2 };
}

export async function codesOf(batchId: string, ids: Record<string, string>): Promise<Record<string, string>> {
  const b = await SupportBatch.findById(batchId).lean();
  const map = b!.codeMap!;
  const out: Record<string, string> = { BATCH: b!.code, NONCE: b!.packNonce, METHOD: b!.methodVersion, C1: map.children[0].code, CLASSMATE: ROSTER.classmate.nameBn };
  for (const [k, id] of Object.entries(ids)) out[k] = map.reports.find((r) => String(r.reportId) === id)?.code ?? "R-000";
  return out;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(BATCH|NONCE|METHOD|R1|R2|A1|C1|CLASSMATE)\}\}/g, (_m, k: string) => values[k] ?? _m);
}

export function result(file: string, values: Record<string, string>): string {
  return fill(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8"), values);
}

export const oidStr = (): string => new Types.ObjectId().toString();
