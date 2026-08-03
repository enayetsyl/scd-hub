import { builder } from "../../../schema";
import { User, type IUser } from "../models/User";
import { Guardian } from "../models/Guardian";
import { hashPassword } from "../services/AuthService";
import type { Role } from "@scd/shared";
import { ROLES, effectivePermissions, isPermissionActive } from "@scd/shared";

type UserShape = Pick<IUser, "email" | "phone" | "role" | "name" | "active" | "homeworkSupervisor"> & {
  _id: { toString(): string };
};

const UserRef = builder.objectRef<UserShape>("User");
UserRef.implement({
  description: "Staff account (Principal / Teacher / Office)",
  fields: (t) => ({
    id: t.string({ resolve: (u) => u._id.toString() }),
    email: t.string({ nullable: true, resolve: (u) => u.email ?? null }),
    phone: t.string({ nullable: true, resolve: (u) => u.phone ?? null }),
    role: t.exposeString("role"),
    name: t.exposeString("name"),
    active: t.exposeBoolean("active"),
    // School-wide homework supervisor — lets the app surface ALL classes on the homework
    // screens (so a supervisor can reconcile any class, not just their own).
    homeworkSupervisor: t.boolean({ resolve: (u) => !!u.homeworkSupervisor }),
  }),
});

builder.queryField("me", (t) =>
  t.field({
    type: UserRef,
    nullable: true,
    authScopes: { authenticated: true },
    description: "Currently authenticated account (staff User, or the Guardian mapped to the same shape)",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) return null;
      // A GUARDIAN JWT subjects the Guardian collection (GP-1/GP-2): map the
      // guardian's own account onto the same shape so the app boot flow works.
      // Reads only the caller's own row — no new data surface.
      if (ctx.auth.role === "GUARDIAN") {
        const g = await Guardian.findById(ctx.auth.userId).lean();
        if (!g || !g.active) return null;
        return {
          _id: g._id,
          email: g.email,
          phone: g.phone,
          role: "GUARDIAN" as IUser["role"],
          name: g.name,
          active: g.active,
          homeworkSupervisor: false,
        };
      }
      return User.findById(ctx.auth.userId).lean();
    },
  }),
);

builder.queryField("myPermissions", (t) =>
  t.field({
    type: ["String"],
    authScopes: { authenticated: true },
    description:
      "The caller's OWN effective permissions — role template(s) + grants − revocations. " +
      "Lets the app show only the screens the caller can actually use.",
    resolve: (_root, _args, ctx) => {
      if (!ctx.auth) return [];
      // Deliberately a SEPARATE field from `me` rather than a column on UserRef: UserRef
      // is also the shape of OTHER people (the teachers list), and one person's
      // permissions are not another's business.
      //
      // WHY THE APP NEEDS THIS AT ALL. Navigation has always gated on
      // `roleHasPermission(role, …)`, i.e. on the role TEMPLATE. That was fine while
      // every permission a person held came from their role. It stops being fine for
      // the book module (D-#405): `book:*` sits only on the PRINCIPAL template, and
      // the illustrator/reviewer/assembler reach it by per-user grant (AC-1). Gating
      // their screens on the template would hide those screens from precisely the
      // people they were built for.
      //
      // This is a READ OF THE CALLER'S OWN TOKEN — no new data surface, and no new
      // authority: every resolver still checks `callerHasPermission` for itself. Hiding
      // a screen is a courtesy, never the gate.
      return [...effectivePermissions(ctx.auth)].filter((p) => isPermissionActive(p)).sort();
    },
  }),
);

builder.queryField("teachers", (t) =>
  t.field({
    type: [UserRef],
    authScopes: { authenticated: true },
    description:
      "Active teacher accounts — for name pickers (reviewer assignment, routine/cover, class-teacher). " +
      "Names are non-sensitive and already shown in rosters; any authenticated staff may read.",
    resolve: async () =>
      User.find({ role: "TEACHER", active: true }).sort({ name: 1 }).lean(),
  }),
);

builder.queryField("users", (t) =>
  t.field({
    type: [UserRef],
    authScopes: { hasPermission: "user:manage" },
    description:
      "All staff accounts (incl. inactive) for the admin user list — Slice-4 follow-up. " +
      "Gated user:manage (Principal), same as createUser.",
    resolve: async () => User.find({}).sort({ name: 1 }).lean(),
  }),
);

builder.mutationField("createUser", (t) =>
  t.field({
    type: UserRef,
    authScopes: { hasPermission: "user:manage" },
    description: "Create a new staff account (Principal only)",
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
      role: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => {
      if (!ROLES.includes(args.role as Role)) {
        throw new Error(`Invalid role: ${args.role}`);
      }
      const passwordHash = await hashPassword(args.password);
      return User.create({ email: args.email, passwordHash, role: args.role as Role, name: args.name });
    },
  }),
);
