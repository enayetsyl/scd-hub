import { builder } from "../../../schema";
import { staffLogin, guardianLogin } from "../services/AuthService";
import type { AuthResult } from "../services/AuthService";

const AuthResultRef = builder.objectRef<AuthResult>("AuthResult");
AuthResultRef.implement({
  description: "JWT auth result",
  fields: (t) => ({
    token: t.exposeString("token"),
    userId: t.exposeString("userId"),
    role: t.exposeString("role"),
    name: t.exposeString("name"),
  }),
});

builder.mutationField("staffLogin", (t) =>
  t.field({
    type: AuthResultRef,
    nullable: true,
    description: "Email + password login for staff (Principal/Teacher/Office)",
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    resolve: (_root, args) =>
      staffLogin({ email: args.email, password: args.password }),
  }),
);

builder.mutationField("guardianLogin", (t) =>
  t.field({
    type: AuthResultRef,
    nullable: true,
    description: "Flexible-identifier login for guardians (email|phone|school_id)",
    args: {
      identifier: t.arg.string({ required: true }),
      identifierKind: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    resolve: (_root, args) => {
      const kind = args.identifierKind as "email" | "phone" | "school_id";
      return guardianLogin({ identifier: args.identifier, identifierKind: kind, password: args.password });
    },
  }),
);
