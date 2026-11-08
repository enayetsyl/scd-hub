/**
 * Nursery & KG oral exam (viva) resolvers — VV-1, docs/prd-viva.md, D-#1080–#1084.
 *
 *   vivaOverview            — view|manage: every exam's oral papers with live progress.
 *   myVivaPapers            — examine (SELF): papers where the caller hears at least one child.
 *   vivaSheet               — view|manage|edit_all|lock|examine: one paper's children; the
 *                             service narrows `examine` to the caller's own children.
 *   vivaExaminerCandidates  — manage: who can be made an examiner.
 *   saveVivaPaper           — manage: questions + marks (refused once a mark exists).
 *   saveVivaExaminers       — manage: who hears which child.
 *   setVivaMark / setVivaAbsent — examine (own child) | edit_all: one tap, saved at once.
 *   lockVivaPaper           — lock.
 */
import { builder } from "../../../schema";
import {
  lockVivaPaper,
  myVivaPapers,
  saveVivaExaminers,
  saveVivaPaper,
  setVivaAbsent,
  setVivaMark,
  vivaExaminerCandidates,
  vivaOverview,
  vivaSheet,
  type VivaExaminerShape,
  type VivaItemShape,
  type VivaOverviewShape,
  type VivaPaperShape,
  type VivaProgressShape,
  type VivaRowShape,
  type VivaSheetShape,
} from "../services/VivaService";

const ItemRef = builder.objectRef<VivaItemShape>("VivaItem");
ItemRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    marks: t.exposeFloat("marks"),
    ref: t.exposeString("ref"),
  }),
});

const ExaminerRef = builder.objectRef<VivaExaminerShape>("VivaExaminer");
ExaminerRef.implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    studentIds: t.exposeStringList("studentIds"),
    children: t.exposeInt("children"),
    done: t.exposeInt("done"),
    absent: t.exposeInt("absent"),
  }),
});

const ProgressRef = builder.objectRef<VivaProgressShape>("VivaProgress");
ProgressRef.implement({
  fields: (t) => ({
    children: t.exposeInt("children"),
    done: t.exposeInt("done"),
    absent: t.exposeInt("absent"),
    started: t.exposeInt("started"),
  }),
});

const PaperRef = builder.objectRef<VivaPaperShape>("VivaPaper");
PaperRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    classLabelBn: t.exposeString("classLabelBn"),
    subject: t.exposeString("subject"),
    subjectLabelBn: t.exposeString("subjectLabelBn"),
    dateKey: t.exposeString("dateKey"),
    fullMarks: t.exposeFloat("fullMarks"),
    syllabusMarks: t.float({ nullable: true, resolve: (p) => p.syllabusMarks }),
    items: t.field({ type: [ItemRef], resolve: (p) => p.items }),
    examiners: t.field({ type: [ExaminerRef], resolve: (p) => p.examiners }),
    frozen: t.exposeBoolean("frozen"),
    lockedAt: t.string({ nullable: true, resolve: (p) => p.lockedAt }),
    progress: t.field({ type: ProgressRef, resolve: (p) => p.progress }),
  }),
});

const OverviewRef = builder.objectRef<VivaOverviewShape>("VivaOverview");
OverviewRef.implement({
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    papers: t.field({ type: [PaperRef], resolve: (o) => o.papers }),
  }),
});

const MarkRef = builder.objectRef<{ key: string; value: number }>("VivaItemMark");
MarkRef.implement({ fields: (t) => ({ key: t.exposeString("key"), value: t.exposeFloat("value") }) });

const RowRef = builder.objectRef<VivaRowShape>("VivaRow");
RowRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    roll: t.exposeString("roll"),
    examinerId: t.string({ nullable: true, resolve: (r) => r.examinerId }),
    examinerName: t.exposeString("examinerName"),
    absent: t.exposeBoolean("absent"),
    marks: t.field({ type: [MarkRef], resolve: (r) => r.marks }),
    total: t.exposeFloat("total"),
    done: t.exposeBoolean("done"),
    canEdit: t.exposeBoolean("canEdit"),
  }),
});

const SheetRef = builder.objectRef<VivaSheetShape>("VivaSheet");
SheetRef.implement({
  fields: (t) => ({
    paper: t.field({ type: PaperRef, resolve: (s) => s.paper }),
    rows: t.field({ type: [RowRef], resolve: (s) => s.rows }),
    seesAll: t.exposeBoolean("seesAll"),
  }),
});

const CandidateRef = builder.objectRef<{ userId: string; name: string }>("VivaExaminerCandidate");
CandidateRef.implement({ fields: (t) => ({ userId: t.exposeString("userId"), name: t.exposeString("name") }) });

const ItemInput = builder.inputType("VivaItemInput", {
  fields: (t) => ({
    key: t.string({ required: false }),
    label: t.string({ required: true }),
    marks: t.float({ required: true }),
    ref: t.string({ required: false }),
  }),
});

const ExaminerInput = builder.inputType("VivaExaminerInput", {
  fields: (t) => ({
    userId: t.string({ required: true }),
    studentIds: t.stringList({ required: true }),
  }),
});

// ── Queries ──────────────────────────────────────────────────────────────────

builder.queryField("vivaOverview", (t) =>
  t.field({
    type: [OverviewRef],
    authScopes: { hasAnyPermission: ["viva:view", "viva:manage"] },
    resolve: (_r, _a, ctx) => vivaOverview(ctx),
  }),
);

builder.queryField("myVivaPapers", (t) =>
  t.field({
    type: [PaperRef],
    authScopes: { hasPermission: "viva:examine" },
    resolve: (_r, _a, ctx) => myVivaPapers(ctx),
  }),
);

builder.queryField("vivaSheet", (t) =>
  t.field({
    type: SheetRef,
    // The service narrows `examine` to the children the caller examines.
    authScopes: { hasAnyPermission: ["viva:view", "viva:manage", "viva:edit_all", "viva:lock", "viva:examine"] },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => vivaSheet(ctx, args.paperId),
  }),
);

builder.queryField("vivaExaminerCandidates", (t) =>
  t.field({
    type: [CandidateRef],
    authScopes: { hasPermission: "viva:manage" },
    resolve: () => vivaExaminerCandidates(),
  }),
);

// ── Mutations ────────────────────────────────────────────────────────────────

builder.mutationField("saveVivaPaper", (t) =>
  t.field({
    type: PaperRef,
    authScopes: { hasPermission: "viva:manage" },
    args: { paperId: t.arg.string({ required: true }), items: t.arg({ type: [ItemInput], required: true }) },
    resolve: (_r, args, ctx) => saveVivaPaper(ctx, args.paperId, args.items),
  }),
);

builder.mutationField("saveVivaExaminers", (t) =>
  t.field({
    type: PaperRef,
    authScopes: { hasPermission: "viva:manage" },
    args: { paperId: t.arg.string({ required: true }), examiners: t.arg({ type: [ExaminerInput], required: true }) },
    resolve: (_r, args, ctx) => saveVivaExaminers(ctx, args.paperId, args.examiners),
  }),
);

builder.mutationField("setVivaMark", (t) =>
  t.field({
    type: RowRef,
    // The service admits `examine` only for the caller's own child; `edit_all` for any.
    authScopes: { hasAnyPermission: ["viva:examine", "viva:edit_all"] },
    args: {
      paperId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      key: t.arg.string({ required: true }),
      // null clears the question's mark.
      value: t.arg.float({ required: false }),
    },
    resolve: (_r, args, ctx) => setVivaMark(ctx, args.paperId, args.studentId, args.key, args.value ?? null),
  }),
);

builder.mutationField("setVivaAbsent", (t) =>
  t.field({
    type: RowRef,
    authScopes: { hasAnyPermission: ["viva:examine", "viva:edit_all"] },
    args: {
      paperId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      absent: t.arg.boolean({ required: true }),
    },
    resolve: (_r, args, ctx) => setVivaAbsent(ctx, args.paperId, args.studentId, args.absent),
  }),
);

builder.mutationField("lockVivaPaper", (t) =>
  t.field({
    type: PaperRef,
    authScopes: { hasPermission: "viva:lock" },
    args: { paperId: t.arg.string({ required: true }), lock: t.arg.boolean({ required: true }) },
    resolve: (_r, args, ctx) => lockVivaPaper(ctx, args.paperId, args.lock),
  }),
);
