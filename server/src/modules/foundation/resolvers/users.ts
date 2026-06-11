import { builder } from "../../../schema";
import { User, type IUser } from "../models/User";
import { hashPassword } from "../services/AuthService";
import type { Role } from "@scd/shared";
import { ROLES } from "@scd/shared";

type UserShape = Pick<IUser, "email" | "phone" | "role" | "name" | "active"> & { _id: { toString(): string } };

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
  }),
});

builder.queryField("me", (t) =>
  t.field({
    type: UserRef,
    nullable: true,
    authScopes: { authenticated: true },
    description: "Currently authenticated staff user",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) return null;
      return User.findById(ctx.auth.userId).lean();
    },
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
