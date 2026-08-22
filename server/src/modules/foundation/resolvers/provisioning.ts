import { builder } from "../../../schema";
import {
  guardianCredentialCandidates,
  provisionGuardianLogin,
  resetGuardianPassword,
  staffCredentialCandidates,
  provisionStaffLogin,
  resetUserPassword,
  resetStaffPassword,
  type GuardianCandidate,
  type StaffCandidate,
  type ProvisionedCredential,
} from "../services/ProvisioningService";

/**
 * Credential-provisioning resolvers (D-#59 guardians, D-#60 staff).
 *
 * Guardian provisioning is gated on `guardian:link` (Principal + Office) — the
 * same permission that already creates/links guardians. Staff provisioning is
 * gated on `user:manage` (Principal only) — the same permission as createUser.
 * Identity-plane only; no corpus path (ADR-005 firewall unaffected).
 */

// --- output types ----------------------------------------------------------

const ProvisionedCredentialRef = builder.objectRef<ProvisionedCredential>("ProvisionedCredential");
ProvisionedCredentialRef.implement({
  description: "A freshly provisioned login. `password` is plaintext, shown ONCE — never stored.",
  fields: (t) => ({
    identifier: t.exposeString("identifier"),
    identifierKind: t.exposeString("identifierKind"),
    password: t.exposeString("password"),
    name: t.exposeString("name"),
    contextLabel: t.exposeString("contextLabel"),
    studentCount: t.exposeInt("studentCount"),
    waLink: t.exposeString("waLink"),
    alreadyExisted: t.exposeBoolean("alreadyExisted"),
  }),
});

const StudentBriefRef = builder.objectRef<GuardianCandidate["students"][number]>("CredentialStudentBrief");
StudentBriefRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    className: t.exposeString("className"),
    classLevel: t.int({ nullable: true, resolve: (s) => s.classLevel }),
  }),
});

const GuardianCandidateRef = builder.objectRef<GuardianCandidate>("GuardianCredentialCandidate");
GuardianCandidateRef.implement({
  description: "A family (grouped by primary-contact phone) eligible for one shared guardian login.",
  fields: (t) => ({
    phone: t.exposeString("phone"),
    suggestedName: t.exposeString("suggestedName"),
    students: t.field({ type: [StudentBriefRef], resolve: (c) => c.students }),
    loginExists: t.exposeBoolean("loginExists"),
    loginEnabled: t.exposeBoolean("loginEnabled"),
    guardianId: t.string({ nullable: true, resolve: (c) => c.guardianId }),
  }),
});

const StaffCandidateRef = builder.objectRef<StaffCandidate>("StaffCredentialCandidate");
StaffCandidateRef.implement({
  description: "A staff member eligible (or not) for an app login.",
  fields: (t) => ({
    staffId: t.exposeString("staffId"),
    name: t.exposeString("name"),
    category: t.exposeString("category"),
    phone: t.string({ nullable: true, resolve: (c) => c.phone }),
    mappedRole: t.string({ nullable: true, resolve: (c) => c.mappedRole }),
    provisionable: t.exposeBoolean("provisionable"),
    reason: t.string({ nullable: true, resolve: (c) => c.reason }),
    loginExists: t.exposeBoolean("loginExists"),
    userId: t.string({ nullable: true, resolve: (c) => c.userId }),
  }),
});

// --- guardian queries / mutations (guardian:link) --------------------------

builder.queryField("guardianCredentialCandidates", (t) =>
  t.field({
    type: [GuardianCandidateRef],
    authScopes: { hasPermission: "guardian:link" },
    description: "Families grouped by contact phone, each eligible for one shared guardian login (D-#59).",
    resolve: () => guardianCredentialCandidates(),
  }),
);

builder.mutationField("provisionGuardianLogin", (t) =>
  t.field({
    type: ProvisionedCredentialRef,
    authScopes: { hasPermission: "guardian:link" },
    description: "Generate (or reset) a phone-keyed guardian login covering every sibling on that phone (D-#59).",
    args: { phone: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      provisionGuardianLogin(args.phone, { userId: ctx.auth?.userId, role: ctx.auth?.role }),
  }),
);

builder.mutationField("resetGuardianPassword", (t) =>
  t.field({
    type: ProvisionedCredentialRef,
    authScopes: { hasPermission: "guardian:link" },
    description: "Reset an existing guardian login's password (D-#59).",
    args: { guardianId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      resetGuardianPassword(args.guardianId, { userId: ctx.auth?.userId, role: ctx.auth?.role }),
  }),
);

// --- staff queries / mutations (user:manage) -------------------------------

builder.queryField("staffCredentialCandidates", (t) =>
  t.field({
    type: [StaffCandidateRef],
    authScopes: { hasPermission: "user:manage" },
    description: "Staff members and whether each has / can have an app login (D-#60).",
    resolve: () => staffCredentialCandidates(),
  }),
);

builder.mutationField("provisionStaffLogin", (t) =>
  t.field({
    type: ProvisionedCredentialRef,
    authScopes: { hasPermission: "user:manage" },
    description: "Generate (or reset) a phone-login for a staff member, role mapped from HR category (D-#60).",
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      provisionStaffLogin(args.staffProfileId, { userId: ctx.auth?.userId, role: ctx.auth?.role }),
  }),
);

builder.mutationField("resetStaffPassword", (t) =>
  t.field({
    type: ProvisionedCredentialRef,
    authScopes: { hasPermission: "user:manage" },
    description: "Reset an existing staff login's password (D-#60).",
    args: { userId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      resetStaffPassword(args.userId, { userId: ctx.auth?.userId, role: ctx.auth?.role }),
  }),
);

builder.mutationField("resetUserPassword", (t) =>
  t.field({
    type: ProvisionedCredentialRef,
    authScopes: { hasPermission: "user:manage" },
    description:
      "Reset an EMAIL login's password and return it once (D-#526). Phone logins keep " +
      "resetStaffPassword, which also re-derives the role from the HR category.",
    args: { userId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      resetUserPassword(args.userId, { userId: ctx.auth?.userId, role: ctx.auth?.role }),
  }),
);
