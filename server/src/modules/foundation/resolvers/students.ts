import { builder } from "../../../schema";
import { Student, type IStudent } from "../models/Student";

type StudentShape = Pick<IStudent, "schoolId" | "name" | "active"> & { _id: { toString(): string } };

const StudentRef = builder.objectRef<StudentShape>("Student");
StudentRef.implement({
  description: "Thin student profile — data only, no login",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    active: t.exposeBoolean("active"),
  }),
});

builder.queryField("studentsInSection", (t) =>
  t.field({
    type: [StudentRef],
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      Student.find({ sectionId: args.sectionId, active: true }).lean(),
  }),
);

builder.mutationField("createStudent", (t) =>
  t.field({
    type: StudentRef,
    authScopes: { hasPermission: "roster:manage" },
    args: {
      schoolId: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      Student.create({
        schoolId: args.schoolId,
        name: args.name,
        classId: args.classId,
        sectionId: args.sectionId,
      }),
  }),
);
