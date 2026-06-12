import { builder } from "../../../schema";
import { Class, type IClass } from "../models/Class";
import { Section, type ISection } from "../models/Section";
import { Subject, type ISubject } from "../models/Subject";
import { Student } from "../models/Student";
import { AcademicYear, type IAcademicYear } from "../models/AcademicYear";
import { type IClassTeacherAssignment } from "../models/ClassTeacherAssignment";
import {
  assignClassTeacher as svcAssignClassTeacher,
  setSupportTeacher,
  classTeacherHistory,
  mySectionsAsClassTeacher,
} from "../services/ClassTeacherService";
import { mergeSections, splitSections, activeSectionMerges } from "../services/SectionMergeService";
import { DEFAULT_SECTION_CODE, DEFAULT_SECTION_LABEL_BN } from "@scd/shared";

type SubjectShape = Pick<ISubject, "code" | "nameBn"> & { _id: { toString(): string } };
type SectionShape = Pick<ISection, "code" | "nameBn" | "active"> & {
  _id: { toString(): string };
  classTeacherId?: { toString(): string } | null;
  supportTeacherIds?: Array<{ toString(): string }> | null;
};
type ClassShape = Pick<IClass, "level" | "nameBn" | "active"> & { _id: { toString(): string } };

const SubjectRef = builder.objectRef<SubjectShape>("Subject");
SubjectRef.implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
  }),
});

const SectionRef = builder.objectRef<SectionShape>("Section");
SectionRef.implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    active: t.exposeBoolean("active"),
    classTeacherId: t.string({
      nullable: true,
      resolve: (s) => (s.classTeacherId ? s.classTeacherId.toString() : null),
    }),
    supportTeacherIds: t.stringList({
      resolve: (s) => (s.supportTeacherIds ?? []).map((id) => id.toString()),
    }),
    studentCount: t.int({
      description: "Active students currently in this section.",
      resolve: (s) => Student.countDocuments({ sectionId: s._id, active: true }),
    }),
  }),
});

const ClassRef = builder.objectRef<ClassShape>("Class");
ClassRef.implement({
  fields: (t) => ({
    id: t.string({ resolve: (c) => c._id.toString() }),
    level: t.exposeInt("level"),
    nameBn: t.exposeString("nameBn"),
    active: t.exposeBoolean("active"),
    sections: t.field({
      type: [SectionRef],
      resolve: async (c) => Section.find({ classId: c._id, active: true }).lean(),
    }),
  }),
});

builder.queryField("classes", (t) =>
  t.field({
    type: [ClassRef],
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      Class.find({ academicYearId: args.academicYearId, active: true }).lean(),
  }),
);

builder.queryField("subjects", (t) =>
  t.field({
    type: [SubjectRef],
    authScopes: { authenticated: true },
    resolve: async () => Subject.find({ active: true }).lean(),
  }),
);

type AcademicYearShape = Pick<IAcademicYear, "label" | "current"> & { _id: { toString(): string } };
const AcademicYearRef = builder.objectRef<AcademicYearShape>("AcademicYear");
AcademicYearRef.implement({
  fields: (t) => ({
    id: t.string({ resolve: (y) => y._id.toString() }),
    label: t.exposeString("label"),
    current: t.exposeBoolean("current"),
  }),
});

/** All academic years (newest label first) — for year pickers. */
builder.queryField("academicYears", (t) =>
  t.field({
    type: [AcademicYearRef],
    authScopes: { authenticated: true },
    resolve: async () => AcademicYear.find({}).sort({ label: -1 }).lean(),
  }),
);

// --- Section merge / split (D-#62) — Principal/Office combine a class's gender ---
// sections into one (students moved) and reverse it later. `roster:manage`.

const SectionMergeRef = builder
  .objectRef<{ id: string; classId: string; combinedSectionId: string; sourceSectionIds: string[] }>("SectionMerge")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      classId: t.exposeString("classId"),
      combinedSectionId: t.exposeString("combinedSectionId"),
      sourceSectionIds: t.exposeStringList("sourceSectionIds"),
    }),
  });

/** The classes currently merged — the admin UI shows a "split" action for these. */
builder.queryField("activeSectionMerges", (t) =>
  t.field({
    type: [SectionMergeRef],
    authScopes: { hasPermission: "roster:manage" },
    resolve: async () => activeSectionMerges(),
  }),
);

const SectionMergeResultRef = builder
  .objectRef<{ combinedSectionId: string; movedStudents: number; sourceSectionIds: string[] }>("SectionMergeResult")
  .implement({
    fields: (t) => ({
      combinedSectionId: t.exposeString("combinedSectionId"),
      movedStudents: t.exposeInt("movedStudents"),
      sourceSectionIds: t.exposeStringList("sourceSectionIds"),
    }),
  });

/** Merge a class's active sections into one combined section (students moved). */
builder.mutationField("mergeSections", (t) =>
  t.field({
    type: SectionMergeResultRef,
    authScopes: { hasPermission: "roster:manage" },
    args: {
      classId: t.arg.string({ required: true }),
      combinedNameBn: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      mergeSections(args.classId, args.combinedNameBn ?? null, ctx.auth!.userId),
  }),
);

const SectionSplitResultRef = builder
  .objectRef<{ restoredSections: number; movedStudents: number }>("SectionSplitResult")
  .implement({
    fields: (t) => ({
      restoredSections: t.exposeInt("restoredSections"),
      movedStudents: t.exposeInt("movedStudents"),
    }),
  });

/** Reverse a class's merge: students return to their source sections. */
builder.mutationField("splitSections", (t) =>
  t.field({
    type: SectionSplitResultRef,
    authScopes: { hasPermission: "roster:manage" },
    args: { classId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => splitSections(args.classId, ctx.auth!.userId),
  }),
);

builder.mutationField("createClass", (t) =>
  t.field({
    type: ClassRef,
    authScopes: { hasPermission: "roster:manage" },
    args: {
      level: t.arg.int({ required: true }),
      nameBn: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => {
      const cls = await Class.create({
        level: args.level,
        nameBn: args.nameBn,
        academicYearId: args.academicYearId,
      });
      // Auto-create the default "Main" section (D-#1 / ADR-016)
      await Section.create({
        classId: cls._id,
        code: DEFAULT_SECTION_CODE,
        nameBn: DEFAULT_SECTION_LABEL_BN,
      });
      return cls;
    },
  }),
);

/**
 * Assign (or clear) a section's CLASS TEACHER — the section's daily coordinator
 * (D-#42, the general `assertIsClassTeacher` gate). Admin action (roster:manage =
 * Principal/Office). Pass `userId: null` to clear. The assignee must be a TEACHER.
 * The change is appended to the immutable assignment log (CT-1/CT1.6).
 */
builder.mutationField("assignClassTeacher", (t) =>
  t.field({
    type: SectionRef,
    authScopes: { hasPermission: "roster:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      svcAssignClassTeacher(args.sectionId, args.userId ?? null, ctx.auth!.userId) as unknown as Promise<SectionShape>,
  }),
);

/**
 * Add (or remove) a SUPPORT / assistant teacher on a section (CT1.5, D-#53). The
 * class teacher stays the single coordinator gate; support is a recorded helper.
 * Admin action (roster:manage); the assignee must be a TEACHER. Logged (CT1.6).
 */
builder.mutationField("setSupportTeacher", (t) =>
  t.field({
    type: SectionRef,
    authScopes: { hasPermission: "roster:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
      add: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      setSupportTeacher(args.sectionId, args.userId, args.add, ctx.auth!.userId) as unknown as Promise<SectionShape>,
  }),
);

/** The sections the caller is class teacher of (CT1.2 — teacher self-view). */
builder.queryField("mySectionsAsClassTeacher", (t) =>
  t.field({
    type: [SectionRef],
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      mySectionsAsClassTeacher(ctx.auth!.userId) as unknown as Promise<SectionShape[]>,
  }),
);

const ClassTeacherAssignmentRef = builder.objectRef<IClassTeacherAssignment>("ClassTeacherAssignment").implement({
  fields: (t) => ({
    id: t.string({ resolve: (a) => a._id.toString() }),
    sectionId: t.string({ resolve: (a) => a.sectionId.toString() }),
    role: t.exposeString("role"),
    teacherId: t.string({ nullable: true, resolve: (a) => (a.teacherId ? a.teacherId.toString() : null) }),
    op: t.exposeString("op"),
    actorId: t.string({ resolve: (a) => a.actorId.toString() }),
    at: t.string({ resolve: (a) => new Date(a.at).toISOString() }),
  }),
});

/** The append-only class-teacher/support assignment history for a section (CT1.6). */
builder.queryField("classTeacherHistory", (t) =>
  t.field({
    type: [ClassTeacherAssignmentRef],
    authScopes: { hasPermission: "roster:manage" },
    args: { sectionId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => classTeacherHistory(args.sectionId),
  }),
);
