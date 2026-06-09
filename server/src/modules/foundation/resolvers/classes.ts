import { builder } from "../../../schema";
import { Class, type IClass } from "../models/Class";
import { Section, type ISection } from "../models/Section";
import { Subject, type ISubject } from "../models/Subject";
import { DEFAULT_SECTION_CODE, DEFAULT_SECTION_LABEL_BN } from "@scd/shared";

type SubjectShape = Pick<ISubject, "code" | "nameBn"> & { _id: { toString(): string } };
type SectionShape = Pick<ISection, "code" | "nameBn" | "active"> & { _id: { toString(): string } };
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
