import { builder } from "../../../schema";
import { Student, type IStudent } from "../models/Student";
import { GuardianLink } from "../models/GuardianLink";
import { Guardian } from "../models/Guardian";
import type { Types } from "mongoose";

type StudentShape = Pick<
  IStudent,
  "schoolId" | "name" | "nameBn" | "gender" | "dob" | "phone" | "address" | "bloodGroup" | "active"
> & { _id: Types.ObjectId };

type GuardianContactShape = {
  _id: Types.ObjectId;
  name: string;
  phone?: string;
  loginEnabled: boolean;
  relation: string;
};

const GuardianContactRef = builder.objectRef<GuardianContactShape>("GuardianContact");
GuardianContactRef.implement({
  description: "A guardian linked to a student (contact-only unless loginEnabled).",
  fields: (t) => ({
    id: t.string({ resolve: (g) => g._id.toString() }),
    name: t.exposeString("name"),
    phone: t.string({ nullable: true, resolve: (g) => g.phone ?? null }),
    relation: t.exposeString("relation"),
    loginEnabled: t.exposeBoolean("loginEnabled"),
  }),
});

const StudentRef = builder.objectRef<StudentShape>("Student");
StudentRef.implement({
  description: "Thin student profile — data only, no login",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (s) => s.nameBn ?? null }),
    gender: t.string({ nullable: true, resolve: (s) => s.gender ?? null }),
    dob: t.string({ nullable: true, resolve: (s) => (s.dob ? s.dob.toISOString() : null) }),
    phone: t.string({ nullable: true, resolve: (s) => s.phone ?? null }),
    address: t.string({ nullable: true, resolve: (s) => s.address ?? null }),
    bloodGroup: t.string({ nullable: true, resolve: (s) => s.bloodGroup ?? null }),
    active: t.exposeBoolean("active"),
    guardians: t.field({
      type: [GuardianContactRef],
      resolve: async (s) => {
        const links = await GuardianLink.find({ studentId: s._id }).lean();
        if (links.length === 0) return [];
        const byId = new Map(
          (await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) } }).lean()).map((g) => [
            g._id.toString(),
            g,
          ]),
        );
        const out: GuardianContactShape[] = [];
        for (const l of links) {
          const g = byId.get(l.guardianId.toString());
          if (!g) continue;
          out.push({ _id: g._id, name: g.name, phone: g.phone, loginEnabled: g.loginEnabled, relation: l.relation });
        }
        return out;
      },
    }),
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
      Student.find({ sectionId: args.sectionId, active: true }).sort({ name: 1 }).lean(),
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
