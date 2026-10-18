import { builder } from "../../../schema";
import { staffLogin, guardianLogin, refreshSession } from "../services/AuthService";
import type { AuthResult, AuthTokenPayload } from "../services/AuthService";
import {
  listImpersonationTargets,
  listImpersonationTargetsPage,
  startImpersonation,
  endImpersonation,
  type ImpersonationKind,
  type ImpersonationResult,
  type ImpersonationTarget,
} from "../services/ImpersonationService";
import { pageRef } from "../../../pageRef";

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
    resolve: (_root, args, ctx) =>
      staffLogin({ email: args.email, password: args.password, ip: ctx.clientIp }),
  }),
);

builder.mutationField("refreshSession", (t) =>
  t.field({
    type: AuthResultRef,
    nullable: true,
    description:
      "Re-mint the caller's session token (D-#708) — the app calls this on every open so a " +
      "person stays signed in. Null when the account is gone/deactivated (the app signs out) " +
      "or for a borrowed View-as token (never extended).",
    resolve: (_root, _args, ctx) => (ctx.auth ? refreshSession(ctx.auth as AuthTokenPayload) : null),
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
    resolve: (_root, args, ctx) => {
      const kind = args.identifierKind as "email" | "phone" | "school_id";
      return guardianLogin({ identifier: args.identifier, identifierKind: kind, password: args.password, ip: ctx.clientIp });
    },
  }),
);

// ---------------------------------------------------------------------------
// "View as" — the Principal opens someone else's account view (VA-1, D-#638)
// ---------------------------------------------------------------------------

const ImpersonationTargetRef = builder.objectRef<ImpersonationTarget>("ImpersonationTarget");
ImpersonationTargetRef.implement({
  description: "A staff member or guardian the Principal may open a session for.",
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
    /** Staff: their sections. Guardian: one line per child ("<নাম> · <শাখা>"). */
    lines: t.exposeStringList("lines"),
    eligible: t.exposeBoolean("eligible"),
    reason: t.exposeString("reason", { nullable: true }),
  }),
});

const ImpersonationResultRef = builder.objectRef<ImpersonationResult>("ImpersonationResult");
ImpersonationResultRef.implement({
  description: "A borrowed session token plus how long it is good for.",
  fields: (t) => ({
    token: t.exposeString("token"),
    userId: t.exposeString("userId"),
    role: t.exposeString("role"),
    name: t.exposeString("name"),
    expiresInSeconds: t.exposeInt("expiresInSeconds"),
  }),
});

builder.queryField("impersonationTargets", (t) =>
  t.field({
    type: [ImpersonationTargetRef],
    authScopes: { authenticated: true },
    description: "Accounts the Principal may view as. Ineligible rows come back locked, with a reason.",
    args: {
      kind: t.arg.string({ required: true }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      return listImpersonationTargets({
        callerUserId: ctx.auth.userId,
        kind: args.kind as ImpersonationKind,
        search: args.search,
        limit: args.limit,
      });
    },
  }),
);

// D-#761: the paged picker ViewAsScreen reads (the list above stops at 50 names, A→Z,
// with no hint). Stays beside it for released bundles.
const ImpersonationTargetPageRef = pageRef("ImpersonationTargetPage", ImpersonationTargetRef);

builder.queryField("impersonationTargetsPage", (t) =>
  t.field({
    type: ImpersonationTargetPageRef,
    authScopes: { authenticated: true },
    description: "One page of impersonationTargets (same eligibility + search), A→Z (D-#761).",
    args: {
      kind: t.arg.string({ required: true }),
      search: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      return listImpersonationTargetsPage(
        { callerUserId: ctx.auth.userId, kind: args.kind as ImpersonationKind, search: args.search },
        args,
      );
    },
  }),
);

builder.mutationField("startImpersonation", (t) =>
  t.field({
    type: ImpersonationResultRef,
    authScopes: { authenticated: true },
    description: "Mint a short-lived token for another account (Principal only).",
    args: {
      targetId: t.arg.string({ required: true }),
      targetKind: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      return startImpersonation({
        callerUserId: ctx.auth.userId,
        // No second hop (G2). Read from the verified token, not from an argument — the
        // client cannot talk its way out of it.
        alreadyImpersonating: Boolean(ctx.auth.impersonatorId),
        targetId: args.targetId,
        targetKind: args.targetKind as ImpersonationKind,
      });
    },
  }),
);

builder.mutationField("endImpersonation", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { authenticated: true },
    description: "Record the end of a View-as session. Called with the BORROWED token.",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth?.impersonatorId) return false;
      return endImpersonation({
        borrowedUserId: ctx.auth.userId,
        impersonatorId: ctx.auth.impersonatorId,
      });
    },
  }),
);
