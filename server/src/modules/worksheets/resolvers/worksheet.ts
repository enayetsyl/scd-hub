/**
 * Worksheet generator GraphQL surface (D-#744–#747).
 *
 * Gates are declarative (the static resolver-gate guard reads `authScopes`):
 *   generate / preview / send / read the bank → tracker:write OR roster:manage
 *   save the plan / edit a picture            → roster:manage
 * The service re-checks the same rules, so a future caller cannot skip them.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import {
  getPlan,
  savePlan,
  previewWorksheet,
  sendWorksheetToPrint,
  myWorksheets,
  worksheetTeachers,
  listPictures,
  updatePicture,
  type PlanView,
  type WorksheetPreview,
  type PreviewPicture,
  type SendWorksheetResult,
  type WorksheetListRow,
  type PictureRow,
  type PicturePage,
} from "../services/WorksheetService";
import type { PlanRow, PresetRow } from "../engine/plan";
import type { WorksheetHeader } from "../render/worksheetPdf";

/** A fresh object per field: Pothos wants a mutable Permission[] for the scope. */
const GENERATE = (): { hasAnyPermission: Permission[] } => ({ hasAnyPermission: ["tracker:write", "roster:manage"] });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PresetRowRef = builder.objectRef<PresetRow>("WorksheetPresetRow");
PresetRowRef.implement({
  fields: (t) => ({ seq: t.exposeInt("seq"), count: t.exposeInt("count") }),
});

const PlanRowRef = builder.objectRef<PlanRow>("WorksheetPlanRow");
PlanRowRef.implement({
  fields: (t) => ({
    seq: t.exposeInt("seq"),
    label: t.exposeString("label"),
    itemType: t.string({ nullable: true, resolve: (r) => r.itemType }),
    count: t.exposeInt("count"),
    marksEach: t.exposeFloat("marksEach"),
    total: t.exposeFloat("total"),
    kind: t.exposeString("kind"),
    axis: t.string({ nullable: true, resolve: (r) => r.axis ?? null }),
    setSize: t.int({ nullable: true, resolve: (r) => r.setSize ?? null }),
    source: t.exposeString("source"),
    changed: t.exposeBoolean("changed"),
  }),
});

const PlanRef = builder.objectRef<PlanView>("WorksheetPlan");
PlanRef.implement({
  fields: (t) => ({
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    classLabel: t.exposeString("classLabel"),
    subject: t.exposeString("subject"),
    examId: t.string({ nullable: true, resolve: (p) => p.examId }),
    examName: t.string({ nullable: true, resolve: (p) => p.examName }),
    finalTotal: t.exposeFloat("finalTotal"),
    rows: t.field({ type: [PlanRowRef], resolve: (p) => p.rows }),
    assignmentPreset: t.field({ type: [PresetRowRef], resolve: (p) => p.assignmentPreset }),
    classTestPreset: t.field({ type: [PresetRowRef], resolve: (p) => p.classTestPreset }),
    assignmentPresetSaved: t.exposeBoolean("assignmentPresetSaved"),
    classTestPresetSaved: t.exposeBoolean("classTestPresetSaved"),
  }),
});

const HeaderRef = builder.objectRef<WorksheetHeader>("WorksheetHeader");
HeaderRef.implement({
  fields: (t) => ({
    english: t.exposeBoolean("english"),
    school: t.exposeString("school"),
    title: t.exposeString("title"),
    subtitle: t.string({ nullable: true, resolve: (h) => h.subtitle ?? null }),
    classLine: t.exposeString("classLine"),
    meta: t.string({ nullable: true, resolve: (h) => h.meta ?? null }),
    fullMarks: t.exposeString("fullMarks"),
    nameLabel: t.exposeString("nameLabel"),
    idLabel: t.exposeString("idLabel"),
  }),
});

const PreviewPictureRef = builder.objectRef<PreviewPicture>("WorksheetPreviewPicture");
PreviewPictureRef.implement({
  fields: (t) => ({ id: t.exposeString("id"), dataUri: t.exposeString("dataUri") }),
});

type PreviewRow = WorksheetPreview["rows"][number];
const PreviewRowRef = builder.objectRef<PreviewRow>("WorksheetPreviewRow");
PreviewRowRef.implement({
  fields: (t) => ({
    seq: t.exposeInt("seq"),
    count: t.exposeInt("count"),
    marksEach: t.exposeFloat("marksEach"),
    label: t.exposeString("label"),
    kind: t.exposeString("kind"),
  }),
});

const PreviewRef = builder.objectRef<WorksheetPreview>("WorksheetPreview");
PreviewRef.implement({
  fields: (t) => ({
    docJson: t.exposeString("docJson", {
      description: "The generated paper (sections/cells/pictures) as JSON — the app renders it natively.",
    }),
    total: t.exposeFloat("total"),
    warnings: t.exposeStringList("warnings"),
    header: t.field({ type: HeaderRef, resolve: (p) => p.header }),
    pictures: t.field({ type: [PreviewPictureRef], resolve: (p) => p.pictures }),
    rows: t.field({ type: [PreviewRowRef], resolve: (p) => p.rows }),
  }),
});

const SendResultRef = builder.objectRef<SendWorksheetResult>("WorksheetSendResult");
SendResultRef.implement({
  fields: (t) => ({
    worksheetId: t.exposeString("worksheetId"),
    printRequestId: t.exposeString("printRequestId"),
    title: t.exposeString("title"),
    totalMarks: t.exposeFloat("totalMarks"),
  }),
});

const ListRowRef = builder.objectRef<WorksheetListRow>("WorksheetListRow");
ListRowRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    title: t.exposeString("title"),
    kind: t.exposeString("kind"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    totalMarks: t.exposeFloat("totalMarks"),
    createdAt: t.string({ resolve: (r) => new Date(r.createdAt).toISOString() }),
    printRequestId: t.string({ nullable: true, resolve: (r) => r.printRequestId }),
  }),
});

const TeacherRef = builder.objectRef<{ userId: string; name: string }>("WorksheetTeacher");
TeacherRef.implement({
  fields: (t) => ({ userId: t.exposeString("userId"), name: t.exposeString("name") }),
});

const PictureRowRef = builder.objectRef<PictureRow>("WorksheetPictureRow");
PictureRowRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    book: t.exposeString("book"),
    page: t.exposeInt("page"),
    word: t.string({ nullable: true, resolve: (p) => p.word }),
    wordEn: t.string({ nullable: true, resolve: (p) => p.wordEn }),
    letter: t.string({ nullable: true, resolve: (p) => p.letter }),
    uses: t.exposeStringList("uses"),
    reserveForFinal: t.exposeBoolean("reserveForFinal"),
    active: t.exposeBoolean("active"),
    useCount: t.exposeInt("useCount"),
    lastUsedAt: t.string({ nullable: true, resolve: (p) => (p.lastUsedAt ? new Date(p.lastUsedAt).toISOString() : null) }),
    thumbUri: t.exposeString("thumbUri"),
  }),
});

const PictureCountRef = builder.objectRef<PicturePage["counts"][number]>("WorksheetPictureCount");
PictureCountRef.implement({
  fields: (t) => ({ book: t.exposeString("book"), total: t.exposeInt("total"), untagged: t.exposeInt("untagged") }),
});

const PicturePageRef = builder.objectRef<PicturePage>("WorksheetPicturePage");
PicturePageRef.implement({
  fields: (t) => ({
    rows: t.field({ type: [PictureRowRef], resolve: (p) => p.rows }),
    total: t.exposeInt("total"),
    counts: t.field({ type: [PictureCountRef], resolve: (p) => p.counts }),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const PresetRowInput = builder.inputType("WorksheetPresetRowInput", {
  fields: (t) => ({ seq: t.int({ required: true }), count: t.int({ required: true }) }),
});

const PlanRowInput = builder.inputType("WorksheetPlanRowInput", {
  fields: (t) => ({
    seq: t.int({ required: true }),
    kind: t.string({ required: true }),
    axis: t.string({ required: false }),
    setSize: t.int({ required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("worksheetPlan", (t) =>
  t.field({
    type: PlanRef,
    description:
      "D-#745: the class's latest PUBLISHED মানবন্টন for the subject, each row with how it is generated, " +
      "plus the Assignment/Class-test presets. Nursery/KG, BAN/ENG/MATH.",
    authScopes: GENERATE(),
    args: { classId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => getPlan(ctx, args.classId, args.subject),
  }),
);

const generateArgs = builder.args((t) => ({
  classId: t.string({ required: true }),
  subject: t.string({ required: true }),
  kind: t.string({ required: true }),
  seed: t.int({ required: true }),
  rows: t.field({ type: [PresetRowInput], required: false }),
  letterUpTo: t.int({ required: false }),
  numberUpTo: t.int({ required: false }),
  title: t.string({ required: false }),
  subtitle: t.string({ required: false }),
  meta: t.string({ required: false }),
}));

builder.queryField("worksheetPreview", (t) =>
  t.field({
    type: PreviewRef,
    description:
      "D-#744: generate a paper (deterministic in `seed`) without storing anything. A new seed = a new version.",
    authScopes: GENERATE(),
    args: generateArgs,
    resolve: (_r, args, ctx) => previewWorksheet(ctx, args),
  }),
);

builder.queryField("myWorksheets", (t) =>
  t.field({
    type: [ListRowRef],
    description: "Worksheets I sent to print (or the Office made for me), newest first.",
    authScopes: GENERATE(),
    args: { limit: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => myWorksheets(ctx, args.limit ?? 30),
  }),
);

builder.queryField("worksheetTeachers", (t) =>
  t.field({
    type: [TeacherRef],
    description: "Office only: the routine teachers of the pair, to generate on their behalf. [] for a teacher.",
    authScopes: GENERATE(),
    args: { classId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => worksheetTeachers(ctx, args.classId, args.subject),
  }),
);

builder.queryField("worksheetPictures", (t) =>
  t.field({
    type: PicturePageRef,
    description: "D-#746: the picture bank (taken from the school's Nursery books), with thumbnails.",
    authScopes: GENERATE(),
    args: {
      book: t.arg.string({ required: false }),
      untagged: t.arg.boolean({ required: false }),
      search: t.arg.string({ required: false }),
      includeHidden: t.arg.boolean({ required: false }),
      offset: t.arg.int({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: (_r, args, ctx) => listPictures(ctx, args),
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("saveWorksheetPlan", (t) =>
  t.field({
    type: PlanRef,
    description: "D-#745: save how each row is generated + the presets. Principal/Office (roster:manage). Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      classId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      rows: t.arg({ type: [PlanRowInput], required: true }),
      assignmentPreset: t.arg({ type: [PresetRowInput], required: false }),
      classTestPreset: t.arg({ type: [PresetRowInput], required: false }),
    },
    resolve: (_r, args, ctx) => savePlan(ctx, args),
  }),
);

builder.mutationField("sendWorksheetToPrint", (t) =>
  t.field({
    type: SendResultRef,
    description:
      "D-#747: regenerate the previewed version from its seed, render the PDF and file it through the " +
      "existing print queue (UPLOAD of a print_upload owned by the caller). Stores the worksheet for its answer key.",
    authScopes: GENERATE(),
    args: {
      ...generateArgs,
      colour: t.arg.string({ required: true }),
      sides: t.arg.string({ required: true }),
      copies: t.arg.int({ required: true }),
      copiesMode: t.arg.string({ required: false }),
      copiesClassId: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      neededByKey: t.arg.string({ required: true }),
      forTeacherId: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => sendWorksheetToPrint(ctx, args),
  }),
);

builder.mutationField("updateWorksheetPicture", (t) =>
  t.field({
    type: PictureRowRef,
    description: "D-#746: tag a bank picture (word, first letter, uses), reserve it for the final, or hide it. roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      word: t.arg.string({ required: false }),
      wordEn: t.arg.string({ required: false }),
      letter: t.arg.string({ required: false }),
      uses: t.arg.stringList({ required: false }),
      reserveForFinal: t.arg.boolean({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: (_r, { id, ...patch }, ctx) => updatePicture(ctx, id, patch),
  }),
);
