/**
 * Scholarship practice-paper resolvers (SC-0..SC-4, docs/prd-scholarship-practice.md).
 *
 *   scholarshipTopics       — scholarship:read; the per-(subject, class) catalogue
 *   scholarshipPapers       — scholarship:read; one section's papers
 *   scholarshipPaper        — scholarship:read; one paper + items + roster (+ scores)
 *   scholarshipStudent      — scholarship:read; one student's topic/chapter weakness
 *   scholarshipClass        — scholarship:read; the class heat-map
 *   saveScholarshipTopic    — scholarship:manage
 *   retireScholarshipTopic  — scholarship:manage (Principal/Office only, in the service)
 *   declareScholarshipPaper — scholarship:manage, ROUTINE-scoped in the service
 *   enterScholarshipScores  — scholarship:manage, ROUTINE-scoped in the service
 *
 * The write gates carry `scholarship:manage` and nothing else, because the real
 * authority is a ROW fact — "does the routine give you this class × subject" — and not a
 * permission (D-#656, the CO-1/D-#147 posture). A TEACHER holds the permission as a
 * base grant, so `assertMayManage` in the service is what actually narrows it; putting
 * that check here would leave the service writable from any future caller.
 */
import { builder } from "../../../schema";
import type { HwSubject, ScholarshipTopicAxis } from "@scd/shared";
import {
  declarePaper,
  enterScores,
  listPapers,
  listTopics,
  paperDetail,
  retireTopic,
  saveTopic,
  validateItems,
  type PaperDetailView,
  type PaperListRow,
  type TopicView,
} from "../services/ScholarshipService";
import {
  classAnalysis,
  studentAnalysis,
  type AxisRow,
  type ClassAnalysis,
  type ClassAxisRow,
  type ClassCell,
  type StudentAnalysis,
} from "../services/ScholarshipAnalysisService";

function actorOf(ctx: { auth: { userId: string; role: string } | null }): {
  userId: string;
  role: string;
} {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const TopicRef = builder.objectRef<TopicView>("ScholarshipTopic");
TopicRef.implement({
  description:
    "One topic in the per-(subject, class) catalogue. `axis` is skill for ENG/BAN and content " +
    "for SCI/BGS (D-#665) — the picker and the analysis heading read it so nothing branches on subject.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    subject: t.exposeString("subject"),
    axis: t.exposeString("axis"),
    chapters: t.exposeIntList("chapters"),
    order: t.exposeInt("order"),
    active: t.exposeBoolean("active"),
  }),
});

const PaperRowRef = builder.objectRef<PaperListRow>("ScholarshipPaperRow");
PaperRowRef.implement({
  description:
    "One paper on the list screen. `classPercent` is null until somebody is scored — never 0, " +
    "which would read as a disastrous paper rather than an unscored one.",
  fields: (t) => ({
    id: t.exposeString("id"),
    paperId: t.exposeString("paperId"),
    name: t.exposeString("name"),
    subjects: t.exposeStringList("subjects"),
    paperDate: t.string({ nullable: true, resolve: (r) => r.paperDate }),
    totalMarks: t.exposeFloat("totalMarks"),
    itemCount: t.exposeInt("itemCount"),
    status: t.exposeString("status"),
    scoredCount: t.exposeInt("scoredCount"),
    presentCount: t.exposeInt("presentCount"),
    classPercent: t.float({ nullable: true, resolve: (r) => r.classPercent }),
  }),
});

const PaperItemRef = builder.objectRef<PaperDetailView["items"][number]>("ScholarshipPaperItem");
PaperItemRef.implement({
  description:
    "One declared item. EXACTLY one topic, ZERO OR MORE chapters (D-#659), and its own subject — " +
    "a combined Science + BGS paper is one paper with items on both sides (D-#664).",
  fields: (t) => ({
    itemNo: t.exposeInt("itemNo"),
    label: t.exposeString("label"),
    subject: t.exposeString("subject"),
    topicCode: t.exposeString("topicCode"),
    topicLabel: t.exposeString("topicLabel"),
    chapters: t.exposeIntList("chapters"),
    itemType: t.exposeString("itemType"),
    marks: t.exposeFloat("marks"),
  }),
});

const ItemMarkRef = builder.objectRef<{ itemNo: number; marks: number }>("ScholarshipItemMark");
ItemMarkRef.implement({
  fields: (t) => ({
    itemNo: t.exposeInt("itemNo"),
    marks: t.exposeFloat("marks"),
  }),
});

const RosterRowRef = builder.objectRef<PaperDetailView["roster"][number]>("ScholarshipRosterRow");
RosterRowRef.implement({
  description:
    "A student on this paper's section roster, with whatever score exists. `status: null` means " +
    "not yet touched; ABSENT carries no marks at all rather than zeros (D-#660).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    nameBn: t.exposeString("nameBn"),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    itemMarks: t.field({ type: [ItemMarkRef], resolve: (r) => r.itemMarks }),
    total: t.float({ nullable: true, resolve: (r) => r.total }),
  }),
});

const PaperDetailRef = builder.objectRef<PaperDetailView>("ScholarshipPaperDetail");
PaperDetailRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    paperId: t.exposeString("paperId"),
    name: t.exposeString("name"),
    subjects: t.exposeStringList("subjects"),
    sectionId: t.exposeString("sectionId"),
    classLevel: t.exposeInt("classLevel"),
    paperDate: t.string({ nullable: true, resolve: (r) => r.paperDate }),
    totalMarks: t.exposeFloat("totalMarks"),
    durationMinutes: t.int({ nullable: true, resolve: (r) => r.durationMinutes }),
    sourceNote: t.string({ nullable: true, resolve: (r) => r.sourceNote }),
    status: t.exposeString("status"),
    items: t.field({ type: [PaperItemRef], resolve: (r) => r.items }),
    roster: t.field({ type: [RosterRowRef], resolve: (r) => r.roster }),
  }),
});

const AxisRowRef = builder.objectRef<AxisRow>("ScholarshipAxisRow");
AxisRowRef.implement({
  description:
    "One topic or chapter for one student. `band: insufficient` means fewer than the floor's " +
    "worth of marks have been set on it — `percent` is deliberately null, not a number to rank (D-#662).",
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    subject: t.exposeString("subject"),
    earned: t.exposeFloat("earned"),
    available: t.exposeFloat("available"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    band: t.exposeString("band"),
    classPercent: t.float({ nullable: true, resolve: (r) => r.classPercent }),
    classGap: t.int({ nullable: true, resolve: (r) => r.classGap }),
    behindClass: t.exposeBoolean("behindClass"),
    paperCount: t.exposeInt("paperCount"),
  }),
});

const StudentAnalysisRef = builder.objectRef<StudentAnalysis>("ScholarshipStudentAnalysis");
StudentAnalysisRef.implement({
  description:
    "One student's weakness profile. The overall figure rides the TOPIC axis, the one that " +
    "partitions — summing chapters would double-count every multi-chapter item (D-#661).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    topics: t.field({ type: [AxisRowRef], resolve: (r) => r.topics }),
    chapters: t.field({ type: [AxisRowRef], resolve: (r) => r.chapters }),
    papersSat: t.exposeInt("papersSat"),
    totalEarned: t.exposeFloat("totalEarned"),
    totalAvailable: t.exposeFloat("totalAvailable"),
    overallPercent: t.float({ nullable: true, resolve: (r) => r.overallPercent }),
  }),
});

const ClassCellRef = builder.objectRef<ClassCell>("ScholarshipClassCell");
ClassCellRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    band: t.exposeString("band"),
    available: t.exposeFloat("available"),
  }),
});

const ClassRowRef = builder.objectRef<ClassAxisRow>("ScholarshipClassRow");
ClassRowRef.implement({
  description:
    "One heat-map row. A row weak across the whole class is a teaching problem, not a student " +
    "one — which is why the class mean sits on the row itself (D-#663).",
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    subject: t.exposeString("subject"),
    classPercent: t.float({ nullable: true, resolve: (r) => r.classPercent }),
    band: t.exposeString("band"),
    cells: t.field({ type: [ClassCellRef], resolve: (r) => r.cells }),
  }),
});

const ClassStudentRef = builder.objectRef<{ id: string; nameBn: string }>("ScholarshipClassStudent");
ClassStudentRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    nameBn: t.exposeString("nameBn"),
  }),
});

const ClassAnalysisRef = builder.objectRef<ClassAnalysis>("ScholarshipClassAnalysis");
ClassAnalysisRef.implement({
  fields: (t) => ({
    students: t.field({ type: [ClassStudentRef], resolve: (r) => r.students }),
    rows: t.field({ type: [ClassRowRef], resolve: (r) => r.rows }),
  }),
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const ItemInput = builder.inputType("ScholarshipItemInput", {
  description:
    "One declared item. `subject` must be one the paper covers; `topicCode` must exist for THAT " +
    "subject; `marks` steps by 0.5. Σ over the list must equal the paper's totalMarks.",
  fields: (t) => ({
    itemNo: t.int({ required: true }),
    label: t.string({ required: true }),
    subject: t.string({ required: true }),
    topicCode: t.string({ required: true }),
    chapters: t.intList({ required: false }),
    itemType: t.string({ required: true }),
    marks: t.float({ required: true }),
  }),
});

const ItemMarkInput = builder.inputType("ScholarshipItemMarkInput", {
  fields: (t) => ({
    itemNo: t.int({ required: true }),
    marks: t.float({ required: true }),
  }),
});

const ScoreRowInput = builder.inputType("ScholarshipScoreRowInput", {
  description: "One student's attempt. Send no itemMarks for ABSENT — zeros are a different fact.",
  fields: (t) => ({
    studentId: t.string({ required: true }),
    status: t.string({ required: true }),
    itemMarks: t.field({ type: [ItemMarkInput], required: false }),
    note: t.string({ required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  scholarshipTopics: t.field({
    type: [TopicRef],
    description: "The topic catalogue for a class, optionally one subject.",
    authScopes: { hasPermission: "scholarship:read" },
    args: {
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: false }),
      includeRetired: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args) =>
      listTopics(args.classLevel, (args.subject ?? undefined) as HwSubject | undefined, args.includeRetired ?? false),
  }),

  scholarshipPapers: t.field({
    type: [PaperRowRef],
    description: "One section's practice papers, newest first.",
    authScopes: { hasPermission: "scholarship:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) =>
      listPapers(args.sectionId, (args.subject ?? undefined) as HwSubject | undefined),
  }),

  scholarshipPaper: t.field({
    type: PaperDetailRef,
    nullable: true,
    description: "One paper: its declared items and the full section roster with any scores.",
    authScopes: { hasPermission: "scholarship:read" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args) => paperDetail(args.id),
  }),

  scholarshipStudent: t.field({
    type: StudentAnalysisRef,
    description: "One student's topic and chapter weakness across every scored paper in scope.",
    authScopes: { hasPermission: "scholarship:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      studentId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) =>
      studentAnalysis(
        {
          sectionId: args.sectionId,
          classLevel: args.classLevel,
          subject: (args.subject ?? undefined) as HwSubject | undefined,
        },
        args.studentId,
      ),
  }),

  scholarshipClass: t.field({
    type: ClassAnalysisRef,
    description: "The class heat-map: one row per topic (or chapter), one cell per student.",
    authScopes: { hasPermission: "scholarship:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: false }),
      axis: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) =>
      classAnalysis(
        {
          sectionId: args.sectionId,
          classLevel: args.classLevel,
          subject: (args.subject ?? undefined) as HwSubject | undefined,
        },
        args.axis === "chapter" ? "chapter" : "topic",
      ),
  }),

  scholarshipItemsCheck: t.field({
    type: "String",
    nullable: true,
    description:
      "Dry-run the declaration guards and return the Bangla complaint, or null when the paper is " +
      "sound — so the app can show the same message live while the item list is still being typed.",
    authScopes: { hasPermission: "scholarship:manage" },
    args: {
      classLevel: t.arg.int({ required: true }),
      subjects: t.arg.stringList({ required: true }),
      totalMarks: t.arg.float({ required: true }),
      items: t.arg({ type: [ItemInput], required: true }),
    },
    resolve: async (_r, args) =>
      validateItems(
        args.subjects as HwSubject[],
        args.totalMarks,
        args.items.map((i) => ({
          itemNo: i.itemNo,
          label: i.label,
          subject: i.subject as HwSubject,
          topicCode: i.topicCode,
          chapters: i.chapters ?? [],
          itemType: i.itemType as PaperDetailView["items"][number]["itemType"] as never,
          marks: i.marks,
        })),
        args.classLevel,
      ),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  saveScholarshipTopic: t.field({
    type: "String",
    description: "Add or edit a topic. Returns its code, which is never rewritten afterwards.",
    authScopes: { hasPermission: "scholarship:manage" },
    args: {
      subject: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      code: t.arg.string({ required: false }),
      labelBn: t.arg.string({ required: true }),
      axis: t.arg.string({ required: true }),
      chapters: t.arg.intList({ required: false }),
      order: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      saveTopic(
        {
          subject: args.subject as HwSubject,
          classLevel: args.classLevel,
          code: args.code ?? undefined,
          labelBn: args.labelBn,
          axis: args.axis as ScholarshipTopicAxis,
          chapters: args.chapters ?? [],
          order: args.order ?? 0,
        },
        actorOf(ctx),
      ),
  }),

  retireScholarshipTopic: t.field({
    type: "Boolean",
    description: "Soft retire — historical items tagged with this code keep resolving.",
    authScopes: { hasPermission: "scholarship:manage" },
    args: {
      subject: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      code: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await retireTopic(args.subject as HwSubject, args.classLevel, args.code, actorOf(ctx));
      return true;
    },
  }),

  declareScholarshipPaper: t.field({
    type: "String",
    description:
      "Declare a paper and its item structure. Refuses unless the items total the full marks. " +
      "Returns the new paper's id.",
    authScopes: { hasPermission: "scholarship:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subjects: t.arg.stringList({ required: true }),
      name: t.arg.string({ required: true }),
      paperDate: t.arg.string({ required: false }),
      totalMarks: t.arg.float({ required: true }),
      durationMinutes: t.arg.int({ required: false }),
      sourceNote: t.arg.string({ required: false }),
      items: t.arg({ type: [ItemInput], required: true }),
    },
    resolve: async (_r, args, ctx) => {
      const paper = await declarePaper(
        {
          sectionId: args.sectionId,
          subjects: args.subjects as HwSubject[],
          name: args.name,
          paperDate: args.paperDate ? new Date(args.paperDate) : undefined,
          totalMarks: args.totalMarks,
          durationMinutes: args.durationMinutes ?? undefined,
          sourceNote: args.sourceNote ?? undefined,
          items: args.items.map((i) => ({
            itemNo: i.itemNo,
            label: i.label,
            subject: i.subject as HwSubject,
            topicCode: i.topicCode,
            chapters: i.chapters ?? [],
            itemType: i.itemType as never,
            marks: i.marks,
          })),
        },
        actorOf(ctx),
      );
      return String(paper._id);
    },
  }),

  enterScholarshipScores: t.field({
    type: "Int",
    description: "Write per-item marks for one or more students. Returns how many rows were written.",
    authScopes: { hasPermission: "scholarship:manage" },
    args: {
      paperId: t.arg.string({ required: true }),
      rows: t.arg({ type: [ScoreRowInput], required: true }),
    },
    resolve: async (_r, args, ctx) =>
      enterScores(
        args.paperId,
        args.rows.map((r) => ({
          studentId: r.studentId,
          status: r.status === "ABSENT" ? "ABSENT" : "PRESENT",
          itemMarks: (r.itemMarks ?? []).map((m) => ({ itemNo: m.itemNo, marks: m.marks })),
          note: r.note ?? undefined,
        })),
        actorOf(ctx),
      ),
  }),
}));
