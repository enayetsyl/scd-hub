/**
 * ব্যাচ প্রক্রিয়া — batches, the analysis pack, result upload / preview / apply, the evaluation pack
 * (docs/prd-child-support-profile.md §6.10, §6.11, §9.8, §16.9; CSP-2). Every field is gated on the
 * LOCKED `support_profile:process` and refused in any "view as" session (the service checks).
 * No field returns the code map as a list (DE-9).
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { SUPPORT_IMPORT_REASONS, type SupportImportReason } from "@scd/shared";
import { SupportBatch, type ISupportBatch } from "../models/SupportBatch";
import { SupportImport, type ISupportImport } from "../models/SupportImport";
import { SupportProducerEval } from "../models/SupportProducerEval";
import { Student } from "../../foundation/models/Student";
import { SupportReport } from "../models/SupportReport";
import {
  applyImport,
  assertProcess,
  cancelBatch,
  createBatch,
  discardImport,
  downloadPack,
  uploadResult,
} from "../services/SupportBatchService";
import type { ValidationOutcome } from "../services/supportResultValidator";
import { buildEvalPack, recordEvaluation } from "../eval/supportEvaluation";
import { loadMethod } from "../services/methodDoc";

const BatchRef = builder.objectRef<ISupportBatch>("SupportBatch").implement({
  fields: (t) => ({
    id: t.string({ resolve: (b) => String(b._id) }),
    code: t.exposeString("code"),
    mode: t.exposeString("mode"),
    stages: t.stringList({ resolve: (b) => b.stages }),
    status: t.exposeString("status"),
    reportCount: t.int({ resolve: (b) => b.reportIds.length }),
    childCount: t.int({ resolve: (b) => b.childIds.length }),
    methodVersion: t.exposeString("methodVersion"),
    producer: t.string({ nullable: true, resolve: (b) => (b.producer ? (b.producer.kind === "API" ? `${b.producer.provider}/${b.producer.model}` : (b.producer.chatLabel ?? null)) : null) }),
    downloads: t.int({ resolve: (b) => b.packDownloads.length }),
    createdAt: t.string({ resolve: (b) => b.createdAt.toISOString() }),
    expiresKey: t.exposeString("expiresKey"),
    backToQueue: t.int({ nullable: true, resolve: (b) => b.summary?.backToQueue ?? null }),
  }),
});
const BatchPageRef = pageRef("SupportBatchPage", BatchRef);

const PackRef = builder.objectRef<{ fileName: string; content: string; sha256: string; sizeBytes?: number }>("SupportPackFile").implement({
  description: "The pack, built in memory for this response only — the server keeps its hash, never the file.",
  fields: (t) => ({
    fileName: t.exposeString("fileName"),
    content: t.exposeString("content"),
    sha256: t.exposeString("sha256"),
    sizeBytes: t.int({ resolve: (p) => p.sizeBytes ?? Buffer.byteLength(p.content, "utf8") }),
  }),
});

interface PreviewRow {
  reportId: string;
  studentName: string;
  occurredOn: string;
  verdict: string;
  safeguarding: boolean;
  questions: string[];
}
interface PreviewShape {
  importId: string;
  batchCode: string;
  status: string;
  warnings: string[];
  ok: PreviewRow[];
  returns: PreviewRow[];
  safeguarding: PreviewRow[];
  drafts: { studentName: string; items: number }[];
  rejected: { itemRef: string; reasonCode: string; reasonBn: string; text: string | null }[];
  backToQueue: number;
}

const PreviewRowRef = builder.objectRef<PreviewRow>("SupportImportPreviewRow").implement({
  fields: (t) => ({
    reportId: t.exposeString("reportId"),
    studentName: t.exposeString("studentName"),
    occurredOn: t.exposeString("occurredOn"),
    verdict: t.exposeString("verdict"),
    safeguarding: t.exposeBoolean("safeguarding"),
    questions: t.exposeStringList("questions"),
  }),
});
const PreviewRef = builder.objectRef<PreviewShape>("SupportImportPreview").implement({
  description: "ঠিক আছে · শিক্ষকের কাছে ফেরত যাবে · বাতিল হয়েছে · সুরক্ষা — nothing is applied until প্রয়োগ করুন.",
  fields: (t) => ({
    importId: t.exposeString("importId"),
    batchCode: t.exposeString("batchCode"),
    status: t.exposeString("status"),
    warnings: t.exposeStringList("warnings"),
    ok: t.field({ type: [PreviewRowRef], resolve: (p) => p.ok }),
    returns: t.field({ type: [PreviewRowRef], resolve: (p) => p.returns }),
    safeguarding: t.field({ type: [PreviewRowRef], resolve: (p) => p.safeguarding }),
    drafts: t.field({
      type: [builder.objectRef<{ studentName: string; items: number }>("SupportImportPreviewDraft").implement({ fields: (u) => ({ studentName: u.exposeString("studentName"), items: u.exposeInt("items") }) })],
      resolve: (p) => p.drafts,
    }),
    rejected: t.field({
      type: [
        builder.objectRef<PreviewShape["rejected"][number]>("SupportImportRejected").implement({
          fields: (u) => ({ itemRef: u.exposeString("itemRef"), reasonCode: u.exposeString("reasonCode"), reasonBn: u.exposeString("reasonBn"), text: u.string({ nullable: true, resolve: (r) => r.text }) }),
        }),
      ],
      resolve: (p) => p.rejected,
    }),
    backToQueue: t.exposeInt("backToQueue"),
  }),
});

/** Build the preview — codes mapped to names on the server; the map itself never leaves. */
export async function previewOf(imp: ISupportImport): Promise<PreviewShape> {
  const b = await SupportBatch.findById(imp.batchId);
  const map = b?.codeMap;
  const valid = (imp.valid ?? { reports: [], children: [], noResult: [] }) as Pick<ValidationOutcome, "reports" | "children" | "noResult">;
  const repIds = new Map(map?.reports.map((r) => [r.code, String(r.reportId)]) ?? []);
  const reports = await SupportReport.find({ _id: { $in: [...repIds.values()].map((x) => new Types.ObjectId(x)) } }).select("studentId occurredOn").lean();
  const names = new Map((await Student.find({ _id: { $in: reports.map((r) => r.studentId).concat(map?.children.map((c) => c.studentId) ?? []) } }).select("name nameBn").lean()).map((s) => [String(s._id), s.nameBn || s.name]));
  const row = (code: string, verdict: string, sg: boolean, questions: string[]): PreviewRow => {
    const id = repIds.get(code) ?? "";
    const r = reports.find((x) => String(x._id) === id);
    return { reportId: id, studentName: r ? (names.get(String(r.studentId)) ?? "") : "", occurredOn: r?.occurredOn ?? "", verdict, safeguarding: sg, questions };
  };
  const ok: PreviewRow[] = [];
  const returns: PreviewRow[] = [];
  const sgs: PreviewRow[] = [];
  for (const r of valid.reports) {
    const q = r.flags.map((f) => f.askBn);
    if (r.safeguarding.present) sgs.push(row(r.code, r.verdict, true, q));
    else if (r.verdict === "NEEDS_REWRITE") returns.push(row(r.code, r.verdict, false, q));
    else ok.push(row(r.code, r.verdict, false, q));
  }
  const preview = (imp.previewText ?? []) as { itemRef: string; text: string }[];
  return {
    importId: String(imp._id),
    batchCode: b?.code ?? "",
    status: imp.status,
    warnings: imp.warnings,
    ok,
    returns,
    safeguarding: sgs,
    drafts: valid.children.filter((c) => c.draft).map((c) => ({ studentName: names.get(String(map?.children.find((x) => x.code === c.code)?.studentId)) ?? "", items: c.draft!.items.length })),
    rejected: imp.rejected.map((r) => ({ itemRef: r.itemRef, reasonCode: r.reasonCode, reasonBn: SUPPORT_IMPORT_REASONS[r.reasonCode as SupportImportReason] ?? r.reasonCode, text: preview.find((p) => p.itemRef === r.itemRef)?.text ?? null })),
    backToQueue: valid.noResult.length,
  };
}

const EvalRef = builder
  .objectRef<{ passed: boolean; marks: Record<string, unknown>; suggestions: string[] }>("SupportEvaluationResult")
  .implement({
    fields: (t) => ({
      passed: t.exposeBoolean("passed"),
      marksJson: t.string({ resolve: (e) => JSON.stringify(e.marks) }),
      suggestions: t.exposeStringList("suggestions"),
    }),
  });

builder.queryField("supportBatchesPage", (t) =>
  t.field({
    type: BatchPageRef,
    authScopes: { hasPermission: "support_profile:process" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_r, a, ctx) => {
      await assertProcess(ctx);
      const page = Math.max(1, a.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, a.pageSize ?? 20));
      const [rows, total] = await Promise.all([SupportBatch.find({}).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize), SupportBatch.countDocuments({})]);
      return { rows, total, page, pageSize };
    },
  }),
);

builder.mutationField("createSupportBatch", (t) =>
  t.field({
    type: BatchRef,
    description: "নতুন ব্যাচ — freezes the waiting reports (§6.10 B-2); a profile-only batch takes stages [SYNTHESIS] + childIds.",
    authScopes: { hasPermission: "support_profile:process" },
    args: { mode: t.arg.string({ required: false }), stages: t.arg.stringList({ required: false }), childIds: t.arg.stringList({ required: false }) },
    resolve: (_r, a, ctx) => createBatch(ctx, { mode: a.mode === "API" ? "API" : a.mode === "MANUAL" ? "MANUAL" : null, stages: a.stages, childIds: a.childIds }),
  }),
);

builder.mutationField("cancelSupportBatch", (t) =>
  t.field({ type: BatchRef, authScopes: { hasPermission: "support_profile:process" }, args: { batchId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => cancelBatch(ctx, a.batchId) }),
);

builder.mutationField("downloadSupportPack", (t) =>
  t.field({
    type: PackRef,
    description: "বিশ্লেষণ প্যাক নামান — refused if a name, phone or id is still found (fail closed).",
    authScopes: { hasPermission: "support_profile:process" },
    args: { batchId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => downloadPack(ctx, a.batchId),
  }),
);

builder.mutationField("uploadSupportResult", (t) =>
  t.field({
    type: PreviewRef,
    description: "ফলাফল আপলোড — validated strictly (V-1 … V-14); returns the preview. Nothing is applied yet.",
    authScopes: { hasPermission: "support_profile:process" },
    args: {
      batchId: t.arg.string({ required: true }),
      text: t.arg.string({ required: true }),
      producerKind: t.arg.string({ required: false }),
      chatLabel: t.arg.string({ required: false }),
      provider: t.arg.string({ required: false }),
      model: t.arg.string({ required: false }),
    },
    resolve: async (_r, a, ctx) => {
      const { importDoc } = await uploadResult(ctx, a.batchId, a.text, { kind: a.producerKind === "API" ? "API" : "CHAT", chatLabel: a.chatLabel, provider: a.provider, model: a.model });
      return previewOf(importDoc);
    },
  }),
);

builder.queryField("supportImportPreview", (t) =>
  t.field({
    type: PreviewRef,
    authScopes: { hasPermission: "support_profile:process" },
    args: { importId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertProcess(ctx);
      const imp = await SupportImport.findById(a.importId);
      if (!imp) throw new Error("ফলাফল পাওয়া যায়নি।");
      return previewOf(imp);
    },
  }),
);

builder.mutationField("applySupportImport", (t) =>
  t.field({
    type: BatchRef,
    description: "প্রয়োগ করুন — `untickReportIds`: reports kept for the Principal's own queue instead of going back to the teacher.",
    authScopes: { hasPermission: "support_profile:process" },
    args: { importId: t.arg.string({ required: true }), untickReportIds: t.arg.stringList({ required: false }) },
    resolve: async (_r, a, ctx) => {
      const imp = await SupportImport.findById(a.importId);
      const b = imp ? await SupportBatch.findById(imp.batchId) : null;
      const untick = (b?.codeMap?.reports ?? []).filter((r) => (a.untickReportIds ?? []).includes(String(r.reportId))).map((r) => r.code);
      return applyImport(ctx, a.importId, untick);
    },
  }),
);

builder.mutationField("discardSupportImport", (t) =>
  t.boolean({ authScopes: { hasPermission: "support_profile:process" }, args: { importId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => discardImport(ctx, a.importId) }),
);

builder.mutationField("downloadSupportEvalPack", (t) =>
  t.field({
    type: PackRef,
    description: "মূল্যায়ন প্যাক — invented reports + the real method; run it through the chat before using that chat for real batches.",
    authScopes: { hasPermission: "support_profile:process" },
    resolve: async (_r, _a, ctx) => {
      await assertProcess(ctx);
      return buildEvalPack();
    },
  }),
);

builder.mutationField("recordSupportEvaluation", (t) =>
  t.field({
    type: EvalRef,
    description: "Score the evaluation result against the server-held key (§16.9) and store it.",
    authScopes: { hasPermission: "support_profile:process" },
    args: {
      kind: t.arg.string({ required: true }),
      chatLabel: t.arg.string({ required: false }),
      provider: t.arg.string({ required: false }),
      model: t.arg.string({ required: false }),
      resultText: t.arg.string({ required: true }),
      suggestionsChecked: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, a, ctx) => {
      const { row, marks } = await recordEvaluation(ctx, { kind: a.kind === "API" ? "API" : "CHAT", chatLabel: a.chatLabel, provider: a.provider, model: a.model, resultText: a.resultText, suggestionsChecked: a.suggestionsChecked });
      return { passed: row.passed, marks: { ...marks, suggestionsToRead: undefined }, suggestions: marks.suggestionsToRead.map((s) => `${s.fixture}: ${s.suggestionBn}`) };
    },
  }),
);

builder.queryField("supportMethodInfo", (t) =>
  t.field({
    type: builder
      .objectRef<{ version: string; sha256: string; passedChats: string[] }>("SupportMethodInfo")
      .implement({ fields: (u) => ({ version: u.exposeString("version"), sha256: u.exposeString("sha256"), passedChats: u.exposeStringList("passedChats") }) }),
    authScopes: { hasPermission: "support_profile:process" },
    resolve: async (_r, _a, ctx) => {
      await assertProcess(ctx);
      const m = loadMethod();
      const rows = await SupportProducerEval.find({ methodVersion: m.version, passed: true }).select("kind chatLabel provider modelKey").lean();
      return { version: m.version, sha256: m.sha256, passedChats: rows.map((r) => (r.kind === "CHAT" ? (r.chatLabel ?? "") : `${r.provider}/${r.modelKey}`)) };
    },
  }),
);
